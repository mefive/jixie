# Market 后端阅读入口

Market 负责行情和领域数据的获取、身份、同步、查询与市场分析。Research 的 SDK/数据集、Factor 的观察值、Strategy 的回测加载器和 Signals 的就绪检查消费这些能力；它们自己的流程仍归各自业务模块。

## 从问题找代码

| 要做什么 | 入口 | 职责 |
| --- | --- | --- |
| 查 HTTP 地址和参数 | [routes.ts](routes.ts) | `/api/app/market` 的 7 个 GET；解析请求、选择查询、映射无数据错误 |
| 改 Tushare 通道或配置 | [providers/tushare/](providers/tushare/) | `client.ts` 的队列/限流/重试，`api.ts` 的协议，`config.ts` 的环境配置，能力探测与记录 |
| 找 ETF、指数、基准清单 | [registry/](registry/) | 纯静态数据和校验；导入清单不连接数据库。跨市场基准写库在 `sync/cross-market-benchmarks.ts` |
| 解析证券代码和名字 | [instruments/](instruments/) | `stock-identity.ts` 的历史代码与名称规则，`instrument-resolver.ts` 的身份校验，`names.ts` 的批量名称查询 |
| 同步股票、日历、ETF、指数或期货 | [sync/](sync/) | 按下表选择具体同步入口；各函数继续负责自己的校验、事务和断点语义 |
| 查询价格和跨市场换汇序列 | [queries/](queries/) | `instrument-series.ts` 的统一对象序列；指数收盘 HTTP 使用独立精简查询；`cross-market-benchmarks.ts` 的 CNY 基准换算；`stock-codes.ts` 的已有行情证券清单 |
| 读市场状态或天气 | [state/](state/) | `compute.ts` 纯计算；`read.ts` 查询并组装状态；`weather.ts` 查询、估值来源合并及进程内缓存；`market-risk-drivers.ts` 提供风险输入序列 |
| 读指数估值 | [valuation/](valuation/) | `compute.ts` 计算序列与分位；`read.ts` 读取覆盖目录、官方估值和收盘序列 |
| 查财报来源、版本或指标 | [fundamentals/](fundamentals/) | `source-contract.ts` 来源协议，`sync.ts` 财报同步，`reference-sync.ts` 财务指标/分红同步，`normalize.ts` 标准化，`resolver.ts` 版本选择，`metrics.ts` 指标，accounting-quality/valuation-sample-audit 质量审计 |
| 查利率与外部驱动数据 | [rates/](rates/) | 国债、中债信用曲线、外部市场驱动和对应就绪检查 |
| 查宏观发布与历史可得性 | [macro/](macro/) | 中国宏观、美国 CPI、as-of 选择、regime 分数、风险轴及质量 |
| 查商品期货数据 | [commodity/](commodity/) | 合约、连续收益、持仓、仓单、carry 及其同步/维护/质量函数 |
| 查基础数据质量 | [quality/](quality/) | ETF 注册表和市场风险输入审计；模型约束与整体报告组合见 Maintenance |

## 同步入口

| 文件 | 同步内容 | 主要调用方 |
| --- | --- | --- |
| `sync/stocks.ts` | 股票基本信息、历史代码和名称 | 股票历史 CLI、周维护、代码规范化 |
| `sync/calendar.ts` | 交易日历及开市日期读取 | 同步函数、各数据 CLI、Maintenance |
| `sync/stock-daily.ts` | 股票价格/复权/基础指标/涨跌停，含 `syncDailyCoreDate` 四表发布门禁 | 日维护、自愈、Signals 同步、行情 CLI |
| `sync/stock-flows.ts` | 龙虎榜和资金流 | 日维护、各自 CLI |
| `sync/etf-history.ts` | ETF 基本信息、按证券回填历史行情/复权 | Signals、ETF CLI |
| `sync/etf.ts` | 按交易日同步 ETF 行情/复权/规模，覆盖校验及修订刷新 | 周维护、修复和 ETF CLI |
| `sync/indices.ts` | 指数权重、元数据、行情/估值，申万行业成员与指数行情 | 日/周维护、Signals、指数/行业 CLI |
| `sync/futures.ts` | 股指/商品合约与日行情、主力映射、结算 | 日维护、Signals、期货 CLI |
| `sync/market-indicators.ts` | 市场/指数/行业派生指标的批量计算落库 | 日维护、修复、市场状态 CLI |
| `sync/cross-market-benchmarks.ts` | CN/HK/US 固定基准的注册落库、来源解析与分段同步 | 日维护、跨市场基准 CLI |
| `fundamentals/reference-sync.ts` | 财务指标、VIP 分期指标、分红及增量差异协调 | Maintenance 参考数据子进程 |

原 `store/sync.ts` 已按现有函数组拆开，不提供兼容转发总入口。ETF 的历史回填与按日市场级发布本来具有不同的覆盖/断点规则，分别保留，不合并成通用同步框架。四个子领域内原有组织整体保留；同步函数可以留在其业务所在领域。

## 读取与发布的边界

- HTTP 由 `server.ts` 从根级 `routes.ts` 导入并挂载 `marketRoute`。请求进入查询函数，查询函数返回数据或 `null`，路由再映射 HTTP 响应。查询不依赖 Hono、用户会话或 Agent。
- `state/compute.ts` 和 `valuation/compute.ts` 不查询数据库。`weather.ts` 的缓存仍按原覆盖日期和频率/维度键失效；这次不改变同日数据修订的缓存策略。
- `sync/market-indicators.ts` 原有 SQL 批计算及临时表事务保持；它与读取侧 `state/compute.ts` 分别处理落库指标和展示投影，不为目录重整重写 SQL 算法。
- 同步中的候选校验和数据库替换属于 Market；运行锁、心跳、进度、质量发布水位和恢复属于 [Maintenance](../maintenance/README.md)。一个同步函数成功不等于整轮维护已发布。
- Market 不导入 Strategy、Agent 或 Research 执行。策略风险模型的历史要求归 `strategy/analysis/risk`，由 `maintenance/risk-data-audit.ts` 与市场基础审计组合。

财报版本、availableDate、币种转换、期货换月、覆盖阈值和数据单位均沿用原实现。此目录调整没有数据库表、迁移或 SDK 契约变更。


## HTTP 路由整理（2026-09-11）

`routes.ts` 直接组合 `instrument-routes.ts`、`valuation-routes.ts`、`state-routes.ts`。名称与统一行情入口使用 `/instruments/names`、`/instruments/:assetType/:instrumentId/series`；前端使用 fetchInstrumentNames / fetchInstrumentSeries。估值目录与详情统一在 `/index-valuations`、`/index-valuations/:indexCode`。

删除闲置 `/futures/:code/series`、其专用 `queries/future-series.ts` 和前端未使用的 fetchFutureSeries。统一 instrument 查询继续支持直接合约和按日映射的连续合约。删除旧 `/industry-weather` HTTP，`state/weather.ts` 的 loadIndustryWeatherSeries 保留，统一 `/weather?dimension=industry` 继续复用它。

`/indices/:indexCode/series` 保留原精简 `{ points: [{ date, close }] }` 响应、默认区间及空数组语义，与通用行情查询不合并。`/weather`、`/state` 的查询、缓存和数据口径不变。非法 instrument 类型改用中英消息目录，不改变 400 状态。

静态检查与待执行验证见 [统一路由记录](../../../../docs/design/api-route-naming.md#剩余模块路由整理2026-09-11)。人工代码审查后，相关 116 项测试、API/Web 构建和六组浏览器验收全部通过。临时服务、端口和数据库连接已释放，测试数据库已清理；完整结果见统一路由记录。
