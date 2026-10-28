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

基本面研究平台负责来源、字段口径、历史可得时间、缺失提示、公式实现和结果可复现；用户选择分析方法、预测假设和投资结论。估值模板与市场验证是可选研究工具，不以策略盈利或价格兑现作为平台能力交付条件。 数据、计算与模型的具体边界见[基本面研究设计](docs/design/valuation-driven-fundamental-research.md)。

## 当前进度

**股票／ETF 研究与回测主链路已打通，正在按已定范围收敛系统功能**

- [x] monorepo 骨架(pnpm,对齐 `~/Projects/marginalia`、`~/Tools/fangtu`)
- [x] Tushare HTTP 数据通道 + 连通自测
- [x] 行情与研究数据落库(Prisma + SQLite:A 股、境内指数、ETF 和财报)
- [x] Factor(股票横截面、ETF 时间序列和跨资产 ETF Panel；宏观／利率模型已退役)
- [x] code-first 研究纪律(IC/IR、分层净值、市值中性化、费后、版本发布与绑定报告)
- [x] code-first 策略回测(股票 / ETF、参数扫描、成本与滑点、isolated-vm)
- [x] Web 研究工作台、统一 Agent 与中英文公开帮助
- [x] Signals 已退役：移除每日信号、策略部署、通知与执行账户；简化方案见 [裁剪计划](docs/design/system-simplification-plan.md)
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
apps/api/                          # Hono + Prisma 后端
  prisma/schema.prisma             # 行情、研究与用户数据
  src/index.ts                     # 进程入口；调用启动装配
  src/bootstrap.ts                 # 连接任务处理函数、启动恢复、队列与 HTTP
  src/server.ts                    # 构建 Hono 应用与挂载路由
  src/auth/                        # 登录、Session、邀请码；http/ 处理请求与 Cookie
  src/infra/database/prisma.ts     # 每进程/线程 Prisma client
  src/infra/http/                  # HTTP 错误、校验与请求语言
  src/infra/llm/                   # 模型供应商适配
  src/infra/email/                 # 邮件传输；登录邮件模板在 auth/
  src/infra/sandbox/               # 公共 Python 通信、TS isolate 与沙盒日志
  src/infra/jobs/                  # 任务契约、执行器、记录、日志与调度队列
  src/research/                    # 文档、依赖、执行、证据与 Agent 提案
  src/math/                        # 共用统计、推断与技术指标
  src/i18n/                        # 纯消息目录和翻译函数
  src/date.ts                      # 日期辅助
  src/market/providers/tushare/     # Tushare client + 接口封装
  src/market/stocks/                # 股票同步与读取；ETF、指数各归所属领域
  src/market/calendar/              # 交易日历、SSE 已完成日
  scripts/                         # probes / audits / sync dispatcher
packages/shared/                   # 共享类型(TsCode、TradeDate)
```

后端当前结构与调用链见 [架构阅读地图](docs/backend-architecture.md)，运行资源见 [入口清单](docs/backend-runtime-entries.md)，开发门禁见 [依赖边界](docs/backend-boundaries.md)。分轮进度与验收结果见 [开发计划](docs/design/backend-architecture-refactor.md)。

后端 Research 的文档、依赖、执行、证据与提案入口见 [Research 后端阅读入口](apps/api/src/research/README.md)。行情、领域数据与同步见 [Market](apps/api/src/market/README.md)，同步编排、分区覆盖与局部发布见 [Maintenance](apps/api/src/maintenance/README.md)。

## 快速开始

```bash
pnpm install
# 配置 apps/api/.env：DATABASE_URL 已默认，填 TUSHARE_TOKEN
pnpm --filter api db:migrate
pnpm data sync                   # 统一同步；首次回补也由有限批次持续推进
pnpm setup:sandbox               # 按需准备沙盒 SDK 声明、依赖清单与本地 Python 环境
pnpm dev                         # 同时启动 sandboxd、API 和 Web
```

`pnpm dev` 使用临时 Unix socket 和本机 Python 启动开发模式 sandboxd；退出时会一起清理三个服务。
按 Ctrl+C 后会显示停止进度；子服务先正常退出，超过 3 秒仍未退出则强制回收。终端输入由启动器保留，
组合启动时不提供 Vite / tsx 的交互快捷键，连续按 Ctrl+C 也会等待清理完成。
仅调试不涉及 Python 执行的单个进程时，仍可分别运行 `pnpm dev:api` 或 `pnpm dev:web`；需要 Python
Research、Factor 或 Strategy 时使用完整的 `pnpm dev`。

API 与 sandboxd 测试默认使用本机 `.venv/research-py-v1`，先运行 `pnpm setup:sandbox` 准备 CPython 3.13
和固定依赖。测试启动时校验环境，缺失或不兼容就报错，不回退到系统 Python；
`JIXIE_PYTHON_EXECUTABLE` 可覆盖解释器路径，但仍须通过相同校验。详见[测试 Python 说明](scripts/README.md#测试使用的-python)。

数据补齐统一运行 `pnpm data sync [--to YYYYMMDD]`；目标在启动时固定，来源各自按日历与可得时间推进。合法部分数据可用，缺项留待后续批次，历史回补无需独立 import。只读审计继续保留。生产安装与升级使用 `./scripts/bootstrap.sh`，详见 [`docs/deployment.md`](./docs/deployment.md)。

开发任务统一入口：

```sh
pnpm e2e --list                       # 浏览器验收与回归检查清单
pnpm e2e research-autosave            # 单项执行
pnpm e2e --group research --list      # 只查看分组；移除 --list 才执行
pnpm docs:images --list               # 帮助图片采集及标注
pnpm data sync --help                # 统一数据同步帮助
pnpm data sync --to 20260915          # 固定目标日期；不删除更晚的现有数据
pnpm data:audit --list                # 数据质量与覆盖审计
pnpm probe --list                     # 外部数据源连通性及能力探测
```

上述入口无参数均只显示帮助。详细运行条件见 [浏览器检查说明](apps/web/e2e/README.md) 和
[API 命令索引](apps/api/scripts/README.md)。

ETF 同步全量基础目录，默认按最新规模选择前 100；管理员通过 `pnpm data etf list/select-top/add/remove` 维护名单。指数使用 `pnpm data index list/add/remove`。日常同步不覆盖人工调整，移出保留历史。历史 ETF 份额／规模／净值研究接口已退役，最新规模仅用于名单。详见 [下载名单](apps/api/src/market/downloads/README.md)。
