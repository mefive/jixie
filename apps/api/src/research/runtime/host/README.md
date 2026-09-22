# Python 宿主协议与数据请求分派

SDK 的公开契约来源仍是 shared contract；这里负责 API 侧参数解析、响应映射和回放。Python 会话层只需要传入 documentId、request frame 及可选 observer。

[request.ts](request.ts) 的 `parseResearchRequestFrame` 与 [validation.ts](validation.ts) 是纯解析／校验；[protocol.ts](protocol.ts) 定义启动、分析、执行和 reset 帧校验，[analysis-types.ts](analysis-types.ts) 定义 AST 分析投影。不要把这些文件导入造成数据或会话副作用。

[dispatch.ts](dispatch.ts) 的 `dispatchResearchRequest` 由 runtime 调用，顺序是 observer.beforeRequest → 解析参数 → 尝试留存输入回放／调用 datasets loader → observer.captureResponse → 返回完整 response；随后由公共 exchange 发送。合法请求的数据查询失败生成带原 request id 的 error response；非法参数在查询前抛出，由会话层处理，不能统一成吞掉异常的空结果。observer 用于嵌入输入留痕，响应未保存时不能先发给 Python。dispatch 不持有传输；异常直接传播，公共循环不转换 evidence 错误。

[input-replay.ts](input-replay.ts) 的 `replayResearchInput` 检查普通接续文档的来源运行、所有者及成功状态；retained 按方法、参数和 SHA-256 匹配保存响应。无匹配／歧义／校验失败不能降级当前数据；current 或无接续来源才进入当前 loader。输入模式和源运行引用随普通完整执行及 attempt 冻结。

修改方法先查 [dispatch.test.ts](dispatch.test.ts)、[validation.test.ts](validation.test.ts)、[protocol.test.ts](protocol.test.ts)，结果适配还看 [factor-report-runtime.test.ts](factor-report-runtime.test.ts)、[backtest-report-runtime.test.ts](backtest-report-runtime.test.ts)。数据语义归 [datasets](../../datasets/README.md)，会话与取消归 [runtime](../README.md)，留存和接续归 [embedded](../../embedded/README.md)。

[返回 Research 总览](../../README.md)
