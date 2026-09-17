# 因子草稿 Agent 启动

[turn.ts](turn.ts) 的 `startFactorAgentTurn` 是 [Factor agent 路由](../routes/agent.ts) 调用的业务入口。输入是 userId、因子 ID、消息、当前代码及可选报告／数据引用，返回 turnId。

路由解析 body 和路径 ID，补齐 `dataReferences` 后传入 `FactorAgentInput`。业务顺序是查询本人因子 → 要求 draft → 检查当前运行 turn → 服务端捕获嵌入分析上下文 → 构造 Factor profile 并入队通用 Agent。普通编辑上下文可使用请求中的当前代码；嵌入分析宿主快照由服务端捕获，二者不能混写成客户端可任意指定的授权快照。

通用模型循环、事件、取消和消息镜像归 [Agent](../../agent/README.md)。本入口的 afterTurn 调用 `refreshFactorMetadata`，可能调用模型并更新展示字段；它与 turn 启动不是一个总事务。元数据规则见 [definitions](../definitions/README.md)。

稳定因子身份的私有问答在 [questions](../questions/README.md)，不要求可编辑 draft，也不写作者草稿对话。嵌入分析的版本／运行归 [Research embedded](../../research/embedded/README.md)。

修改归属、忙碌或 profile 参数时看 turn、[路由集成测试](../routes/index.integration.test.ts) 与 [元数据测试](../definitions/metadata.test.ts)。候选正式分析工具的既有语言传递问题继续以 [服务边界记录](../../../../../docs/design/core-business-service-boundaries.md#6-单独记录不混入本次重构) 为准。

[返回 Factor 总览](../README.md)
