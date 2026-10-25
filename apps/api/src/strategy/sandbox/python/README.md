# Python 策略沙箱运行

Python 执行用户 on_bar，撮合和账户规则仍由宿主 TypeScript [Backtesting](../../../backtesting/README.md) 执行。两种语言共用 [StrategySandbox](../strategy-sandbox.ts)、StrategySimulation 和 [strategy-bridge.ts](../strategy-bridge.ts)。

| 文件 / 入口 | 职责与消费者 |
| --- | --- |
| [StrategyBridge.create](../strategy-bridge.ts) | 内部 createPython 准备启动消息并连接 PythonSession，返回拥有连接的 Bridge |
| [strategy_runner.py](strategy_runner.py) | 沙箱源码加载、参数覆盖、元数据、帧请求/响应、暂停 I/O 等待计时、用户回调与错误输出 |
| [strategy_adapter.py](strategy_adapter.py) | 沙箱基础能力适配：当日快照、截面/历史缓存、数据请求、账户快照和同步命令请求 |
| [SDK python.py](../../sdk/python.py) | Strategy、公开 Context、Universe、周期/指标与账户辅助；接收基础能力，不导入 runtime |
| [packaging.test.ts](packaging.test.ts) | 只使用镜像显式复制的模块验证真实 runner 与 SDK |

公共 StrategySandbox.start 创建实例并等待基类 initialize；子类 createBridge 仅调用 StrategyBridge.create，由 Bridge 内部准备配置、获取会话并完成构造，基类负责握手、启动状态及失败/取消清理；execute({ context }) 委托 bridge，close 同步幂等释放会话。业务调用方仍须 finally close。通用 jixie_runner.py 只启动/分派，沙箱会话与隔离设施归 Infra/sandboxd。

runner 为整个会话持有 StrategyAdapter，Adapter 保管跨日历史缓存；每个决策日调用 bind(snapshot) 创建当日 BoundStrategyCapabilities，再以 Context(capabilities, params) 构造作者上下文。作者 SDK 保留 snake_case 方法、选股、指标和仓位辅助；运行数据与协议状态不再存入 SDK。

run_strategy 为当前沙箱会话创建唯一 StrategyRunner，完成 start 后将 handle 交给注入的 receive_commands。阻塞读取 bar/close 的循环归通用 jixie_runner.py；业务 runner 不循环读取消息。策略定义、StrategyAdapter、请求编号和 I/O 回调都归 Runner 实例；方法按 handle、start、execute、load_strategy、metadata、request、receive_response 与 TS 排列对应。请求仍在内部读取 response，并在等待期间暂停执行计时；不创建跨会话的共享单例。

账户操作通过阻塞 command request/response 逐条提交，StrategyBridge.executeCommand 先校验命令，再调用 EngineContext，成功返回空结果，拒绝返回 error 并由 Runner 在调用处抛出 RuntimeError。作者可捕获命令错误并继续；本地 JSON 无法编码的值可能直接抛出 ValueError。done 只表示回调结束，不收集或回放命令。ready 声明 command_mode=synchronous，API 与 Python 镜像须配套更新。

每日 bar_updates、按需完整历史加载、截面中的声明因子值、账户快照与撮合时序保持；确认只表示宿主接受决策，后续错误不自动撤销此前接受的命令。协议和字段映射仍由公共 protocol/bridge 校验；Python 没有新增期货操作或参数扫描。

SDK、runner、adapter 及公共 SdkAdapter Protocol 均显式列入 Dockerfile.python、.dockerignore 和部署影响清单，变更 Python 源码同时影响 API/sandboxd；宿主 bridge.ts 只影响 API。路径与资源验证见 [运行入口清单](../../../../../../docs/backend-runtime-entries.md)。

宿主启动/关闭回归见 [strategy-sandbox.test.ts](../strategy-sandbox.test.ts)，Python 行为见 [runtime.test.ts](runtime.test.ts)，公共交互见 bridge.test.ts/protocol.test.ts；生成说明归 [codegen-prompt.ts](codegen-prompt.ts) 及同名测试。当前结构记录见 [设计记录](../../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Strategy 总览](../../README.md)

Adapter 的对照阅读顺序：会话装配与 bind → BoundStockAccountCapabilities → BoundStrategyCapabilities 的快照／市场数据 → 缓存与通信。SDK 中的原始账户方法只转发能力调用；命令编码由绑定账户实现，TS 通过同步宿主访问发送，Python 通过阻塞请求发送；两者均等待宿主确认，并共用 Bridge 的单条命令执行入口。
