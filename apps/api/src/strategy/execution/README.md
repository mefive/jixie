# 策略执行

[execution.ts](execution.ts) 的 `StrategyExecution` 持有一次运行的策略 runtime 和 FactorHost，并在内部调用宿主 Engine。回测、扫描和 Signals 使用相同的对象接口，不需要自行装配 Engine，也不依赖按业务命名的执行入口。

- `create(inputs)`：接收源码、语言、参数、数据端口、日志和已准备的因子，启动运行资源，通过 StrategyFactor.resolveAll 解析一组新的因子对象，避免修改准备阶段共享的实例；因子统一通过 `factors: StrategyFactor[]` 传入，每项为持有源码、身份和运行配置的 StrategyFactor 实例。初始化失败时释放已经创建的资源。
- `run(options)`：接收日期、资金、成本与可选的 `captureSignals`，调用 Engine，按选项返回计算结果或带末日信号捕获的结果；传入 factors 时，完整输入血缘附加到结果。一个对象只能运行一次，拒绝并发、重复运行和关闭后运行，避免用户代码状态跨计算复用。
- `factorDependencies`：读取已解析的血缘副本，不暴露内部可变状态。Signals 在调用 run 前自行核对冻结快照，执行对象不接收历史快照或决定部署规则。
- `close()`：释放因子和策略资源，可重复调用。调用方必须在 `try/finally` 中关闭对象；运行成功或失败均适用。强制终止 Worker 不保证执行 finally，仍由通用任务回收机制处理。

正式回测的因子来源准备与风险后处理归 backtests/run；扫描组合归 scans/run，每个参数及日期区间创建独立对象；部署验证归 signals/deployments/manage，信号整理归 signals/runs/run。执行对象不查询用户、不写 Job 或报告，不定义 backtest/scan/signal 业务模式。语言加载和逐 bar 协议继续归 runtime，交易算法归 Engine。

测试见 [execution.test.ts](execution.test.ts)。执行 fixture 辅助函数放在各自的 `.test.ts` 文件内；Worker 测试入口直接使用执行对象，不另建 testing 目录。
