# 策略定义、命名与配置

这里拥有可编辑 Strategy、展示名称和公开范围。回测／扫描的冻结报告属于各自能力，修改草稿不改历史报告或 Signals 已有部署。

| 文件 / 入口 | 使用方与副作用 |
| --- | --- |
| [read.ts](read.ts) `listStrategies`、`readStrategy` | definition 路由；按用户读取策略列表／详情 |
| [drafts.ts](drafts.ts) `createStrategy`、`deleteStrategy` | definition 路由；创建可调用命名模型；配置由回测提交保存，消息由 Agent 持久化 |
| [config.ts](config.ts) `commitStrategyConfig` | backtests/submit；接收数据库或调用方 transaction、userId、id、config，返回保存结果或 null，不自行开启总事务 |
| [visibility.ts](visibility.ts) `setStrategyVisibility` | definition 路由；含自定义因子引用时不能公开 |
| [copy-public.ts](copy-public.ts) `copyPublicStrategy` | Sharing 复制公开策略，目标写入仍由 Strategy 管理 |
| [from-research.ts](from-research.ts) `findResearchStrategyDraft`、`createStrategyDraftFromResearch` | Research handoff 查询复用／创建目标；接收已生成代码、messages 和来源元数据，不运行回测 |

删除策略要求没有任何部署记录，暂停部署也会保留这项删除限制。

`strategyRunKey` 只包含影响回测结果的配置，改显示名称不清除 lastResult。保存重名时保留旧名称，回测提交使用实际保存的名称冻结报告。引用提取直接使用 [references](../factor-inputs/README.md)，不为可见性检查加载编译准备能力。

[naming.ts](naming.ts) 的 `proposeStrategyName` 调模型，`uniqueStrategyName` 查询用户内名称，`refreshStrategyName` 在模型返回后开事务复查 expectedRunKey，再决定是否改名；没有独立命名 HTTP API。回测 Job 的命名是完成事务前的尽力动作，不能理解为整个回测原子事务的一部分。

Research 草稿使用默认回测配置和 Python/py-v1、私有状态。创建最多重试 50 次：P2002 后先查同源执行的并发胜者，否则再分配名称；未知错误直接抛出。复用顺序和证据生成归 [Research handoff](../../research/handoff/README.md)，本入口不替代普通创建／公开复制。

改缓存失效看 [config.test.ts](config.test.ts)；交接看 [from-research.test.ts](from-research.test.ts)；权限、命名回退与公开范围看 [路由集成测试](../routes/index.integration.test.ts)。

[返回 Strategy 总览](../README.md)
