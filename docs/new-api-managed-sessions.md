# New-API 托管会话

托管用户登录与刷新返回的访问令牌、刷新 Cookie、会话 ID 和有效期在服务端保存。访问令牌优先用于用户请求；到期或收到 401 时优先调用 `/api/user/auth/refresh`，只有刷新明确返回 401/403，或会话已到期时才重新登录。429 遵守 Retry-After；网络失败、409 和服务端错误保留刷新凭证，不通过新登录绕过错误。旧版 Cookie 登录仍可用。

`newapimanagedsessions` 是内部 MongoDB 集合，凭证使用 AES-256-GCM 加密，派生密钥取自 `NEW_API_MANAGED_USER_SECRET`（未设置时使用现有 `JWT_ACCESS_SECRET`）。密文绑定 New-API 服务地址、本地用户 ID 和远端用户 ID。该集合不通过任何用户/管理员 API 返回；默认查询不选出凭证字段。不要直接变更加密密钥，否则需要先规划会话迁移。

进程内合并并发登录/刷新；MongoDB 90 秒租约串行化跨进程刷新，等待最长 10 秒，失去租约后不允许保存。服务重启读取持久化凭证，复用原会话。部署时无须 SQL 结构迁移；集合在首次使用时创建，只使用 MongoDB 自带唯一 `_id`。凭证写入失败会报错，不把只保存在内存中的会话当作持久化成功。

回归：`cd apps/basic-server && node --test tests/newApiSession.test.cjs tests/newApiSessionStore.test.cjs tests/newApiRecharge.test.cjs`。测试使用模拟数据库和上游，不接触真实会话或余额。

线上遗留会话清理必须先确认本地用户与远端用户映射，备份目标用户完整 SQL 会话记录和待处理 SID 清单，再仅撤销清单内的服务器托管会话，并同步对应 Redis 会话拒绝缓存。保留撤销记录以便审计，不删除其他用户会话，不更改账号余额、API Key 或密码。恢复需核对备份，按 SID 处理；不可把旧会话备份直接全表覆盖到生产。
