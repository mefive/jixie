# 策略执行

[execution.ts](execution.ts) 的 `StrategyExecution` 持有一次运行的策略 runtime 和 FactorHost，并在内部调用宿主 Engine。回测、扫描和 Signals 使用相同的对象接口，不需要自行装配 Engine，也不依赖按业务命名的执行入口。

- `create(inputs)`：接收源码、语言、参数、数据端口、日志和已准备的因子，启动运行资源，通过 StrategyFactor.validateRuntimeMetadata 校验运行定义，再结合原因子生成独立的报告依赖快照，不额外复制因子对象；因子统一通过 `factors: StrategyFactor[]` 传入，每项为持有源码、身份和运行配置的 StrategyFactor 实例。初始化失败时释放已经创建的资源。
- `run(options)`：接收日期、资金、成本及 strictFutures，调用 Engine，直接返回回测结果；传入 factors 时附加完整输入血缘。一个对象只能运行一次，拒绝并发、重复运行和关闭后运行。
- `collectFinalState()`：运行成功后、close 前显式读取末日快照；可能补加载行情并失败，调用方仍须在 finally 中关闭资源。普通回测和扫描不调用此方法。
- `factorDependencies`：读取已解析的血缘副本，不暴露内部可变状态。Signals 在调用 run 前自行核对冻结快照，执行对象不接收历史快照或决定部署规则。
- `close()`：释放因子和策略资源，可重复调用。调用方必须在 `try/finally` 中关闭对象；运行成功或失败均适用。强制终止 Worker 不保证执行 finally，仍由通用任务回收机制处理。

正式回测的因子来源准备与风险后处理归 backtests/run；扫描组合归 scans/run，每个参数及日期区间创建独立对象；部署验证归 signals/deployments/manage，信号整理归 signals/runs/run。执行对象不查询用户、不写 Job 或报告，不定义 backtest/scan/signal 业务模式。语言加载和逐 bar 协议继续归 runtime，交易算法归 Engine。

测试见 [execution.test.ts](execution.test.ts)。执行 fixture 辅助函数放在各自的 `.test.ts` 文件内；Worker 测试入口直接使用执行对象，不另建 testing 目录。

[factor-host.ts](factor-host.ts) 接收 StrategyFactor[]，管理 TS/Python 运行实例与组合组件，按因子串行计算并检查输入输出；实现 Engine 的 FactorExecutionPort。describe 返回的定义包含运行 window / inputs、辅助历史字段及批准资产范围，不包含源码。EngineConfig 仅接收 factorExecution，不再另传 customFactors。部署准入也直接使用本宿主，运行资源归调用方关闭。测试见 [factor-host.test.ts](factor-host.test.ts)。

Engine 不区分回测、扫描或 Signals 业务模式。快照保存复权口径的现金仓位、待执行指令、持续条件单、期货账户及意图、行情证据与末日因子观测。Signals 在自己的 [projection.ts](../../signals/runs/projection.ts) 中换算真实股数、价格并生成每日指令。
