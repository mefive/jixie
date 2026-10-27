# Backtesting 后端阅读地图

Backtesting 负责股票／ETF 现金账户模拟：推进交易日、提供当时可得的数据、调用决策、执行待成交指令、维护账户并累计绩效。它不读取用户源码、不选择语言，也不管理沙箱或任务。

`new BacktestingEngine(config).run()` 每个实例只能运行一次，返回 `BacktestingResult`。[StrategySimulation](../strategy/simulation/strategy-simulation.ts) 注入决策回调、DataPort 和 FactorExecutionPort，负责关闭外部沙箱资源。

| 职责 | 入口 |
| --- | --- |
| 初始化、逐日推进、结果收集 | [BacktestingEngine](backtesting-engine.ts) |
| 当日数据、因子和现金账户视图 | [BacktestingContext](backtesting-context.ts) |
| 收集决策、次日执行、持续条件单 | [OrderBook](order-book.ts) |
| 股票／ETF 现金、持仓、T+1 和成交记账 | [CashPortfolio](cash-portfolio.ts) |
| 净值与成交绩效 | [performance.ts](performance.ts) |
| 每日持仓、成本与再平衡归因 | [allocation-analysis-tracker.ts](allocation-analysis-tracker.ts) |
| 数据端口与行情缓存 | [data-port.ts](data/data-port.ts)、[EngineData](data/engine-data.ts) |
| 因子输入、求值和当日缓存 | [FactorEvaluator](factors/factor-evaluator.ts) |
| 因子执行和元数据端口 | [execution-port.ts](factors/execution-port.ts)、[description.ts](factors/description.ts) |
| 数据库适配与共用测试数据 | [prisma-port.ts](adapters/prisma-port.ts)、[fixture-port.ts](testing/fixture-port.ts) |

## 每日顺序

检查退市持仓 → 执行昨日现金指令与条件单 → 收盘计价和归因 → 准备因子 → 调用策略 → 保存下次待执行指令。

`OrderBook.executeOrders(date)` 依次处理目标调仓、增减股数／手数、清理已清仓条件单、条件单成交。条件单跨天保存，普通指令只处理一次。`beginDecision(date)` 和 `commitDecision()` 分开保存当前决策与待执行指令。

增量累加，后续目标覆盖同类目标。完整目标表不能与增量单混用；空目标表表示清仓，null 表示未调仓。`closePosition` 覆盖同标的此前普通指令，之后的增量报错。清仓仍受停牌、涨跌停及可卖数量约束，持续条件单单独处理。`snapshotCashOrders()` 返回深拷贝。

## 数据与因子

`EngineData` 必须接收 DataPort。精确日期成交行情不会沿用旧值；估值可以读取截至当日的最近收盘。因子宿主汇总行情、财务历史和国债曲线需求，再注入 `FactorEvaluator`；引擎不解析源码，也不直接装配数据库或语言 runtime。

全部初始资金进入现金账户。期货账户、订单、结算、换月、行情和数据端口已删除；旧 `accounts`、`futures` 声明或期货成本字段在初始化拒绝，期货代码在行情加载拒绝，不按现金资产替代。

股票／ETF 的复权、T+1、涨跌停、整手约束、成本、滑点、条件单及沪深 300 全收益基准保持既有口径。

## 输出与末日状态

`BacktestingResult` 输出现金净值、成交与绩效。AllocationAnalysisTracker 使用同一账户初始资金、每日实际持仓／成交及期末权益对账；缺少研究分类时记录 other，不生成类别相关性／利率环境分析。

成功运行后可显式调用 `collectFinalState()`，返回 schemaVersion=2 的独立现金持仓、待执行订单、条件单、末日行情证据及已读取因子观测。它可能按需读取行情并失败，可重试，不改变已完成结果。运行前、运行中或运行失败后拒绝读取。所有状态可 JSON 往返，不返回 Map 或内部对象引用。

已有持久化用户源码、发布版本和报告不被改写。旧源码调用退役接口时明确报错。审查与验证状态见 [系统裁剪计划 §25](../../../../docs/design/system-simplification-plan.md)。
