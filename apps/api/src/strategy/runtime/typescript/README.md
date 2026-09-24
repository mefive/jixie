# TypeScript 策略沙箱运行

用户和 Agent 的策略源码只在 isolated-vm 中执行。Engine 位于宿主 Worker，TS/Python 共享
[simulation.ts](../../execution/simulation.ts) 和 [bridge.ts](../bridge.ts) 的业务逻辑，FactorHost 独立管理因子沙箱。

| 文件 / 入口 | 使用方与契约 |
| --- | --- |
| [typescript-strategy-runtime.ts](typescript-strategy-runtime.ts) `TypeScriptStrategyRuntime` | 业务由公共 StrategyRuntime.start 选择，公共返回类型只提供 metadata/execute/close；需要 metrics 的测试直接通过本类 start 创建实例；调用方必须 finally 关闭 |
| [../inspect-definition.ts](../inspect-definition.ts) `inspectStrategyMetadata` | Signals 和 Agent 校验；在 isolate 执行声明，finally 释放资源 |
| [../../scans/inspect-parameters.ts](../../scans/inspect-parameters.ts) `inspectStrategyParameters` | 扫描表单和提交共用 AST 静态参数识别，不加载 runtime 或执行用户代码 |
| [simulation.ts](../../execution/simulation.ts) `runSandboxedBacktest` / `runSandboxedSignalCapture` | 正式回测、扫描 cell、Signals；共用宿主 Engine，finally 关闭语言 runtime 和 FactorHost |
| [sandbox-bundle.ts](sandbox-bundle.ts) / [sandbox-entry.ts](sandbox-entry.ts) | 仅打包 SDK、指标、日志和协议适配；源码/编译入口分别解析 `.ts` / `.js`，进程内缓存 bundle |
| [../../sdk/typescript.ts](../../sdk/typescript.ts) | `defineStrategy`、`enrich`、选股/仓位/指标辅助；公开类型来自 shared SDK 契约 |
| [testing/compile.ts](testing/compile.ts) | 仅编译仓库可信 fixture，用于原生行为对照；生产代码禁止导入 |

通用 isolate、消息队列、帧收发与释放归 `infra/runtime/typescript/transport.ts`，Factor/Strategy 共用。connect 只加载受信任的入口，启动用户代码必须显式发送 start；所有命令经 exchange，再由 sandbox-entry 的唯一 __receiveCommand 分派。具体类直接继承 SandboxRuntime，使用 startSandboxRuntime 统一失败清理。bridge 返回 metadata/execute，生产 Engine onBar 适配只在 `execution/simulation.ts`。

异步数据访问以声明式 request/response 通过共享 bridge 分派。截面整批复制为原生字段；watch/
持仓的日线历史首次传入当前日期可见数据，之后按日期增量更新。`ensureBars` 首次请求标的时传入
可见历史并注册后续更新；重复请求复用已同步日期，只补尚未传输的日线，当日已同步则返回空增量。
即使没有历史需要传输，请求仍经过 Engine，保留因子准备及错误语义。本地窗口返回副本，指标在 isolate 计算；其他同步读取按回调缓存，
截面/历史加载后清除查询缓存。因子只在实际读取时调用宿主
`factor()`，保持首次读取缓存及 Signals 观察值；不会为了生成 TS 截面而提前读取所有因子。

TS 同步命令和读取走经过 schema 限定的 `context-access.ts`；同步命令复用 `commands.ts` 分派，
保留调用处 try/catch 与条件单取价时点。Python 仍按原协议在 done 后批量重放。两种传输不必具有
相同同步机制；数据、校验和交易规则只有一套。通道不暴露 DataPort、源码执行或任意宿主方法，
只在当前 onBar 期间绑定。不支持在回调结束后继续使用保存的 context。

启动失败、协议失败和 close 释放 isolate；每次运行独立实例，模块状态跨 bar 保留。宿主队列、
帧大小和共享 schema 有上限；回调沿用一小时运行预算，声明求值五秒。`metrics` 仅用于宿主验证，
记录帧数、同步调用及传输字节，不属于公开 SDK 或 StrategyRuntimeInstance 公共宿主契约。
[isolation.test.ts](isolation.test.ts) 和 [runtime-benchmark.test-worker.mjs](runtime-benchmark.test-worker.mjs)
直接调用 TypeScriptStrategyRuntime.start 获取这些统计；公共 StrategyRuntime.start 不为此提供返回具体 TS 类型的重载。

验收看 [typescript-strategy-runtime.test.ts](typescript-strategy-runtime.test.ts)、[isolation.test.ts](isolation.test.ts)、
[sandbox-bundle.test.ts](sandbox-bundle.test.ts) 和包级 `factor-worker.integration.test.ts`。
参数用例在本目录，SDK 与契约用例归 `strategy/sdk`；完整验证状态见 [设计记录](../../../../../../docs/design/python-and-sandbox.md)。

[返回 Strategy 总览](../../README.md)
