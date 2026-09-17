# 共用 Python 会话

[python-session.ts](python-session.ts) 暴露单例 `researchRuntimeManager`，供 dependencies 的 AST 分析、普通 document-runs 和 embedded 执行共用。以 documentId 为会话键，嵌入分析使用自己的内部文档 ID。

- `analyze` 发送源码集合，返回定义、引用、导入及受控 SDK 请求分析；不替调用方保存依赖。
- `execute` 接收 Cell 源码及可选 signal、observer、parameters、captureEnvironment，返回 outputs、definitions/references 和环境哈希；SDK request 转给 [dispatch](../sdk/README.md)。
- `reset` 排队清空现有解释器变量，无会话时直接返回；`interrupt` 关闭活动执行会话并标记中断；`close` 移除会话并关闭连接。`closeResearchDocumentRuntime` 是文档归档／删除等资源收尾入口。

会话获取串行化，每个会话内部按 queue 串行通信；最多 4 个活动会话，达到上限只淘汰无待处理操作的最久未使用会话，否则报 busy。业务文档锁由 document-runs 另行维护，不能用通信队列替代修订或权限检查。

启动请求 explicit_parameters 能力，带参数执行时必须确认沙箱支持，避免旧沙箱静默忽略参数。执行环境在发送源码前交给 captureEnvironment。运行输出传输上限 8 MiB；持久化的内联／图片限制归 [evidence](../evidence/README.md)。非业务执行错误会关闭会话，已识别的 Python 执行错误保留其输出与环境信息；AbortSignal 用于 embedded 的取消／超时。

这里不查文档所有者、不写执行状态、不决定固化。修改协议与资源回收看 [python-session.test.ts](python-session.test.ts)、[python-capabilities.test.ts](python-capabilities.test.ts)，并对照 [运行入口清单](../../../../../docs/backend-runtime-entries.md) 的 Python runner 和 socket 路径。

[返回 Research 总览](../README.md)
