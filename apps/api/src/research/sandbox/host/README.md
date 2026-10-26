# Python 宿主协议与数据请求分派

SDK 公开契约来源仍是 shared contract；这里负责 API 参数解析、请求分派和响应映射。会话只传入 documentId 和 request frame，所有取数都查询当前可用数据。

[request.ts](request.ts) 的 `parseResearchRequestFrame` 与 [validation.ts](validation.ts) 是纯解析／校验；[protocol.ts](protocol.ts) 定义启动、分析、执行和 reset 帧校验，[analysis-types.ts](analysis-types.ts) 定义 AST 分析投影。不要把这些文件导入造成数据或会话副作用。

[dispatch.ts](dispatch.ts) 的 `dispatchResearchRequest` 先解析参数，再调用 datasets loader，最后返回带请求 ID 的响应。数据入口负责归属和 PIT 口径；合法查询的数据错误返回 error response，非法参数在查询前抛出。没有 observer、输入留存、回放或数据模式切换。Bridge 仅在内存检查嵌入分析请求次数和响应字节预算。

修改方法先查 [dispatch.test.ts](dispatch.test.ts)、[validation.test.ts](validation.test.ts)、[protocol.test.ts](protocol.test.ts)，结果适配还看 [factor-report-runtime.test.ts](factor-report-runtime.test.ts)、[backtest-report-runtime.test.ts](backtest-report-runtime.test.ts)。数据语义归 [datasets](../../datasets/README.md)，会话与取消归 [sandbox](../README.md)，留存和接续归 [embedded](../../embedded/README.md)。

[返回 Research 总览](../../README.md)
