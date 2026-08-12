# 机械交易系 · jixie

个人多市场量化研究实验室 —— **系统学习 + 数据分析 + 可复现研究 + 策略验证**。

> 名字取自《机械交易系统》。"系"读作门派 / 学派,承载被动、机械、成体系的投资理念。
> 系统为何存在、功能取舍的底层依据见 [`docs/philosophy.md`](./docs/philosophy.md)，系统学习范围见
> [`docs/learning-map.md`](./docs/learning-map.md)。

## 当前定位

jixie 用来借真实系统建设系统学习量化投资，以数据、代码和可复现证据代替单纯主观判断。研究范围不局限于
内地股票，目标覆盖中国内地、香港和美国市场的股票、债券与商品，并逐步打通因子、策略、资产配置和风险分析。

当前第一目标是学习理论、复现研究并构造强大的数据分析工具；模拟盘和实盘验证保留为长期阶段，不作为当前
功能建设的主径。长期目标是在真实成本、严格样本外和可执行性约束下，找到具有持续费后收益和良好 Sharpe、
Calmar 表现的策略组合，而不是在样本内直接优化漂亮指标。

## 当前进度

**境内市场研究、回测与日常运行主链路已打通，正在建设多市场研究能力**

- [x] monorepo 骨架(pnpm,对齐 `~/Projects/marginalia`、`~/Tools/fangtu`)
- [x] Tushare HTTP 数据通道 + 连通自测
- [x] 行情与研究数据落库(Prisma + SQLite:A 股、指数、ETF、期货、利率曲线、商品与宏观)
- [x] Factor V2 Phase 0–5(股票横截面、单资产时间序列、跨资产 Panel、宏观状态与组合风险研究)
- [x] code-first 研究纪律(IC/IR、分层净值、中性化、费后、holdout、不可变报告与不可变发布)
- [x] code-first 策略回测(股票 / ETF / 股指期货、参数扫描、成本与滑点、isolated-vm)
- [x] Web 工作台、统一 Agent、市场状态与中英文公开帮助
- [x] 每日信号、邮件提醒、模拟账户、人工成交回填、执行偏差与券商条件单清单
- [x] 生产 bootstrap、增量维护、数据审计与备份编排(待目标机连续运行验收)
- [ ] 中国内地、香港、美国股债商的统一证券身份、交易日历、币种、公司行动和 PIT 数据口径
- [ ] 从理论学习、对话式探索到冻结报告的可复现研究路径

**长期功能规划见 [`ROADMAP.md`](./ROADMAP.md)**；Factor V2 的完成边界和验收见
[`docs/design/factor-v2.md`](./docs/design/factor-v2.md)，大类资产数据与 PIT 口径见
[`docs/design/asset-allocation-data.md`](./docs/design/asset-allocation-data.md)。

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
