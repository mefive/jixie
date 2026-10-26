# 策略定义、命名与配置

这里拥有可编辑 Strategy、展示名称。回测／扫描的冻结报告属于各自能力，修改草稿不改历史报告。

| 文件 / 入口 | 使用方与副作用 |
| --- | --- |
| [read.ts](read.ts) `listStrategies`、`readStrategy` | definition 路由；按用户读取策略列表／详情 |
| [drafts.ts](drafts.ts) `createStrategy`、`deleteStrategy` | definition 路由；创建可调用命名模型；配置由回测提交保存，消息由 Agent 持久化 |
| [config.ts](config.ts) `commitStrategyConfig` | backtests/submit；接收数据库或调用方 transaction、userId、id、config，返回保存结果或 null，不自行开启总事务 |

`strategyRunKey` 只包含影响回测结果的配置，显示名称不影响运行输入摘要。保存重名时保留旧名称，回测提交记录实际保存的名称与无源码参数。因子引用与运行资格归 [factors](../factors/README.md)，不再参与公开范围判断。

[naming.ts](naming.ts) 的 `proposeStrategyName` 调模型，`uniqueStrategyName` 查询用户内名称，`refreshStrategyName` 在模型返回后开事务复查 expectedRunKey，再决定是否改名；没有独立命名 HTTP API。回测提交事务成功后异步触发命名，不等待 Job 启动，也不阻塞提交响应或 Job 终态；失败只记录日志，进程退出可能丢失该次命名。冻结报告不随策略改名。



[返回 Strategy 总览](../README.md)
