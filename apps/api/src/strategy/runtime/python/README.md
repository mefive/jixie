# Python 策略桥接

Python 执行策略 on_bar，交易撮合与账户规则仍由 TS [Engine](../../../engine/README.md) 执行。Python 用户接口实现位于 `apps/api/src/strategy/sdk/python.py`；
`strategy/runtime/python/runner.py` 负责加载声明、请求协议、暂停 I/O 等待期间的执行计时和逐日回调。
`jixie_runner.py` 保留通用帧、日志、计时与业务分派。SDK 通过注入的 request 回调请求数据，不直接读写帧。
本目录不拥有回测报告，也不提供 Python 参数扫描或 Signals 部署准入。

业务消费者调用 [StrategyRuntime.start](../strategy-runtime.ts)，以 `language: 'python'` 选择 [PythonStrategyRuntime](python-strategy-runtime.ts)：通过公共启动流程连接 PythonSession，显式发送 start，等待 metadata，返回具有 execute/close 的实例。策略业务交互委托给共享 [bridge.ts](../bridge.ts)：发送宿主快照、处理批量数据请求，再把 done 中的命令重放到 Engine context。

共享 [protocol.ts](../protocol.ts) 校验启动／执行帧与策略命令；共享 bridge 显式映射 snake_case 数据，不从 Prisma 自动生成协议。请求失败与 fatal／error 帧按当前桥接规则传播，日志经过 sandbox console 限制；不能把 Python 返回的命令视为直接券商下单。

连接初始化失败由 runtime 关闭会话；成功后调用方必须在 finally `runtime.close()`（同步幂等）。正式回测同时持有 FactorHost（同时管理 TS isolate 和 Python 因子运行时），其关闭责任在 runtime/run。底层 socket／runner 路径见 [运行入口清单](../../../../../../docs/backend-runtime-entries.md)。

[codegen-prompt.ts](codegen-prompt.ts) 的 `buildPythonCodegenPrompt` 供 Python Strategy profile 使用。修改 bridge 看 [python-strategy-runtime.test.ts](python-strategy-runtime.test.ts)、[protocol.test.ts](../protocol.test.ts)、[bridge.test.ts](../bridge.test.ts)；修改生成说明看 [codegen-prompt.test.ts](codegen-prompt.test.ts)，并对照 [正式回测编排](../../backtests/README.md)。

[返回 Strategy 总览](../../README.md)

具体类直接继承公共 SandboxRuntime；共享 bridge 返回 metadata 和 execute(context)，不构造 EngineStrategy。唯一生产 onBar 适配位于 `execution/simulation.ts`，转调 runtime.execute({ context })。启动与逐 bar 命令使用同一 exchange；close 直接释放资源，不发送关闭通知或等待关闭确认。
