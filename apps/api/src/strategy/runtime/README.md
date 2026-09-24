# Strategy 宿主运行入口

[StrategyRuntime.start](strategy-runtime.ts) 是两种语言的业务统一创建入口，接收 `{ language, code, onUserLog?, paramOverrides?, locale? }`。只保留一个签名和实现，统一返回 `Promise<StrategyRuntimeInstance>`，提供 metadata、execute({ context })、同步幂等 close；宿主类型在 [contract.ts](contract.ts)。

公共返回类型不暴露语言专属诊断。需要 metrics 的隔离测试和性能工具直接调用 [TypeScriptStrategyRuntime.start](typescript/typescript-strategy-runtime.ts)，继续验证缓存、通信和传输量；普通业务仍使用公共入口，Python 不提供无业务意义的 metrics。

[run.ts](run.ts) 拥有一次回测／信号捕获的 runtime 和 FactorHost，创建唯一生产 EngineStrategy 适配：`{ ...runtime.metadata, onBar: context => runtime.execute({ context }) }`，在 finally 关闭两者。Engine 本身不选择语言，不加载源码。

[bridge.ts](bridge.ts) 统一启动协议、bar 快照、宿主查询、历史同步和命令重放，返回 metadata 与 execute(context)。底层 TypeScriptTransport 与 PythonSession 实现同一 send/readValidated 契约，全部命令交给公共 exchange；具体实例继承公共 SandboxRuntime，以 startSandboxRuntime 创建和交接资源。

语言差异见 [TypeScript](typescript/README.md) 和 [Python](python/README.md)：TS 保留受限同步宿主访问与本地历史缓存；Python 保留阻塞 request/response 和完成后命令重放。共同入口不意味着两种作者 SDK 完全等同。[inspect-definition.ts](inspect-definition.ts) 的元数据检查仍通过公共 start，读取 metadata 后 close。扫描参数识别独立位于 [scans/inspect-parameters.ts](../scans/inspect-parameters.ts)，通过 AST 静态读取，不启动 runtime。

共享交互验证见 [bridge.test.ts](bridge.test.ts)；语言运行、隔离和打包测试在各实现目录。当前迁移验收状态见 [统一方案](../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Strategy 总览](../README.md)
