# 公共运行设施

Research、Factor、Strategy 和 Agent 的宿主代码从这里取得通用执行能力。

- `python/session.ts`：`PythonSession.connect()` 建立 Unix socket 或开发环境本地 runner 连接；负责分帧、读写、断连与关闭。`readValidated()` 接收调用方提供的协议 schema，校验失败终止会话。
- `python/protocol.ts`：帧包络、大小限制、通用日志/错误帧及共用字段校验。`PythonFrame` 是传输包络，不代表通过了业务协议校验。
- `typescript/isolate-run.ts`：`loadIsolatedModule()` / `toCommonJs()` 提供通用 TS 编译与 V8 isolate；按需加载 `math/stats`，不包含领域 SDK。
- `console.ts`：`makeSandboxConsole()` 转发、格式化并限制用户代码日志。

业务握手及交互协议分别位于 `strategy/runtime/python/protocol.ts`、`factor/runtime/python/protocol.ts`、`research/sdk/protocol.ts`；各业务 runtime 通过这些 schema 调用公共 session。公共设施不导入业务模块，也不拥有业务执行状态。

运行约束保持原样：本地 runner 路径相对 API 工作目录解析，仅供非生产环境使用；生产连接 sandboxd 的 Unix socket。会话本身不增加读超时，既有超时策略继续由调用方、runner 和 sandboxd 负责。业务调用方负责在结束、失败或取消时关闭会话、释放 isolate。

`python/session.test.ts` 使用临时 Unix socket 验证分帧、线格式、非法包、schema 拒绝、断连、关闭和生产环境禁止本地分支。该测试需要允许创建本地 socket，不依赖容器或外部服务；真实容器隔离仍由 sandboxd 的验收负责。
