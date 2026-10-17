# 公共运行设施

Factor、Strategy（TS/Python）和 Research（Python）的宿主入口统一为：

```text
业务所有者 → BusinessSandbox.start(options)
  → new BusinessSandbox(options) → await initialize() → 返回 ready 实例
      → createBridge → BusinessBridge.create：选择语言 → 准备源码/配置 → 连接 Transport → 构造 Bridge
      → bridge.initialize({ signal }) → 基类 exchange 握手 → 返回 metadata
业务所有者 → sandbox.execute(input) → executeInSandbox → bridge.execute
  → 继承的 protected exchange：发命令 → 收日志／答宿主请求 → 处理终止结果
      → Transport → 沙箱 Runner
业务所有者 → sandbox.close() → bridge.close() → transport.close()
```

- [sdk-adapter.ts](sdk-adapter.ts)、[python/sdk_adapter.py](python/sdk_adapter.py)：跨业务 SdkAdapter 接口／Protocol，只约束 bind(input) → Capabilities。业务 Adapter 在 session 内复用，每次装配返回独立绑定；SDK 只导入本业务能力声明，不依赖这个 runtime 接口。
- [sandbox-bridge.ts](sandbox-bridge.ts)：公共 `SandboxBridge<Input, Output, Metadata, Options>` 接口，约束 initialize({ signal? }) → metadata、execute(input, options?) → output 及 close/abort/isClosed。SandboxBridgeBase 实现此接口，Sandbox 字段依赖此接口；Factor/Strategy 不另建纯泛型绑定的别名。ResearchBridgeContract 扩展 analyze/reset，由 ResearchBridge 显式实现，ResearchSandbox 通过扩展接口调用。
- [sandbox.ts](sandbox.ts)：语言无关的 `Sandbox` 通过受保护的实例 initialize 固定启动流程，子类只需实现 createBridge，调用对应业务 Bridge.create；语言选择、源码准备和 Transport 连接均封装在业务 Bridge 内。基类持有 Bridge，管理 new/starting/ready/closed 状态、默认执行委托、同步幂等 close/abort 和失败/取消清理。连接完成前关闭的实例仍回收晚到的 Bridge，成功握手后才发布 metadata；成功实例关闭后仍可读取 metadata。Research 可覆盖 executeInSandbox 保留活动 Cell 与中断异常转换。普通用户代码错误是否保留实例仍由业务所有者判断。
- [sandbox-bridge-base.ts](sandbox-bridge-base.ts)：三个业务 Bridge 共同继承的 `SandboxBridgeBase<Input, Output, Metadata, Options, Transport>`，前四个泛型与公共接口一致，Options 默认为 undefined，Transport 默认为 SandboxTransport。基类声明抽象 initialize/execute，业务子类绑定类型并实现各自协议；同时独占传输并提供 close/abort/isClosed 与 protected exchange，不另建业务状态机。每次必须显式发送 command，再处理日志、请求和终止帧；单条 log 或 log_batch 都按顺序交给同一个 onLog，逐条等待回调并检查取消。通用 error/fatal 抛错，Research 的 research_error 由业务结果处理。并发保护按 Transport 在所有 Bridge 实例及子类间共享，覆盖同步终止帧处理，finally 释放；不自行排队，不吞掉宿主回调或 evidence 保存异常。业务钩子与单次执行上下文仍由具体 Bridge 提供，保留原处理时机。
- [transport.ts](transport.ts)：SandboxFrame/SandboxTransport 契约，统一定义 send/readValidated、close/abort 和只读 isClosed，不再独立定义 SandboxResource。Bridge 持有并管理 Transport；TypeScriptTransport/PythonSession 显式 implements，负责通信、帧校验和底层回收。BusinessBridge.create 返回前的构造失败由其内部回收，返回后 Sandbox 经 Bridge 完成关闭。
- [python/python-session.ts](python/python-session.ts)：`PythonSession.connect()` 创建 Unix socket 或开发环境 runner 连接；负责分帧、读写、断连和关闭。`readValidated` 校验业务 schema，非法帧终止会话。
- [typescript/typescript-transport.ts](typescript/typescript-transport.ts)：`TypeScriptTransport.connect()` 创建 isolate、加载受信任的入口；用户代码经 exchange 的启动命令加载。Factor／Strategy 共用 send/readValidated、队列、帧限制和回收。Strategy 可显式启用受限同步宿主访问，Factor 不启用。
- [protocol.ts](protocol.ts)、[python/protocol.ts](python/protocol.ts)：分别拥有通用日志／错误帧与 Python 线格式、传输限制。
- [typescript/compile.ts](typescript/compile.ts)：`toCommonJs` 只转换用户源码，供 Factor/Strategy 准备和因子检查使用；不创建 isolate、不注入统计库、不执行源码。旧 Agent 图表执行器已移除。
- [console.ts](console.ts)：共享日志格式化与预算设施。
- [sandbox-log-buffer.ts](sandbox-log-buffer.ts)：无 Node 依赖的沙箱内日志缓冲，按 256 条或 64 KiB 序列化 UTF-8 字节刷新；保留超出批量阈值的单条 log，由既有传输限额处理。TS Factor 的命令入口负责结束时刷新，其余语言／业务仍使用原日志发送方式。protocol.ts 定义公共 log_batch 形状，业务 schema 显式接受后交给 exchange。

阅读主线和所有权链均为 Sandbox → Bridge → Transport → Runner；exchange 是 Bridge 继承的内部方法。业务协议状态与连接归 Bridge，业务生命周期与取消归 Sandbox；初始化返回 metadata，执行经基类消息循环。无状态映射/服务分派保留具名函数。协议 schema 分别在 `factor/runtime/protocol.ts`、`strategy/runtime/protocol.ts`、`research/runtime/host/protocol.ts`。公共设施不导入业务模块，不决定数据库、SDK 或 Engine 语义。Factor 传预备输入，Strategy 传 bar 快照并动态请求，Research 传 Cell 源码；都使用同一 exchange。

实例所有者负责最终 close；Research 的唯一串行队列和容量管理在 `research/runtime/research-sandbox-pool.ts`。signal 检查阻止取消后的发送，打断阻塞读取由资源所有者安装的 abort 监听负责。close 不等待 Python 确认，也不保证用户 finally 执行。

Python 本地 runner 路径相对 API cwd 解析，仅非生产可用；生产连接 sandboxd socket。既有超时策略仍由调用方、runner 和 sandboxd 管理。TS Factor 保留 256 MiB、声明 5 秒、整批计算 30 秒；Strategy 保留 1024 MiB、声明 5 秒、回调一小时。TS 帧/队列有限额，具体预算在业务创建 transport 时配置。

验证入口：[sandbox.test.ts](sandbox.test.ts) 的资源所有权；[sandbox-bridge-base.test.ts](sandbox-bridge-base.test.ts) 的命令循环；[typescript/typescript-transport.test.ts](typescript/typescript-transport.test.ts) 的异步应答、关闭、非法帧与限制；[python/python-session.test.ts](python/python-session.test.ts) 的真实临时 socket 分帧。三业务测试继续验证字段与计算语义。当前迁移的实际审查和验证状态见 [统一方案](../../../../../docs/design/sandbox-runtime-architecture.md)。
