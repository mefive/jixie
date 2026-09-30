# Backtesting 后端阅读地图

Backtesting 模拟交易：推进交易日、提供当时可得的数据、调用决策回调、执行待成交指令、维护账户和累计绩效。它不读取用户源码，不选择语言，不管理沙箱，也不处理回测任务或信号部署。

入口为 `new BacktestingEngine(config).run()`，每个实例只运行一次，统一返回 `{ result, finalState }`。
[StrategyExecution](../strategy/execution/execution.ts) 创建策略 runtime 和 FactorHost，注入决策回调、DataPort 与 FactorExecutionPort；它负责关闭这些外部资源。

## 从职责找文件

| 职责 | 入口 |
| --- | --- |
| 一次模拟的初始化、逐日推进、结果收集 | [BacktestingEngine](engine.ts) |
| 当前决策日的数据、因子和账户视图；转交订单声明 | [BacktestingContext](context.ts) |
| 收集决策、次日指令执行与盘中条件单模拟、撤单 | [OrderBook](order-book.ts) |
| 股票/ETF 现金、持仓、T+1 和成交记账 | [CashPortfolio](cash-portfolio.ts) |
| 期货保证金、换月、结算和成交记账 | [FuturesPortfolio](futures-portfolio.ts) |
| 净值与成交绩效统计 | [performance.ts](performance.ts) |
| 逐日持仓、成本、再平衡归因累计 | [allocation-analysis.ts](allocation-analysis.ts) |
| 行情读取端口与缓存、PIT、复权语义 | [data-port.ts](data/data-port.ts)、[EngineData](data/engine-data.ts) |
| 因子输入准备、批量计算、当日缓存与数值合成 | [FactorEvaluator](factors/evaluator.ts) |
| 因子定义与外部计算契约 | [execution-port.ts](factors/execution-port.ts) |
| 因子宿主描述的数据需求、证券范围与资产分类 | [describeFactors](factors/description.ts) |
| 宿主数据库适配 | [prisma-port.ts](adapters/prisma-port.ts) |
| 多个测试共用的确定性数据源 | [fixture-port.ts](testing/fixture-port.ts) |

类型跟随职责：行情类型在 `data/market.ts`，决策接口与 BacktestingConfig 在 `contract.ts`，成本在 `cost.ts`，当前成交联合类型在 `trade.ts`，模拟输出在 `result.ts`，持仓随账户类。没有根级 `types.ts` 汇总所有定义。

## 一天如何推进

股票与多资产共用一份循环、上下文和订单处理：检查退市持仓 → 开盘换月及执行昨天的指令 → 期货结算 → 收盘计价与归因 → 准备因子 → 调用策略 → 保存下次待执行指令。

`OrderBook` 保持原来的顺序：期货换月、现金账户目标调仓、增减股数/手数、清理已清仓条件单、条件单成交、期货目标指令。条件单跨天保存；普通指令按原有规则处理一次。`BacktestingContext` 持有当日懒加载截面，账户和订单状态分别由 Portfolio 和 OrderBook 持有。

纯验证、成交价格计算和绩效统计保留函数。类用于持有生命周期和状态，不把无状态函数包装成 Runner。

## 数据与因子

`EngineData` 接收具名配置，其中 `dataPort` 必填。它不选择数据库。价格方法区分精确交易日与截至当日：`adjustedOpenOn`、`adjustedOhlcOn`、`adjustmentFactorOn` 只取当天；`adjustedCloseAsOf`、`adjustmentFactorAsOf` 可沿用过去的值。`adjusted` 表示复权单位，停牌估值可以沿用收盘价，成交不能凭空补出开盘价。

`FactorEvaluator.evaluate({ date, codes, crossSection })` 组织因子输入并调用计算端口；`read` 读取并固定当日该因子/证券的值。未被读取的预计算值仍可在补充行情后刷新。`FactorExecutionPort.describe()` 返回独立的 FactorDescription 快照（definitions、dataRequirements、preloadCodes、assetClassByCode），组合输入需求由组件定义派生；重复顶层 ID、缺失声明或缺少执行端口在加载行情前拒绝。

因子源码识别及依赖准备归 [StrategyFactor](../strategy/factors/factor.ts)，TS/Python 因子沙箱归 [FactorHost](../strategy/execution/factor-host.ts)。Backtesting 不接收 StrategyFactor 或源码模块。FactorEvaluator 只求值，不创建或维护 runtime。

Engine 创建并持有 FactorEvaluator，将因子定义数组与计算依赖传入。FactorEvaluator 内部建立 ID 索引，并在实例生命周期内对每个因子只回调首次输入错误；Engine 负责日志格式与输出。执行端口抛出的异常仍向上传播。

FactorHost 在初始化后调用 `describeFactors(definitions)`，汇总因子所需的换手率历史、财务历史、国债曲线及已批准研究资产分类，校验分类冲突。Engine 直接消费描述，将策略 watch 与宿主 preloadCodes 合并去重，并合并 Tracker 声明的利率数据需求，不解析因子内部资产结构。

`EngineData.load()` 完成基础数据后，一批加载 `preloadCodes` 行情，再按需预加载财务历史。证券来源不进入数据层；运行中仍可通过 `loadBars()` 动态补充，财务数据未要求预加载时仍按截面读取懒加载。合并预加载后查询批次和失败时序改变，成功后的缓存范围保持。

EngineContext / EngineStrategy 是内部模拟契约，公开 StrategyCtx 仍由 shared SDK 契约定义；[Strategy bridge](../strategy/runtime/bridge.ts) 适配两者。TS SDK bundle 不包含 Engine、Prisma 或宿主能力，沙箱不能访问 DataPort。

## 模拟输出与业务结果

`BacktestingResult` 只包含净值、成交和绩效。当前成交使用 `CashTrade | FuturesTrade`，期货必须包含合约、数量及乘数；旧持久化报告的可选字段兼容与 `factorDependencies` 归 [BacktestResult](../strategy/backtests/result.ts)。Backtesting 不再携带报告血缘。

`BacktestingEngine.run()` 直接返回回测结果。运行成功后，调用方可显式调用异步 `collectFinalState()`：先按需加载末日持仓及待执行现金订单的行情，再返回独立、可序列化的双账户快照。该操作可能查询 DataPort 并失败；运行前、运行中和运行失败后拒绝读取。每次返回独立副本，快照失败不改变已完成的回测结果，可重试读取。末日始终记录策略实际读取的计算因子值，不额外执行因子计算；其他日期不保留观测。真实股数、参考价与业务信号由 [Signals 投影](../signals/runs/projection.ts) 产生。

默认资金分配、成交算法、费用模型和 CSI 300 全收益基准保持原口径。`futureCloseTodayRate` 保留原配置含义，本轮不新增平今费率应用。策略作者 SDK、HTTP 入口及数据库 schema 不变；回测结果新增兼容性可选字段，旧报告仍可读取。

`resolveInitialCashWeights()` 只读取 accounts，默认 stock=1、futures=0；显式权重必须有限、非负且合计为 1。旧 futures 字段兼容接收但被忽略，不启用功能、不改变资金或约束可交易代码。现金与期货账户始终创建，订单/结算/日志/分账户净值统一执行；空账户没有持仓可结算，零资金订单继续受余额/保证金约束，无账户间自动转账。EngineData 统一读取区间期货合约、行情、映射与保证金数据；缺行情的查询返回空，无法执行的订单不成交。纯股票策略也会读取期货数据，增加一批数据访问，不再维护独立的启用状态。

AllocationAnalysisTracker 始终创建与调用，归因范围固定为现金账户。输入为该账户初始资金、每日权益、实际持仓/成交和最终权益，不包含期货盈亏。无因子或分类时仍按 other 记录实际资产；缺少分类时不生成类别相关性/利率环境分析。零资金空账户输出有限的零盈亏和空归因。新报告包含 scope=cash_account 及账户 nav，风险后处理使用该序列；旧报告无 scope 时保持原口径。UI 和帮助明确区分范围。

## Review 与验证

优先阅读 BacktestingEngine → OrderBook → BacktestingContext → FactorEvaluator。股票、ETF、期货、条件单、归因、末日状态和因子测试随原入口迁移；新增实例生命周期、订单快照隔离和停牌价格可得性用例。业务验证覆盖 Strategy TS/Python runtime、Signals 投影、Worker、隔离与性能回归，不能只靠核心单测。

当前变更的审查与验证记录见 [执行命名与归属设计](../../../../docs/design/execution-naming-and-ownership.md)。

## OrderBook 执行边界

Engine 初始化时一次注入共享账户、EngineData、成本、AllocationAnalysisTracker 和 `onRebalance(date)`；每日调用 `executeOrders(date, previousDate)`，之后由 Engine 结算、记录收盘并调用 onBar。previousDate 保留期货映射的决策时点。

OrderBook 分开持有当前 decision、待执行 PendingOrders 和持续 conditionalOrders。待执行目标、股数／手数和期货意图在各自步骤成功返回后消费；失败保留当时中间状态。空目标 Map 仍执行清仓、归因和通知，null 表示没有调仓。调仓通知紧随归因与目标消费，早于后续现金和期货指令。

`snapshotCashOrders()` 保持现金订单消费者契约并深拷贝 Map 和条件单对象，不暴露内部 PendingOrders。条件单先处理退出、再限价买入，最后更新保留移动止损的高水位。

本轮重构范围、审查和验证状态见 [OrderBook 重构记录](../../../../docs/design/order-book-refactor-plan.md)。

OrderBook 将行情、账户、成本、归因与通知保存为明确的私有只读依赖。涨跌停检查、滑点价格、可卖日期、期货名义金额换算和待执行股数／手数合并由私有方法读取依赖及 pending；执行日期和映射日期仍显式传入。无实例依赖的校验、状态工厂与条件候选计算保留为局部函数。滑点回归通过真实成交入口验证。

Engine 使用 `beginOrderCollection(date)` 收集，通过 Context 接收策略指令，再调用 `commitCollectedOrders()`。`snapshotFuturesOrders()` 返回已提交的期货原始意图。`collectFinalState()` 返回可 JSON 往返的 schemaVersion=2 快照：现金持仓、条件单、期货账户、意图及末日市场证据均为纯对象/数组，不含 Map。Signals 通过 `strictFutures` 对实际读取的期货数据执行严格检查，普通回测保留原缺数据规则。

期货持仓计算由 `futures-accounting.ts` 的纯成交/结算函数共享；自动换月仍由 FuturesPortfolio 保留原子预检语义。实际录入可表达部分平旧/开新和负可用资金，不能把模拟保证金拒单当作撤销真实成交。

Signals 前向账户模拟使用 `loadExecutionOrders({ cashOrders, futuresOrders })` 一次装载独立执行批次，不经过策略收集／提交。装载复制输入，替换现金与期货待执行状态及持续条件单，不恢复策略 runtime，也不提供调仓归因决策日期。期货意图按输入顺序沿用策略入口的参数校验、取整、delta 累积及目标覆盖规则；自动换月不作为显式意图装载。
