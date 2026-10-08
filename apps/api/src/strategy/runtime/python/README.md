# Python 策略沙箱运行

Python 执行用户 on_bar，撮合和账户规则仍由宿主 TypeScript [Backtesting](../../../backtesting/README.md) 执行。两种语言共用 [StrategyRuntime](../strategy-runtime.ts)、StrategyExecution 和 [bridge.ts](../bridge.ts)。

| 文件 / 入口 | 职责与消费者 |
| --- | --- |
| [prepare.ts](prepare.ts) | 宿主准备 PythonSession 工厂、启动消息与 bridge 配置，不获取会话资源 |
| [runner.py](runner.py) | 沙箱源码加载、参数覆盖、元数据、帧请求/响应、暂停 I/O 等待计时、用户回调与错误输出 |
| [context.py](context.py) | 沙箱基础 Context 代理：当日快照、截面/历史缓存、数据请求、账户快照和命令收集 |
| [SDK python.py](../../sdk/python.py) | Strategy、公开 Context、Universe、周期/指标与账户辅助；接收基础能力，不导入 runtime |
| [packaging.test.ts](packaging.test.ts) | 只使用镜像显式复制的模块验证真实 runner 与 SDK |

公共 StrategyRuntime.start 选择 prepare，统一通过 startSandboxRuntime 获取资源、建立 bridge 并交接给实例；execute({ context }) 委托 bridge，close 同步幂等释放会话。启动失败自行清理；业务调用方仍须 finally close。通用 jixie_runner.py 只启动/分派，沙箱会话与隔离设施归 Infra/sandboxd。

runner 为每个决策日创建 StrategyContextAdapter，将跨日 bar_cache 和 request 注入，再以 Context(core, params) 构造作者上下文。作者 SDK 保留 snake_case 方法、选股、指标和仓位辅助；运行数据与协议状态不再存入 SDK。

run_strategy 为当前沙箱会话创建唯一 StrategyRunner，完成 start 后将 handle 交给注入的 receive_commands。阻塞读取 bar/close 的循环归通用 jixie_runner.py；业务 runner 不循环读取消息。策略定义、跨日 bar_cache、请求编号和 I/O 回调都归实例；方法按 handle、start、execute、load_strategy、metadata、request、receive_response 与 TS 排列对应。请求仍在内部读取 response，并在等待期间暂停执行计时；不创建跨会话的共享单例。

结构整理保持原语义：阻塞 request/response、每日 bar_updates、按需完整历史加载、截面中的声明因子值，以及本地收集命令后由 done 返回、bridge 按顺序重放。协议和字段映射仍由公共 protocol/bridge 校验；Python 没有新增期货操作、参数扫描或 Signals 准入。

SDK、runner、context 均显式列入 Dockerfile.python、.dockerignore 和部署影响清单，变更 Python 源码同时影响 API/sandboxd；prepare.ts 只影响 API。路径与资源验证见 [运行入口清单](../../../../../../docs/backend-runtime-entries.md)。

宿主启动/关闭回归见 [strategy-runtime.test.ts](../strategy-runtime.test.ts)，Python 行为见 [runtime.test.ts](runtime.test.ts)，公共交互见 bridge.test.ts/protocol.test.ts；生成说明归 [codegen-prompt.ts](codegen-prompt.ts) 及同名测试。当前结构记录见 [设计记录](../../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Strategy 总览](../../README.md)
