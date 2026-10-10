# Strategy 宿主运行入口

[StrategyRuntime.start](strategy-runtime.ts) 接收 `{ language, code, onUserLog?, paramOverrides?, locale? }`，统一返回 `Promise<StrategyRuntimeInstance>`，提供 metadata、execute({ context })、同步幂等 close；宿主契约在 [contract.ts](contract.ts)。StrategyRuntime 是唯一持有策略沙箱资源的宿主类，直接继承公共 SandboxRuntime，统一建立 bridge、交接资源和失败清理。

## 按同一条路径阅读两种语言

| 职责 | TypeScript | Python |
| --- | --- | --- |
| 语言启动准备，不获取资源 | [typescript/prepare.ts](typescript/prepare.ts) | [python/prepare.ts](python/prepare.ts) |
| 宿主获取资源、建立 bridge、执行与关闭 | [strategy-runtime.ts](strategy-runtime.ts) | 同一实现 |
| 沙箱外围接入 | [typescript/entry.ts](typescript/entry.ts) | [通用 jixie_runner.py](../../../../sandboxd/python/jixie_runner.py) |
| 沙箱源码加载、元数据、协议分派与用户回调 | [typescript/runner.ts](typescript/runner.ts) | [python/runner.py](python/runner.py) |
| 沙箱基础能力适配、快照、缓存与宿主访问 | [typescript/adapter.ts](typescript/adapter.ts) | [python/adapter.py](python/adapter.py) |
| 作者声明、公开 Context、选股、周期、指标与仓位辅助 | [SDK typescript.ts](../sdk/typescript.ts) | [SDK python.py](../sdk/python.py) |

阅读顺序是 StrategyRuntime → prepare → bridge → runner → adapter → SDK → 用户回调。两个语言目录中的 prepare.ts 都在宿主执行；runner/adapter 在各自沙箱执行。TS 另需 [sandbox-bundle.ts](typescript/sandbox-bundle.ts) 从 entry.ts 打包可信 runner、adapter 与 SDK；Python 模块由镜像逐项复制。

公共返回类型不暴露语言专属诊断。metrics 归 TypeScriptTransport；隔离测试和性能工具通过 [testing/runtime.ts](typescript/testing/runtime.ts) 装配同一 StrategyRuntime 并单独获取 transport 指标，生产代码不导入测试设施，Python 不增加无业务意义的 metrics。

策略资源装配与 Engine 调用归 [StrategyExecution](../execution/execution.ts)，由回测、扫描和 Signals 创建执行对象，并负责关闭外部资源。本目录只负责策略 runtime 和协议，不规划完整业务流程。

[bridge.ts](bridge.ts) 的 StrategyBridge 统一启动协议、bar 快照、宿主查询、历史同步和命令重放。Runtime 构造实例后调用 initialize({ signal }) 返回 metadata，execute({ context }) 使用既有 StrategyExecutionInput 处理一轮回调；类显式实现 [contract.ts](contract.ts) 的 StrategyBridgeContract，Runtime 字段依赖该契约，共同方法由 Infra SandboxBridge 约束。日志预算与历史同步日期归 Bridge 实例，当前 EngineContext 只绑定本次执行，并在 finally 解除同步宿主访问。底层 TypeScriptTransport 与 PythonSession 实现同一 send/readValidated 契约。Engine 的生产 onBar 适配只在 execution/execution.ts。

结构对应不改变现有语言行为：TS 使用受限同步宿主访问与增量历史缓存；Python 保留阻塞 request/response、按需历史加载和回调结束后命令重放。SDK 只接收注入的基础能力，不反向导入 runtime。两种作者 SDK 的既有命名、指标公式和产品准入保持。

两个沙箱都通过显式业务入口 runStrategy / run_strategy 创建唯一 StrategyRunner、启动策略并接入消息处理。TS entry.ts 在首次 start 时调用 runStrategy，负责全局 __receiveCommand 注册、JSON 接入与回调安装；Python 通用 jixie_runner.py 调用 run_strategy，负责驱动阻塞读循环。业务 runner 内不直接注册全局函数或循环读取帧。类的方法按 handle → start → execute → loadStrategy/load_strategy → metadata → request → receiveResponse/receive_response 对照阅读；各自请求/响应机制保持。会话状态回归见 [session-state.test.ts](session-state.test.ts)。

[inspect-definition.ts](inspect-definition.ts) 通过公共 start 读取 metadata 后 close；扫描参数识别在 scans/inspect-parameters.ts 静态读取，不启动 runtime。公共资源归属测试见 [strategy-runtime.test.ts](strategy-runtime.test.ts)，共享交互见 [bridge.test.ts](bridge.test.ts)，语言行为和隔离测试见各语言目录。

当前结构与审查验证记录见 [运行时统一方案](../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Strategy 总览](../README.md)
