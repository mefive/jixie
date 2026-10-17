# TypeScript 策略沙箱运行

用户和 Agent 的策略源码只在 isolated-vm 中执行。Engine 位于宿主 Worker，TS/Python 共用 [StrategySandbox](../strategy-sandbox.ts)、[StrategySimulation](../../simulation/strategy-simulation.ts) 和 [strategy-bridge.ts](../strategy-bridge.ts)，FactorHost 独立管理因子沙箱。

| 文件 / 入口 | 职责与消费者 |
| --- | --- |
| [StrategyBridge.create](../strategy-bridge.ts) | 内部 createTypeScript 编译源码、缓存 bundle、准备启动消息并连接 TypeScriptTransport；Runtime 只创建和持有 Bridge |
| [entry.ts](entry.ts) | 外围接入：注册 __receiveCommand、解析 JSON；首次 start 调用 runStrategy 并接入后续消息处理 |
| [strategy-runner.ts](strategy-runner.ts) | 显式 runStrategy 入口与 StrategyRunner：源码加载、参数覆盖、元数据、日志、start/bar/response 分派及用户回调 |
| [strategy-adapter.ts](strategy-adapter.ts) | 沙箱基础能力适配：当日快照、历史和读缓存、查询、指令及异步数据访问；不实现作者指标或选股辅助 |
| [sandbox-bundle.ts](sandbox-bundle.ts) | 打包 runner/adapter、SDK、指标、日志；源码/编译入口分别解析 entry.ts / entry.js |
| [SDK typescript.ts](../../sdk/typescript.ts) | defineStrategy、StrategyContext、参数与周期；独立账户／选股／序列／指标辅助仍归 SDK，公开类型来自 shared SDK 契约 |
| [testing/compile.ts](testing/compile.ts) | 仅编译可信 fixture，生产代码禁止导入 |
| [testing/sandbox.ts](testing/sandbox.ts) | 测试专用 Bridge 派生类复用生产 create，在构造时取得独立 transport metrics；返回同一 StrategySandbox |

通用 isolate、消息队列、帧收发与释放归 infra/sandbox/typescript/typescript-transport.ts，Factor/Strategy 共用。connect 只加载可信 entry，启动用户代码须显式发送 start；命令经 exchange，再由 entry 的唯一 __receiveCommand 接入 runner 分派。公共 StrategySandbox 继承 Sandbox，start 创建实例并等待基类 initialize；子类 createBridge 仅调用 StrategyBridge.create，由 Bridge 内部完成语言选择、源码/配置准备、Transport 连接和构造，基类调用 bridge.initialize 并统一状态与失败/取消清理；Bridge 封装消息循环和 Transport 回收。

runner 为整个会话持有 StrategyAdapter，把同步 access 和异步 request 回调注入其中。该适配器持有跨日历史缓存，每次 bind(snapshot) 清理读缓存并创建当日 BoundStrategyCapabilities；runner 使用绑定和当前参数创建 SDK StrategyContext，再调用用户 onBar；defineStrategy 保留定义／参数规范与作者 receiver，不构造 Context。

与 Factor 对应的 runner 类型使用 `StrategyRunnerHost`、`StrategyRunnerStartup`、`StrategyRunnerCommand`、`StrategyRunnerCommandHandler`。

entry 首次收到 start 时调用 runStrategy，由业务入口创建唯一 StrategyRunner、启动策略并注册后续消息处理。策略定义、请求编号、待响应 Promise 和 StrategyAdapter 都是实例状态；方法按 handle、start、execute、loadStrategy、metadata、request、receiveResponse 排列，与 Python runner 对应。__receiveCommand 的全局注册、JSON 接入和回调安装归 entry.ts；runner.ts 只通过注入的 receive/emit/access 接入通信，JSON 帧和同步宿主入口保持原契约。

异步截面/历史请求通过共享 bridge 分派。watch/持仓历史首次传当前日期可见数据，之后按日期增量更新；动态 ensureBars 注册后续更新，重复请求只补未传输历史。即使没有新历史，请求仍经过 Engine，保留因子准备和错误语义。本地窗口返回副本，指标在 isolate 计算；截面/历史加载后清除查询缓存。factor 只在实际调用时读取宿主，不提前批量读取。

同步宿主访问由 StrategyBridge 分派；context-access.ts 约束读取能力，账户命令与 Python command 请求共用 Bridge.executeCommand 的校验和分派，保持调用处 try/catch 与条件单取价时点。ready 声明 command_mode=synchronous，done 不携带命令批次。通道不暴露 DataPort、源码执行或任意宿主方法，只在当前 onBar 期间绑定。

启动失败、协议失败和 close 释放 isolate；每次运行独立实例，模块状态跨 bar 保留。帧和队列有上限，回调沿用一小时预算，声明求值五秒。metrics 只属于 transport 诊断，通过测试设施取得，不进入作者 SDK 或公共 StrategySandboxInstance。

验收见 [runtime.test.ts](runtime.test.ts)、[isolation.test.ts](isolation.test.ts)、[sandbox-bundle.test.ts](sandbox-bundle.test.ts) 和 API 包级 factor-worker.integration.test.ts；参数用例在本目录，SDK/契约用例归 strategy/sdk。结构整理记录见 [设计记录](../../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Strategy 总览](../../README.md)

Adapter 的对照阅读顺序：会话装配与 bind → BoundStockAccountCapabilities → BoundStrategyCapabilities 的快照／市场数据 → 缓存与通信。SDK 中的原始账户方法只转发能力调用；命令编码由绑定账户实现，TS 通过同步宿主访问发送，Python 通过阻塞请求发送；两者均等待宿主确认。
