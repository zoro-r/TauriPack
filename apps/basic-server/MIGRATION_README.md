# 数据库迁移指南

## 概述

此迁移脚本用于将本地MongoDB数据迁移到生产服务器：`47.116.188.179:27017/niushan`

## 迁移内容

脚本会迁移以下数据表：
- ✅ `User` - 用户数据
- ✅ `WechatUser` - 微信用户数据  
- ✅ `Asset` - 资产数据
- ✅ `DailyPrice` - 每日价格数据（新增）
- ✅ `TradingRecord` - 交易记录
- ✅ `Article` - 文章数据
- ✅ `File` - 文件数据
- ✅ `Diary` - 日记数据
- ✅ `Fragment` - 片段数据
- ✅ `Book` - 书籍数据
- ✅ `Quote` - 名言数据
- ✅ `BuyingPlan` - 购买计划
- ✅ `Schedule` - 日程数据
- ✅ `Valuation` - 估值数据
- ✅ `Verification` - 验证数据

## 使用方法

### 方法1: 交互式迁移（推荐）
```bash
# 进入服务器目录
cd packages/server

# 执行交互式迁移脚本
pnpm run migrate:interactive
```

### 方法2: 直接执行
```bash
# 进入服务器目录
cd packages/server

# 直接执行迁移
pnpm run migrate
```

### 方法3: 手动执行
```bash
# 进入服务器目录
cd packages/server

# 使用ts-node执行
npx ts-node -r tsconfig-paths/register src/scripts/migrateDatabase.ts
```

## 安全特性

### 🔒 智能去重
- **UUID优先**: 如果记录有UUID，优先使用UUID检查重复
- **ID回退**: 如果没有UUID，使用MongoDB的_id检查重复
- **增量迁移**: 只迁移新增数据，避免重复插入

### 📊 详细统计
- 源数据库记录数量
- 目标数据库已有记录数量  
- 本次迁移的新增记录数量
- 跳过的重复记录数量
- 错误记录数量和详情

### ⚡ 批量处理
- 每批处理100条记录，避免内存溢出
- 实时显示迁移进度
- 单条记录错误不影响整批处理

## 迁移过程示例

```
🚀 开始数据库迁移...
📍 源数据库: mongodb://localhost:27017/nioshandb
📍 目标数据库: 47.116.188.179:27017/niushan

📦 开始迁移 User...
📊 源数据库中有 5 条 User 记录
📊 目标数据库中已有 2 条 User 记录
🔄 处理批次 1/1 (5 条记录)
✅ User 迁移完成:
   - 新增: 3
   - 跳过: 2  
   - 错误: 0

📦 开始迁移 Asset...
...

📋 迁移总结:
═══════════════════════════════════════════════════════════
User            | 源:    5 | 新增:    3 | 跳过:    2 | 错误:  0
Asset           | 源:   15 | 新增:   10 | 跳过:    5 | 错误:  0
DailyPrice      | 源:  120 | 新增:  120 | 跳过:    0 | 错误:  0
...
──────────────────────────────────────────────────────────
总计            | 新增:  150 | 跳过:   20 | 错误:  0

⏱️  耗时: 12秒
🎉 迁移成功完成！
```

## 注意事项

### ⚠️ 迁移前检查
1. **确保本地数据库可访问**: `mongodb://localhost:27017/nioshandb`
2. **确保目标服务器网络连接**: `47.116.188.179:27017`
3. **确保有足够的磁盘空间**
4. **建议在非高峰期执行迁移**

### 🔧 环境变量
如果本地MongoDB连接不是默认配置，设置环境变量：
```bash
export MONGODB_URI="mongodb://localhost:27017/your_db_name"
pnpm run migrate
```

### 🚨 错误处理
- 单条记录迁移失败不会中断整个过程
- 所有错误都会被记录并在最后显示详情
- 如果出现连接错误，请检查网络和数据库配置

## 迁移后验证

建议迁移完成后进行以下检查：

1. **数据数量验证**：对比迁移前后的记录数量
2. **关键数据检查**：抽查重要数据是否正确迁移
3. **应用功能测试**：确保应用在新数据库上正常工作

## 支持

如果遇到问题，请检查：
1. 网络连接是否正常
2. 数据库凭据是否正确
3. MongoDB服务是否正在运行
4. 是否有足够的权限访问目标数据库
# API Wallet Recharge

API wallet recharge uses the existing WeChat Native payment callback. Configure both values below to enable fixed recharge options:

```env
NEW_API_QUOTA_PER_YUAN=500000
NEW_API_RECHARGE_AMOUNTS=10,50,100
```

`NEW_API_QUOTA_PER_YUAN` is the API quota credited for each CNY 1. The values in `NEW_API_RECHARGE_AMOUNTS` are the only user-selectable payment amounts. Payment settlement is idempotently recorded before the user account is credited.
