# 策略执行

[execution.ts](execution.ts) 的 `StrategyExecution` 持有一次运行的策略 runtime 和 FactorHost，并在内部调用宿主 Engine。回测、扫描和 Signals 使用相同的对象接口，不需要自行装配 Engine，也不依赖按业务命名的执行入口。

- `create(inputs)`：接收源码、语言、参数、数据端口、日志和已准备的因子，启动运行资源，通过 StrategyFactor.validateRuntimeMetadata 校验运行定义，再结合原因子生成独立的报告依赖快照，不额外复制因子对象；因子统一通过 `factors: StrategyFactor[]` 传入，每项为持有源码、身份和运行配置的 StrategyFactor 实例。初始化失败时释放已经创建的资源。
- `run(options)`：接收日期、资金、成本与可选的 `retainFinalState`，调用 Engine，始终返回 `{ result, finalState }`；默认 finalState 为 null，请求时保留独立的末日状态快照；传入 factors 时，完整输入血缘附加到 result。一个对象只能运行一次，拒绝并发、重复运行和关闭后运行，避免用户代码状态跨计算复用。
- `factorDependencies`：读取已解析的血缘副本，不暴露内部可变状态。Signals 在调用 run 前自行核对冻结快照，执行对象不接收历史快照或决定部署规则。
- `close()`：释放因子和策略资源，可重复调用。调用方必须在 `try/finally` 中关闭对象；运行成功或失败均适用。强制终止 Worker 不保证执行 finally，仍由通用任务回收机制处理。

正式回测的因子来源准备与风险后处理归 backtests/run；扫描组合归 scans/run，每个参数及日期区间创建独立对象；部署验证归 signals/deployments/manage，信号整理归 signals/runs/run。执行对象不查询用户、不写 Job 或报告，不定义 backtest/scan/signal 业务模式。语言加载和逐 bar 协议继续归 runtime，交易算法归 Engine。

测试见 [execution.test.ts](execution.test.ts)。执行 fixture 辅助函数放在各自的 `.test.ts` 文件内；Worker 测试入口直接使用执行对象，不另建 testing 目录。

[factor-host.ts](factor-host.ts) 接收 StrategyFactor[]，管理 TS/Python 运行实例与组合组件，按因子串行计算并检查输入输出；实现 Engine 的 FactorExecutionPort。describe 返回的定义包含运行 window / inputs、辅助历史字段及批准资产范围，不包含源码。EngineConfig 仅接收 factorExecution，不再另传 customFactors。部署准入也直接使用本宿主，运行资源归调用方关闭。测试见 [factor-host.test.ts](factor-host.test.ts)。

Engine 的 runStrategy 使用相同返回结构，不再有按 Signals 命名的入口或重载。finalState 保存复权口径的仓位、待执行目标／订单／条件单、对应行情与末日因子观测；目前仅支持股票／ETF，期货请求保留状态时在读取行情前拒绝。Signals 在自己的 [projection.ts](../../signals/runs/projection.ts) 中换算真实股数、价格并生成每日指令；回测和扫描取 result。
