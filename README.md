# 机械交易系 · jixie

境内 A 股量化研究平台 —— **因子研究 + 向量化回测**。

> 名字取自《机械交易系统》。"系"读作门派 / 学派,承载被动、机械、成体系的投资理念。
> 系统为何存在、功能取舍的底层依据见 [`docs/philosophy.md`](./docs/philosophy.md)(设计哲学:决策外骨骼)。

## 当前进度

**研究、回测与日常运行主链路已打通**

- [x] monorepo 骨架(pnpm,对齐 `~/Projects/marginalia`、`~/Tools/fangtu`)
- [x] Tushare HTTP 数据通道 + 连通自测
- [x] 行情落库(Prisma + SQLite:A 股、主要指数、期货、ETF)
- [x] code-first 因子研究(IC/IR、分层净值、中性化、费后、holdout 与不可变报告)
- [x] code-first 策略回测(股票 / ETF / 期货、参数扫描、成本与滑点、isolated-vm)
- [x] Web 工作台、统一 Agent、市场状态与中英文公开帮助
- [x] 每日信号、邮件提醒、模拟账户、人工成交回填、执行偏差与券商条件单清单
- [x] 生产 bootstrap、增量维护、数据审计与备份编排(待目标机连续运行验收)

**长期功能规划见 [`ROADMAP.md`](./ROADMAP.md)**(可信度 / 表达力 / 因子闭环 / 数据工程 / 每日信号五条主线),详设在 `docs/design/`。

## 技术栈

- pnpm monorepo,TypeScript + Node 20(纯 ESM)
- 后端 `apps/api`:Hono + Prisma 6 + SQLite
- 数据源:Tushare HTTP API
- **存储宗旨:ORM(Prisma)优先,实测性能扛不住才下沉 `$queryRaw`**(详见 `CLAUDE.md`)

## 目录

```
apps/api/                # Hono + Prisma 后端
  prisma/schema.prisma   # 股票 / 指数 / 期货 / ETF 行情与研究数据
  src/tushare/           # Tushare client + 接口封装
  src/store/             # 同步落库
  src/lib/prisma.ts      # Prisma client 单例
  scripts/               # smoke / sync / peek
packages/shared/         # 共享类型(TsCode、TradeDate)
```

## 快速开始

```bash
pnpm install
# 配置 apps/api/.env：DATABASE_URL 已默认，填 TUSHARE_TOKEN
pnpm --filter api db:migrate
pnpm import:data                 # 首次完整导入，可续传
pnpm dev:api                     # terminal 1
pnpm dev:web                     # terminal 2
```

日常数据补齐统一运行 `pnpm maintenance`；它会按连续发布水位自动判断缺失交易日。底层
`sync:*`、审计和研究脚本只用于开发与排障，不是生产部署步骤。生产机器无论首次安装还是升级都只运行
`./scripts/bootstrap.sh`，详见 [`docs/deployment.md`](./docs/deployment.md)。
