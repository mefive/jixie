# 机械交易系 · jixie

境内 A 股量化研究平台 —— **因子研究 + 向量化回测**。

> 名字取自《机械交易系统》。"系"读作门派 / 学派,承载被动、机械、成体系的投资理念。

## 当前进度

**第一期:引擎 + 数据(进行中)**

- [x] monorepo 骨架(pnpm,对齐 `~/Projects/marginalia`、`~/Tools/fangtu`)
- [x] Tushare HTTP 数据通道 + 连通自测
- [x] 行情落库(Prisma + SQLite:StockBasic / TradeCal / Daily / AdjFactor)
- [ ] 因子库(动量 / 反转 / 波动率)+ `FactorValue` 预计算表
- [ ] 向量化十分位分层回测(IC/IR、分层净值、Sharpe / 最大回撤)
- [ ] HTML 因子报告

**第二期**:`apps/web` 前端 + 回测任务 API + worker 隔离。

## 技术栈

- pnpm monorepo,TypeScript + Node 20(纯 ESM)
- 后端 `apps/api`:Hono + Prisma 6 + SQLite
- 数据源:Tushare HTTP API
- **存储宗旨:ORM(Prisma)优先,实测性能扛不住才下沉 `$queryRaw`**(详见 `CLAUDE.md`)

## 目录

```
apps/api/                # Hono + Prisma 后端
  prisma/schema.prisma   # StockBasic / TradeCal / Daily / AdjFactor
  src/tushare/           # Tushare client + 接口封装
  src/store/             # 同步落库
  src/lib/prisma.ts      # Prisma client 单例
  scripts/               # smoke / sync / peek
packages/shared/         # 共享类型(TsCode、TradeDate)
```

## 快速开始

```bash
pnpm install                                            # 装依赖（顺带构建 shared）
# 配置 apps/api/.env：DATABASE_URL 已默认，填 TUSHARE_TOKEN
pnpm --filter api exec prisma migrate dev --name init   # 建库 + 生成 Prisma Client
pnpm smoke                                              # 验证 token 连通
pnpm sync 20240101 20240131                             # 同步行情到 SQLite
pnpm peek 000001.SZ 20240101 20240131                   # 查看落库 + 后复权价
pnpm --filter api db:studio                             # 可视化浏览数据库
```
