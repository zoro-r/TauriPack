# 腾讯广告人群包（客户文件）接入实现文档

> 文档范围：以广告主自有手机号、设备标识等数据创建「客户人群（CUSTOMER_FILE）」并上传文件、轮询处理结果、将可用人群 ID 交给投放模块使用。本文不实现代码，也不包含广告组创建的字段契约。
>
> 核验日期：2026-08-24。接口版本以腾讯广告开发者站当日页面为准；本次核验的人群创建、文件上传与查询页面均展示 `v1.1`。调用前须再以应用已获权限和广告产品对应版本做最终确认。

## 1. 结论与边界

客户文件人群的可靠接入顺序如下：

```text
应用/权限审批 → 获取并维护授权令牌 → 创建客户人群 → 上传文件
→ 查询文件处理结果 → 查询人群可用状态/覆盖量 → 投放模块引用 audience_id
```

本方案只使用以下三个已核验的 Marketing API：

| 目的 | 请求 | 方法与内容类型 | 已核验版本 |
| --- | --- | --- | --- |
| 创建客户人群 | `custom_audiences/add` | `POST` / `application/json` | `v1.1` |
| 上传客户人群文件 | `custom_audience_files/add` | `POST` / `multipart/form-data` | `v1.1` |
| 查询文件处理状态 | `custom_audience_files/get` | `GET` | `v1.1` |

基础地址：`https://api.e.qq.com/v1.1`。

不要直接采用未核验的 `v3.0` 路径、`OVERRIDE` 或 `REMOVE`。本次官方页面列出的文件操作仅有 `APPEND`（默认）和 `REDUCE`。

## 2. 开通与前置条件

1. 在腾讯广告开发者专区注册开发者并创建应用，申请 **Audience Management（人群管理）** 权限。
2. 确认应用类型：
   - 私有应用仅能操作注册 QQ 所属广告身份及其权限范围内账户；
   - 第三方应用必须由广告账户完成 OAuth 授权，才可操作其 `account_id`。
3. 从腾讯广告后台确认：广告账户允许创建/使用客户人群，目标投放产品支持该人群定向，且当前账户没有额外白名单限制。
4. 仅上传已依法取得广告投放使用授权的第一方数据。原始标识、压缩包与令牌都不得进入日志、监控、错误上报或代码仓库。

## 3. 鉴权与公共请求参数

### 3.1 OAuth 授权

第三方应用采用服务端 OAuth 2.0 授权码模式。授权入口示例：

```text
https://developers.e.qq.com/oauth/authorize
  ?client_id={CLIENT_ID}
  &redirect_uri={URL_ENCODED_REDIRECT_URI}
  &state={CSRF_STATE}
  &scope=ads_management
  &account_type=ACCOUNT_TYPE_QQ
```

回调中校验 `state` 后，使用 `authorization_code` 换取令牌：

```text
GET https://api.e.qq.com/oauth/token
  ?client_id={CLIENT_ID}
  &client_secret={CLIENT_SECRET}
  &grant_type=authorization_code
  &authorization_code={CODE}
  &redirect_uri={URL_ENCODED_REDIRECT_URI}
```

刷新令牌：

```text
GET https://api.e.qq.com/oauth/token
  ?client_id={CLIENT_ID}
  &client_secret={CLIENT_SECRET}
  &grant_type=refresh_token
  &refresh_token={REFRESH_TOKEN}
```

官方入门页说明默认 `access_token` 有效期为 24 小时、`refresh_token` 为 30 天，但应用可以配置有效期；以令牌接口返回值为准。令牌加密存储，按账户隔离。刷新成功时用新的 refresh token 原子替换旧值，避免并发刷新造成授权失效。

### 3.2 每个 Marketing API 请求的 query 参数

| 参数 | 规则 |
| --- | --- |
| `access_token` | OAuth 获得的广告账户操作令牌 |
| `timestamp` | 秒级 Unix 时间戳；客户端与服务端允许最大误差为 300 秒 |
| `nonce` | 调用方生成、全局唯一、最长 32 字符的随机字符串 |

服务端应在发送前生成 `timestamp` 与 `nonce`，而不是由前端传入。系统时钟应通过 NTP 保持同步。

## 4. 数据准备

### 4.1 输入文件

- 支持 `txt` 或 `csv`；一行一个用户标识。
- 可上传压缩后的 zip 文件，**压缩包不超过 100 MB**。
- 单次文件只能包含一种 `user_id_type`；多种标识拆为多次上传。
- 生成文件时去除首尾空白、空行和重复值，保留原始行数、有效行数、去重数与 SHA-256 校验值到内部审计表。

官方页面列出的 `user_id_type` 为：

```text
HASH_IDFA, HASH_IMEI, HASH_MOBILE_PHONE, IDFA, IMEI,
WX_OPENID, WX_UNIONID, WECHAT_OPENID,
SALTED_HASH_IMEI, SALTED_HASH_IDFA, OAID, HASH_OAID,
SHA256_MOBILE_PHONE, MD5_SHA256_IMEI, MD5_SHA256_IDFA,
MD5_SHA256_OAID, CAID
```

选择枚举必须与文件内容严格匹配。例如，手机号 MD5 的具体规范和是否需要预处理，不应自行推断；在投产前须以该账户的最新 DataNexus/接口枚举说明和腾讯广告技术支持答复为准。`WECHAT_OPENID` 或 `WX_OPENID` 等开放平台标识使用时，还需提供对应的 `open_app_id`。

### 4.2 文件操作语义

| `operation_type` | 用途 | 实施要求 |
| --- | --- | --- |
| `APPEND` | 增量加入人群（默认） | 使用业务批次号防重复提交 |
| `REDUCE` | 从人群移除文件中的用户 | 仅用于明确的撤回/删除同步 |

接口页没有 `OVERRIDE`。如业务需要全量重建，使用新的 `external_audience_id` 版本或先与腾讯确认可用的重置流程；不得用猜测的操作枚举调用生产接口。

## 5. 实施流程

### 5.1 创建客户人群

请求：`POST https://api.e.qq.com/v1.1/custom_audiences/add?...`，请求体为 JSON。

```json
{
  "account_id": 123456,
  "name": "crm_high_value_20260824",
  "type": "CUSTOMER_FILE",
  "external_audience_id": "crm_high_value_v1",
  "description": "CRM 高价值用户；2026-08-24 全量首传"
}
```

字段约束：`name` 必填、同一账户不可重名、长度 1–32 字节；`external_audience_id` 可选、仅限数字/字母/下划线、长度 1–128 字节，并具有幂等语义——重复使用同一编码会返回此前创建的人群 ID；`description` 最长 100 字节。

成功后持久化 `data.audience_id`，并记录 `account_id`、内部人群编码、腾讯人群 ID、创建响应和创建时间。后续上传和投放只使用此 ID，不以名称关联。

### 5.2 上传客户文件

请求：`POST https://api.e.qq.com/v1.1/custom_audience_files/add?...`，请求体必须为 multipart/form-data。

```bash
curl 'https://api.e.qq.com/v1.1/custom_audience_files/add?access_token={TOKEN}&timestamp={TIMESTAMP}&nonce={NONCE}' \
  -F 'account_id={ACCOUNT_ID}' \
  -F 'audience_id={AUDIENCE_ID}' \
  -F 'user_id_type=HASH_MOBILE_PHONE' \
  -F 'operation_type=APPEND' \
  -F 'file=@/secure/export/audience-20260824.zip'
```

成功响应中取 `data.custom_audience_file_id`。该 ID 是异步处理任务的唯一追踪值；上传成功不代表人群立即可投放。

建议把以下信息写入内部 `audience_upload_jobs`：`job_id`、`account_id`、`audience_id`、`custom_audience_file_id`、`operation_type`、`user_id_type`、文件校验值、来源批次、提交时间、最后响应、重试次数与状态。不要保存文件中的原始用户标识。

### 5.3 轮询处理结果

请求：

```text
GET https://api.e.qq.com/v1.1/custom_audience_files/get
  ?access_token={TOKEN}&timestamp={TIMESTAMP}&nonce={NONCE}
  &account_id={ACCOUNT_ID}
  &audience_id={AUDIENCE_ID}
  &custom_audience_file_id={FILE_ID}
  &page=1&page_size=10
```

查询结果中的 `list[]` 包含 `audience_id`、`custom_audience_file_id`、`user_id_type`、`operation_type`、`process_status` 等字段。实现上将状态分为：

```text
SUBMITTED → PROCESSING/PENDING → SUCCEEDED | FAILED | TIMEOUT
```

状态字面量以实际响应为准，代码不得只依赖本地枚举。使用指数退避轮询（例如 1、2、4、8、15 分钟，上限 15 分钟），设置总超时并在失败/超时后告警。收到终态后，再通过 `custom_audiences/get` 确认人群本身的可用状态及覆盖量；不把“文件上传成功”当作“可投放”。

### 5.4 向投放模块交付

投放模块的输入契约应固定为：

```json
{
  "accountId": 123456,
  "includeAudienceIds": [67890],
  "excludeAudienceIds": [],
  "source": "tencent_marketing_api"
}
```

只有通过 5.3 可用校验的人群才能进入 `includeAudienceIds`/`excludeAudienceIds`。广告组创建或更新时所需定向字段会随广告产品、账户能力和 API 版本变化，实施时必须由投放模块按其对应的 `adgroups/add` 或 `adgroups/update` 官方页面验证字段名称与互斥规则；不要把未经该页面核验的 `targeting.custom_audience` 字段固化为通用契约。

## 6. 服务端模块划分

```text
OAuthCallbackService     处理回调、令牌加密入库、刷新令牌
TencentApiClient         统一注入 token/timestamp/nonce、超时、重试与脱敏日志
AudienceService          创建人群；维护 external_audience_id 幂等性
AudienceFileService      校验、上传、记录 custom_audience_file_id
AudiencePollingWorker    轮询文件与人群可用状态，发布状态事件
CampaignAdapter          只消费已可用 audience_id，完成投放侧版本化映射
```

所有 API 调用应携带内部 `request_id`。HTTP 重试只适用于连接超时、429 和可判定的 5xx；创建/上传请求发生网络超时后，先通过内部幂等记录及 `external_audience_id`/文件任务查询确认，再决定是否重发，避免重复建包或重复增量。

## 7. 验收清单

- [ ] 应用已获 Audience Management 权限，广告账户已完成授权。
- [ ] OAuth 回调校验 `state`，令牌加密存储并可自动刷新。
- [ ] 所有请求都注入唯一 `nonce` 和误差不超过 300 秒的 `timestamp`。
- [ ] 使用 `CUSTOMER_FILE` 建包，成功保存 `audience_id`。
- [ ] 上传为 multipart/form-data，zip 不超过 100 MB，一行一个同类标识。
- [ ] 成功保存 `custom_audience_file_id`，并轮询至终态。
- [ ] 仅在文件完成且人群可用后对投放模块暴露 `audience_id`。
- [ ] 原始标识、令牌、文件路径与响应中的敏感内容均已脱敏；具备删除/撤回（`REDUCE`）流程和审计记录。
- [ ] 在沙箱或非生产广告账户完成一次从建包到投放定向的端到端验证。

## 8. 官方核验入口

- [快速入门与 OAuth](https://developers.e.qq.com/docs/start)
- [人群管理总览](https://developers.e.qq.com/docs/api/audiences_management)
- [创建客户人群：custom_audiences/add](https://developers.e.qq.com/docs/api/audiences_management/custom_audience/custom_audiences_add)
- [上传客户人群文件：custom_audience_files/add](https://developers.e.qq.com/docs/api/audiences_management/custom_audience_file/custom_audience_files_add)
- [查询客户人群文件：custom_audience_files/get](https://developers.e.qq.com/docs/api/audiences_management/custom_audience_file/custom_audience_files_get)

