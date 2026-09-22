# 公共运行设施

Factor、Strategy（TS/Python）和 Research（Python）的宿主入口统一为：

```text
业务所有者 → BusinessRuntime.start(options)
  → startSandboxRuntime：创建资源 → exchange 启动握手 → 返回实例
业务所有者 → runtime.execute(input) → executeInSandbox
  → exchangeSandboxCommand：发命令 → 收日志／答宿主请求 → 返回终止结果
业务所有者 → runtime.close()
```

- [sandbox-runtime.ts](sandbox-runtime.ts)：语言无关的 `SandboxRuntime` 实现可用状态检查、执行入口、同步幂等 close 与 abort；`startSandboxRuntime` 统一资源取得后的启动失败／取消清理。具体业务直接继承这一层，资源由组合提供。普通用户代码错误是否保留实例仍由业务所有者判断。
- [exchange.ts](exchange.ts)：每次必须显式发送 command，再处理日志、请求和终止帧；单条 log 或 log_batch 都按顺序交给同一个 onLog，逐条等待回调并检查取消。通用 error/fatal 抛错，Research 的 research_error 由业务结果处理。拒绝重叠交换，不自行排队，不吞掉宿主回调或 evidence 保存异常。
- [python/session.ts](python/session.ts)：`PythonSession.connect()` 创建 Unix socket 或开发环境 runner 连接；负责分帧、读写、断连和关闭。`readValidated` 校验业务 schema，非法帧终止会话。
- [typescript/transport.ts](typescript/transport.ts)：`TypeScriptTransport.connect()` 创建 isolate、加载受信任的入口；用户代码经 exchange 的启动命令加载。Factor／Strategy 共用 send/readValidated、队列、帧限制和回收。Strategy 可显式启用受限同步宿主访问，Factor 不启用。
- [protocol.ts](protocol.ts)、[python/protocol.ts](python/protocol.ts)：分别拥有通用日志／错误帧与 Python 线格式、传输限制。
- [typescript/isolate-run.ts](typescript/isolate-run.ts)：`toCommonJs` 只转换源码；`loadIsolatedModule/callJson` 仅供 Agent 历史图表转换工具，Factor 已不再使用该执行路径。
- [console.ts](console.ts)：共享日志格式化与预算设施。
- [log-buffer.ts](log-buffer.ts)：无 Node 依赖的沙箱内日志缓冲，按 256 条或 64 KiB 序列化 UTF-8 字节刷新；保留超出批量阈值的单条 log，由既有传输限额处理。TS Factor 的命令入口负责结束时刷新，其余语言／业务仍使用原日志发送方式。protocol.ts 定义公共 log_batch 形状，业务 schema 显式接受后交给 exchange。

业务协议分别在 `factor/runtime/protocol.ts`、`strategy/runtime/protocol.ts`、`research/runtime/host/protocol.ts`。公共设施不导入业务模块，不决定数据库、SDK 或 Engine 语义。Factor 传预备输入，Strategy 传 bar 快照并动态请求，Research 传 Cell 源码；都使用同一 exchange。

实例所有者负责最终 close；Research 的唯一串行队列和容量管理在 `research/runtime/pool.ts`。signal 检查阻止取消后的发送，打断阻塞读取由资源所有者安装的 abort 监听负责。close 不等待 Python 确认，也不保证用户 finally 执行。

Python 本地 runner 路径相对 API cwd 解析，仅非生产可用；生产连接 sandboxd socket。既有超时策略仍由调用方、runner 和 sandboxd 管理。TS Factor 保留 256 MiB、声明 5 秒、整批计算 30 秒；Strategy 保留 1024 MiB、声明 5 秒、回调一小时。TS 帧/队列有限额，具体预算在业务创建 transport 时配置。

验证入口：[sandbox-runtime.test.ts](sandbox-runtime.test.ts) 的资源所有权；[exchange.test.ts](exchange.test.ts) 的命令循环；[typescript/transport.test.ts](typescript/transport.test.ts) 的异步应答、关闭、非法帧与限制；[python/session.test.ts](python/session.test.ts) 的真实临时 socket 分帧。三业务测试继续验证字段与计算语义。当前迁移的实际审查和验证状态见 [统一方案](../../../../../docs/design/sandbox-runtime-architecture.md)。
