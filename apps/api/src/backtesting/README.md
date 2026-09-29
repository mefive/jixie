# Backtesting 后端阅读地图

Backtesting 模拟交易：推进交易日、提供当时可得的数据、调用决策回调、执行待成交指令、维护账户和累计绩效。它不读取用户源码，不选择语言，不管理沙箱，也不处理回测任务或信号部署。

入口为 `new BacktestingEngine(config).run()`，每个实例只运行一次，统一返回 `{ result, finalState }`。
[StrategyExecution](../strategy/execution/execution.ts) 创建策略 runtime 和 FactorHost，注入决策回调、DataPort 与 FactorExecutionPort；它负责关闭这些外部资源。

## 从职责找文件

| 职责 | 入口 |
| --- | --- |
| 一次模拟的初始化、逐日推进、结果收集 | [BacktestingEngine](engine.ts) |
| 当前决策日的数据、因子和账户视图；转交订单声明 | [BacktestingContext](context.ts) |
| 收集决策、下个开盘执行、持久条件单及撤单 | [OrderBook](order-book.ts) |
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

默认 `finalState` 为 null；`retainFinalState` 开启末日因子观测和独立快照。快照保持复权单位，包含仓位、待执行指令、条件单与对应行情，不持有 EngineData 或账户实例。真实股数、参考价与业务信号由 [Signals 投影](../signals/runs/projection.ts) 产生。当前仍仅支持股票/ETF 快照，期货请求在读取行情前拒绝。

默认资金分配、成交算法、费用模型和 CSI 300 全收益基准保持原口径。`futureCloseTodayRate` 保留原配置含义，本轮不新增平今费率应用。策略作者 SDK、HTTP 入口及数据库 schema 不变；回测结果新增兼容性可选字段，旧报告仍可读取。

`resolveInitialCashWeights()` 统一确定初始资金比例；现金与期货账户始终创建，未启用期货时初始资金全部分配给现金账户。`futuresEnabled` 由 Engine 根据策略声明确定并传给 Context / OrderBook，控制期货行情访问、订单准入、换月/结算及分账户分析；账户是否存在或资金是否为零不表示功能启用状态。启用期货但分配零资金时仍允许声明订单，成交继续受保证金约束。

AllocationAnalysisTracker 始终创建与调用，归因范围固定为现金账户。输入为该账户初始资金、每日权益、实际持仓/成交和最终权益，不包含期货盈亏。无因子或分类时仍按 other 记录实际资产；缺少分类时不生成类别相关性/利率环境分析。零资金空账户输出有限的零盈亏和空归因。新报告包含 scope=cash_account 及账户 nav，风险后处理使用该序列；旧报告无 scope 时保持原口径。UI 和帮助明确区分范围。

## Review 与验证

优先阅读 BacktestingBacktesting → OrderBook → BacktestingContext → FactorEvaluator。股票、ETF、期货、条件单、归因、末日状态和因子测试随原入口迁移；新增实例生命周期、订单快照隔离和停牌价格可得性用例。业务验证覆盖 Strategy TS/Python runtime、Signals 投影、Worker、隔离与性能回归，不能只靠核心单测。

当前变更的审查与验证记录见 [执行命名与归属设计](../../../../docs/design/execution-naming-and-ownership.md)。
