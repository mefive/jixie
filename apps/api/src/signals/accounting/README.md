# 信号执行与账户重放

账户分 model（策略输出）、simulation（按行情模拟成交）、actual（人工录入成交）。此能力不向券商下单；持仓及账户快照由信号意图、行情和成交记录派生。

| 文件 / 入口 | 主要调用方及副作用 |
| --- | --- |
| [initialize.ts](initialize.ts) `initializeSignalAccounting` | signal Job afterCommit；done Run 有模型资产／现金数据时，在自己的事务里建立即时执行记录及缺失的 actual 基线；条件单不直接建立即时执行记录 |
| [settlement.ts](settlement.ts) `settleStrategyAccounts` | 人工提交、每日调度；扫描截止日内所有 done Run 涉及的部署，逐部署先 simulation 再 actual 重建 |
| 同文件 `rebuildDeploymentAccount` | settlement 和人工成交更新；加载基线、成交及行情，按执行日保存派生账户 |
| [executions.ts](executions.ts) `updateActualExecution` | execution 路由；检查执行记录所有者和 Run 已完成，保存人工成交，再重放 actual 至最新 simulation 日期 |
| [replay.ts](replay.ts) `replayAccountDay` | settlement 调用的纯计算；输入前日状态、指令、行情、日期及成本，返回新状态和模拟成交更新，无数据库写入 |
| [read.ts](read.ts) `getStrategyExecutionOverview`、`executionWire` | 前者先检查部署归属再装配三类账户、执行率及偏差，后者只映射执行记录 |
| [quotes.ts](quotes.ts) `loadMarketQuotes`、`nextTradingDate` | 重建所需行情和后继交易日读取 |

## 旧版现金执行顺序和事务边界

基线来自模型权益、现金和持仓，初始持仓成本取标记价。纯 replay 复制前态，先卖后买，simulation 根据开盘价、缺失报价、涨跌停、可卖量、现金及成本判断成交；actual 只应用人工标为 filled 的记录，最后按收盘行情估值。

重建从最早基线开始，增量模式选截止日前最近快照；fullReplay 先删除非基线快照，再逐执行日计算。每个执行日单独事务保存模拟成交更新和账户快照，整个重放没有总事务，前置删除也不在逐日事务里。

人工更新为非 pending 时，要求模拟结果已不为 pending；filled 数量不能超过请求数量。恢复 pending 会清空人工成交字段，允许模拟尚未结算时执行。人工记录写入与后续 actual 重放是两个步骤，失败时不能假定两者一起回滚；已有 [范围外问题记录](../../../../../docs/design/core-business-service-boundaries.md#6-单独记录不混入本次重构)。

改资金／持仓规则先读 [replay.test.ts](replay.test.ts)；改基线、结算或人工回填顺序看 [flow.integration.test.ts](flow.integration.test.ts)，权限及 HTTP 映射看 [路由集成测试](../routes/index.integration.test.ts)。

[返回 Signals 总览](../README.md)

## accountingVersion=2

新部署使用 `versioned.ts` 初始化模型继承的双账户基线和条件/普通/期货任务。`account-day.ts` 使用 Engine 的 OrderBook 模拟每日顺序，实际账按带时区时间与序号应用不可变成交，再按实约结算。`futures-market.ts` 冻结最小市场输入，`versioned-replay.ts` 枚举所有交易日，写候选 generation 后按输入 revision 和已发布指针进行 CAS 发布。失败保留上一次完整结果，模拟和实际状态独立。

`manual-fills.ts` 提供所有者校验、实际数量解析、幂等成交录入、追加修订和恢复重试；实际成交不受模拟数量上限约束。`execution-summary.ts` 区分任务状态，价格只在同实约同方向且唯一可比时比较。条件单以 key/placedDate 标识，不把每日重复展示当成新任务。

HTTP：GET `deployments/:id/executions`；POST `executions/:id/resolutions`、`executions/:id/fills`、`deployments/:id/account-replays`；PATCH `fills/:id`、`executions/:id/decision`。旧 PATCH `executions/:id` 只处理 version=1。

新增测试代码与静态检查不代表行为验证通过；本轮验证记录见 [期货 Signals 设计](../../../../../docs/design/futures-signals-design.md)。
