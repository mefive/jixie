# Market 后端阅读入口

Market 负责行情和领域数据的获取、身份、同步、查询与市场分析。Research 的 SDK/数据集、Factor 的观察值、Strategy 的回测加载器和 Signals 的就绪检查消费这些能力；它们自己的流程仍归各自业务模块。

## 从问题找代码

| 要做什么 | 入口 | 职责 |
| --- | --- | --- |
| 查 HTTP 地址和参数 | [routes/index.ts](routes/index.ts) | `/api/app/market` 的 7 个 GET；解析请求、选择查询、映射无数据错误 |
| 改 Tushare 通道或配置 | [providers/tushare/](providers/tushare/) | 队列/限流/重试、协议、环境配置与能力探测 |
| 找 ETF、指数、基准清单 | [registry/](registry/) | 纯静态数据和校验；跨市场基准注册落库归 `cross-market/benchmark-sync.ts` |
| 解析证券代码和名字 | [instruments/](instruments/) | 历史身份、名称规则、身份校验与批量名称查询 |
| 查股票名录、行情与资金流 | [stocks/](stocks/) | 基础信息、日行情/复权/基础指标/涨跌停、资金流/龙虎榜及已有行情证券读取 |
| 查 ETF 每日与历史数据质量 | [etfs/](etfs/) | 按日发布、按证券回填、历史覆盖检查和注册表审计 |
| 查指数数据 | [indices/](indices/) | 指数/行业同步；`read.ts` 保留 HTTP 所用精简收盘序列 |
| 查期货共享同步 | [futures/sync.ts](futures/sync.ts) | 股指与商品共用合约、行情、主力映射和结算写入 |
| 查日历与已完成交易日 | [calendar/](calendar/) | 同步、开市日期读取、上海 16:00 截止及 SSE 已完成日；Signals 和 Maintenance 直接消费 |
| 查跨市场基准与外部驱动 | [cross-market/](cross-market/) | 基准注册/同步、人民币换算、美债与外汇联合同步及 PIT 可得日映射 |
| 查询跨资产价格序列 | [queries/instrument-series.ts](queries/instrument-series.ts) | 股票、ETF、指数与期货的统一对象序列 |
| 查市场状态或天气 | [state/](state/) | 指标同步落库、纯计算、状态/天气读取与缓存、市场风险输入序列及基础质量审计 |
| 读指数估值 | [valuation/](valuation/) | 纯计算、覆盖目录、官方估值与收盘序列读取 |
| 查财报来源、版本或指标 | [fundamentals/](fundamentals/) | 来源契约、财报/指标/分红同步、标准化、版本选择、指标与质量审计 |
| 查国债/信用曲线与利率可得性 | [rates/](rates/) | 国债、中债信用曲线；`government-yield-availability.ts` 只返回逐期限可得日期 |
| 查宏观发布与历史可得性 | [macro/](macro/) | 中国宏观、美国 CPI、as-of 选择、regime 分数、风险轴及质量 |
| 查商品专属能力 | [commodity/](commodity/) | 连续收益、持仓、仓单、carry 及其同步/维护/质量函数；共用期货写入调用 futures |

## 同步入口

| 文件 | 同步内容 | 主要调用方 |
| --- | --- | --- |
| `stocks/basic-sync.ts` | 股票基本信息、历史代码和名称 | 股票历史 CLI、周维护、代码规范化 |
| `calendar/sync.ts` | 交易日历范围替换；`calendar/read.ts` 单独读取开市日期 | 同步函数、各数据 CLI、Maintenance |
| `stocks/daily-sync.ts` | 股票价格/复权/基础指标/涨跌停，含 `syncDailyCoreDate` 四表发布门禁 | 日维护、自愈、Signals 同步、行情 CLI |
| `stocks/flows-sync.ts` | 龙虎榜和资金流 | 日维护、各自 CLI |
| `etfs/history-sync.ts` | ETF 基本信息、按证券回填历史行情/复权 | Signals、ETF CLI |
| `etfs/sync.ts` | 按交易日同步 ETF 行情/复权/规模，覆盖校验及修订刷新 | 周维护、修复和 ETF CLI |
| `indices/sync.ts` | 指数权重、元数据、行情/估值，申万行业成员与指数行情 | 日/周维护、Signals、指数/行业 CLI |
| `futures/sync.ts` | 股指/商品合约与日行情、主力映射、结算 | 日维护、Signals、期货 CLI |
| `state/sync.ts` | 市场/指数/行业派生指标的批量计算落库 | 日维护、修复、市场状态 CLI |
| `cross-market/benchmark-sync.ts` | CN/HK/US 固定基准的注册落库、来源解析与分段同步 | 日维护、跨市场基准 CLI |
| `cross-market/external-drivers.ts` | 美债与外汇联合获取、SSE 可得日映射及结果汇总 | 日维护、外部市场 CLI |
| `fundamentals/reference-sync.ts` | 财务指标、VIP 分期指标、分红及增量差异协调 | Maintenance 参考数据子进程 |

同步、读取和基础质量围绕数据领域聚合；旧 `sync/`、`quality/` 目录已移除，没有兼容转发。ETF 历史回填与按日发布保留各自覆盖/断点规则；股指与商品期货共享写入不复制，美债与外汇联合同步不拆成新事务。

## 数据事实与消费者政策

- HTTP 从 `routes/index.ts` 导出 `marketRoute`。查询返回数据或 `null`，路由映射 HTTP 响应；查询不依赖 Hono、用户会话或 Agent。
- `state/compute.ts` 和 `valuation/compute.ts` 不查询数据库。`state/sync.ts` 保留 SQL 批计算及临时表事务；天气缓存继续按原覆盖日期和频率/维度键失效。
- `calendar/sse-close.ts` 负责既有上海 16:00 截止判断和 SSE 最近已完成交易日；它不是通用跨市场收盘规则。Signals 的 `runs/readiness.ts` 继续决定信号日必须开市、必须已知下一交易日，并检查基础数据齐备。
- `rates/government-yield-availability.ts` 的 `loadGovernmentYieldAvailability(requiredTerms, tradeDate)` 逐期限读取 `availableDate <= tradeDate` 的最新国债曲线，保留缺失为空的事实。Factor 输入解析、14 天新鲜度和无利率依赖直接通过的规则归 [Signals](../signals/factor-inputs/rates.ts)。
- ETF 基础质量归 `etfs/history-coverage.ts` / `registry-audit.ts`；市场风险驱动基础质量归 `state/market-risk-driver-quality.ts`。Strategy 决定模型历史要求，Maintenance 组合整体审计及发布门禁。
- 同步中的候选校验和数据库替换属于 Market；运行锁、心跳、进度、发布水位和恢复属于 [Application Maintenance](../application-maintenance/README.md)。一个同步函数成功不等于整轮维护已发布。
- Market 不反向调用 Signals、Strategy、Agent、Research 或 Application Maintenance；共享能力根据实际数据职责保留，不设统一 execution/report 层。

财报版本、availableDate、币种转换、期货换月、覆盖阈值和数据单位均沿用原实现。此目录调整没有数据库表、迁移、HTTP 或 SDK 契约变更。

## HTTP 路由整理（2026-09-11）

`routes/index.ts` 直接组合 `routes/instrument.ts`、`routes/valuation.ts`、`routes/state.ts`。名称与统一行情入口使用 `/instruments/names`、`/instruments/:assetType/:instrumentId/series`；前端使用 fetchInstrumentNames / fetchInstrumentSeries。估值目录与详情统一在 `/index-valuations`、`/index-valuations/:indexCode`。

删除闲置 `/futures/:code/series`、其专用 `queries/future-series.ts` 和前端未使用的 fetchFutureSeries。统一 instrument 查询继续支持直接合约和按日映射的连续合约。删除旧 `/industry-weather` HTTP，`state/weather.ts` 的 loadIndustryWeatherSeries 保留，统一 `/weather?dimension=industry` 继续复用它。

`/indices/:indexCode/series` 保留原精简 `{ points: [{ date, close }] }` 响应、默认区间及空数组语义，与通用行情查询不合并。`/weather`、`/state` 的查询、缓存和数据口径不变。非法 instrument 类型改用中英消息目录，不改变 400 状态。

静态检查与待执行验证见 [统一路由记录](../../../../docs/design/api-route-naming.md#剩余模块路由整理2026-09-11)。人工代码审查后，相关 116 项测试、API/Web 构建和六组浏览器验收全部通过。临时服务、端口和数据库连接已释放，测试数据库已清理；完整结果见统一路由记录。

## 命令入口与数据维护

[cli/](cli/) 的 24 个命令负责参数、配置、输出、退出与进程收尾，允许保留简单同步组合；业务实现不导入 CLI。完整用法见 [API 命令索引](../../scripts/README.md)。

- `sync:stock-prices` 同步股票日行情与复权，先准备股票名录和日历；它替代原 `sync` 命令。
- [instruments/canonicalize-stock-codes.ts](instruments/canonicalize-stock-codes.ts) 负责历史代码冲突检查和市场数据合并，供本模块 CLI 与应用维护 weekly 使用；纯身份规则仍在 `instruments/stock-identity.ts`。
- [fundamentals/reference-periods.ts](fundamentals/reference-periods.ts) 负责财报历史起点和季度分期，供 weekly 与财报历史导入复用。
- 数据操作成功不等于整轮发布完成。[Application Maintenance](../application-maintenance/README.md) 负责协调等待、发布水位及下游信号；Market 不回调它。

## 目录约定

根级保留 `README.md` 与 `schema.ts`；整体 HTTP 测试位于 `routes/index.test.ts`，领域测试仍跟随实现。同步/读取/质量按数据领域归属，日历、身份、供应商与跨资产查询保留共享职责。
