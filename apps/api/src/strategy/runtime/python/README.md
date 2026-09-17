# Python 策略桥接

Python 执行策略 on_bar，交易撮合与账户规则仍由 TS [Engine](../../../engine/README.md) 执行。本目录不拥有回测报告，也不提供 Python 参数扫描或 Signals 部署准入。

[runtime.ts](runtime.ts) 的 `createPythonStrategyRuntime` 由 backtests/run 调用：输入源码、日志、可选参数覆盖及 locale，连接 PythonSession，发送 start，等待元数据，返回 `{ strategy, close }`。strategy 的 onBar 会发送宿主快照、处理 Python 数据请求，再把 done 中的命令重放到 Engine context。

[protocol.ts](protocol.ts) 校验启动／执行帧与策略命令；宿主显式映射 snake_case 数据，不从 Prisma 自动生成协议。请求失败与 fatal／error 帧按当前桥接规则传播，日志经过 sandbox console 限制；不能把 Python 返回的命令视为直接券商下单。

连接初始化失败由 runtime 关闭会话；成功后调用方必须在 finally `await runtime.close()`。正式回测同时持有 PythonFactorHost，其关闭责任在 backtests/run。底层 socket／runner 路径见 [运行入口清单](../../../../../../docs/backend-runtime-entries.md)。

[codegen-prompt.ts](codegen-prompt.ts) 的 `buildPythonCodegenPrompt` 供 Python Strategy profile 使用。修改 bridge 看 [runtime.test.ts](runtime.test.ts)、[protocol.test.ts](protocol.test.ts)；修改生成说明看 [codegen-prompt.test.ts](codegen-prompt.test.ts)，并对照 [正式回测编排](../../backtests/README.md)。

[返回 Strategy 总览](../../README.md)
