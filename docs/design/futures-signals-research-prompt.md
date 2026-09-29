# 新 session：研究并设计期货 Signals 的完整落地

以下内容可直接作为新 session 的任务 prompt。

---

请在 `/Users/liucong/Projects/jixie` 中研究如何让 Signals 完整支持期货及股票／期货混合策略，并形成可审查、可执行的落地方案。先研究、核对现状和提出设计，不要直接移除限制或开始产品实现。方案获得确认后，再按约定工作流实施。

## 开始前

完整阅读根目录 `AGENTS.md`、`CLAUDE.md`、`/Users/liucong/.codex/skills/review-gated-development/SKILL.md`，检查 Git 状态并保留已有修改。涉及前端和公开文档实现时阅读 `apps/web/CLAUDE.md`。遵循 review-gated-development：先确认完整范围与准确提交消息，实施并做静态检查，人工审查批准后才运行行为验证和构建；必需验证全部通过后直接提交，不推送，清理测试服务并展示验收截图。

请先阅读：

- `docs/design/order-book-refactor-plan.md`
- `apps/api/src/backtesting/README.md`
- `apps/api/src/strategy/execution/README.md`
- `apps/api/src/signals/README.md` 及 deployments、runs、accounting 子目录 README
- `docs/design/daily-signals.md`
- `docs/design/core-business-service-boundaries.md` 中 Signals 的已记录限制

以当前代码为事实源，不将旧设计中的启用开关或旧命名恢复回来。

## 目标与已确定边界

目标不是仅在页面显示一条期货提示，而是使已有 Signals 链路能够正确表达、持久化、模拟执行、记录人工成交并核对期货账户，支持混合账户；不接券商、不扩展自动实盘交易。

已有设计必须延续：

- 现金账户与期货账户始终存在；不恢复 futuresEnabled、stockOrdersEnabled。
- accounts 决定初始资金，默认现金账户 100%、期货账户 0%；旧 futures 字段兼容接收但忽略，不作为能力开关或可靠的数据需求清单。
- 账户资金独立，不能自动跨账户转账。零资金不代表接口禁用，订单受实际余额／保证金约束。
- Engine 推进交易日、调用策略并安排每日结算；OrderBook 收集和执行指令，账户类承担记账。
- 因子描述属于因子侧；AllocationAnalysisTracker 始终存在，只分析现金账户，不将期货盈亏混入现金归因。
- 保留现有执行顺序、精确执行日行情和之前已知的期货映射，不使用未来信息。
- 明确本次支持的合约范围，以当前引擎已支持的交易产品为基线，不顺带开放研究专用商品期货、夜盘或其他市场。
- Python 策略部署限制是独立议题，不因支持期货 Signals 而顺带解除。

OrderBook 最近已完成执行职责及封装重构：`d268ce8e`、`dd8a7f79`；后续命名以当前 HEAD 为准。Engine 侧入口为 `beginOrderCollection(date)`、`commitCollectedOrders()`、`executeOrders(date, previousDate)`、`hasCollectedFuturesOrders` 和 `snapshotCashOrders()`。不要重复这轮结构整理，也不要为了期货支持先合并或删除策略下单入口。

## 现有问题和限制的来源

Signals 的 `runSignal` 调用 StrategyExecution，设置 retainFinalState，之后用 projectSignals 生成下一交易日信号。当前 BacktestingFinalState 仅保存现金账户持仓、现金订单、行情和因子观测；Signals 类型、执行记录和账户重放也主要按股票／ETF建模。

当前防护包括部署入口的 futures_unsupported、Engine 对期货资金配置及当前收集期货指令的拒绝。它们防止快照和信号静默遗漏期货状态，不是期货回测本身不受支持。必须补齐消费者契约后再移除防护，不能仅给 assetType 增加 future。

## 必须研究并给出决策的问题

### 1. 完整的双账户状态契约

核对 Engine.collectFinalState、OrderBook 快照、BacktestingFinalState、StrategyExecution 输出与 Worker 协议。设计可独立传输、无实例引用的快照，说明现金与期货账户、保证金、实际合约、持仓手数、乘数、结算参考价、待执行指令及所需市场信息各自归属。

区分“用于生成信号的末日状态”和“可恢复整个引擎运行的检查点”，不要未经需求确认就实现完整引擎恢复。明确现有 snapshotCashOrders 是否保留、完整快照在哪里组合，以及是否仍需要 hasCollectedFuturesOrders 这一防护查询。

### 2. 收盘信号与执行时点

这是核心待决策问题，不能预设已获用户批准：信号究竟是固定成交清单，还是包含执行条件的交易意图？建议重点评估保留原始意图、显示参考数量并在执行时解析最终数量的方案，比较复杂度、可解释性和人工执行可行性。

逐项讨论 delta、目标手数、目标名义金额、hedge、退出和换月：

- 名义金额换算手数使用哪个时点的价格；收盘估算不得伪装为次日精确结果。
- hedge 使用现金订单及条件单执行后的实际现金敞口；如何处理 model、simulation、actual 三套账户的差异。
- 实际手数与对冲依据尚未确定时，页面和通知如何表达，以及如何形成最终可录入的成交指令。
- 连续逻辑代码如何映射实际合约，如何记录映射依据和数据截止日。
- 没有显式策略期货指令时，自动换月如何产生信号；显式退出如何抑制自动换月。
- 自动换月与显式平旧开新已有失败语义可能不同，不要假定两条腿原子成交，也不要在支持 Signals 时顺带改变回测规则。
- 空仓退出、零资金、未成交、部分成交、跨日残留的语义。

请给出具体例子和时序，避免用一个通用 submit 接口掩盖上述业务差异。

### 3. Signals 契约和持久化

检查 shared Signals 类型、HTTP schema、runs/result-schema、Job / Worker 消息、SignalRun、SignalExecution、StrategyAccountSnapshot。

区分现金股数与期货手数、逻辑代码与实际合约、买卖方向与开平含义、名义敞口与保证金。说明原始意图、参考估算、模拟成交及人工成交之间如何关联，换月两腿如何关联。

给出旧部署、旧信号、旧账户快照的兼容读取和迁移方案；需要改 Prisma schema 时按项目要求生成 migration，不手写生成物。不要将内部数据库模型直接变成公开契约。

### 4. 账户记账与复用

核对 Signals accounting 的 initialize、settlement、executions、replay、read、quotes 和 FuturesPortfolio。

设计期货的保证金占用、费用、开平仓盈亏、每日结算、换月、数据缺失及人工成交回填后的确定性重放。没有下单的交易日也需要正确结算。

评估复用现有期货计算／记账能力的具体边界，避免复制一套会与回测漂移的模型；也不能直接将依赖开盘行情的模拟成交入口用于人工成交。清楚区分本次必须的抽取与不必要的通用账户框架。

保留或明确讨论已有事务边界、重放失败和并发风险，不将这些问题偷偷当作纯命名重构处理。

### 5. 数据准入与产品展示

核对每日同步、Maintenance 发布和手动生成链路，对合约元数据、映射、实际合约行情、结算价、保证金及交易日历制定完整性／新鲜度检查。缺数据明确报错，不补用未来数据，不恢复旧 futures 配置开关。

梳理部署准入、页面、人工成交表单、通知、帮助及中英双语文案。清楚呈现手数、方向、合约、名义敞口、保证金和模型／实际差异，现金账户归因范围保持不变。

## 交付要求

先产出一份落盘设计文档，并向用户汇报：

1. 当前链路与限制的证据，附关键文件和调用关系。
2. 推荐方案、备选方案、取舍及真正需要用户拍板的问题，尤其是动态对冲信号的语义。
3. 完整影响范围：引擎、Signals、共享类型、Worker、数据库迁移、前端、文档及数据准备。
4. 可审查的实施安排和准确提交消息。不要人为切成只显示信号却不能记账的半成品；如需多个提交，解释依赖和完整验收边界，并等待确认。
5. 回归和验收矩阵：纯现金兼容、纯期货、混合账户、跳空后名义金额换算、现金成交不足后的对冲、自动换月、显式退出、平旧成功开新失败、保证金不足、零资金、无成交日结算、人工成交偏离／回填重放、缺数据和旧记录兼容。
6. 静态检查与审查后测试／构建／隔离 E2E 计划，使用合成行情和隔离数据库，不写生产数据。

研究阶段不要修改产品行为，不承诺未经核验的工期；发现现有交易规则问题时记录证据、单独讨论，不顺手修正。
