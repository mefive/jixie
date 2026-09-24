# 共享策略模拟

[simulation.ts](simulation.ts) 提供 `runSandboxedBacktest` 和 `runSandboxedSignalCapture`。调用方传入日期、资金、成本、数据端口和已准备的因子；本能力创建策略 runtime 与 FactorHost，初始化一次因子元数据、检查输入准入及调用方提供的冻结血缘，适配 EngineStrategy 并复用因子实例执行模拟，finally 关闭资源。两个公开入口分别返回回测结果和带末日信号捕获的结果。

正式回测的因子来源准备与风险后处理归 backtests/run；完整输入血缘在初始化后附加到结果；扫描组合归 scans/run；部署验证归 signals/deployments/manage，信号整理归 signals/runs/run。共享模拟不查询用户、不写 Job 或报告。语言加载和逐 bar 协议继续归 runtime。

这是 Strategy 内部真实共享的模拟能力，不是跨业务执行框架。不新增 Session 或 Runner 类；函数位置参数保持，配置增加可选依赖记录与待验证快照。资源与结果回归复用 Strategy runtime、Engine 因子组合以及源码/编译 Worker 测试。
