# Engine 后端阅读地图

Engine 提供交易模拟能力：推进交易日、读取当时可得的数据、执行策略、模拟成交并累计绩效。策略保存、任务提交、语言选择和报告风险分析由 Strategy 负责。

Engine 接收 `EngineStrategy` 决策回调与显式端口，按模拟日期提供 `EngineContext`。这两个内部接口
不是用户编写策略的公开类型；公开 `StrategyCtx` 由 shared SDK 契约生成，Strategy SDK/runtime 负责适配。
选股、权重构造、指标便捷接口归 Strategy SDK；数据可见时间、因子准备、成交和账户变化归 Engine。

## 从职责找文件

| 职责 | 入口 |
| --- | --- |
| 模拟主循环、信号捕获、绩效结果 | [simulation/run.ts](simulation/run.ts) |
| 股票/ETF 与期货账户和交易规则 | [simulation/portfolio.ts](simulation/portfolio.ts)、[simulation/futures-portfolio.ts](simulation/futures-portfolio.ts) |
| 逐日持仓/成本/再平衡归因累计 | [simulation/allocation-analysis.ts](simulation/allocation-analysis.ts) |
| 所需数据接口 | [data/data-port.ts](data/data-port.ts) |
| 缓存、截面、复权、历史状态等数据语义 | [data/engine-data.ts](data/engine-data.ts) |
| 自定义因子输入准备、当日缓存与数值合成 | [factors/custom-factor.ts](factors/custom-factor.ts) |
| 宿主数据库读取 | [adapters/prisma-port.ts](adapters/prisma-port.ts) |
| 宿主 TS/Python 因子沙箱管理 | [adapters/factor-host.ts](adapters/factor-host.ts) |
| 独立于存储的数据批次计算契约 | [factors/execution-port.ts](factors/execution-port.ts) |
| 确定性测试数据源 | [testing/fixture-port.ts](testing/fixture-port.ts) |
| 引擎输入、策略接口与结果类型 | [types.ts](types.ts) |

回测线程入口位于 [strategy/backtests/worker.ts](../strategy/backtests/worker.ts)，调用同目录 `run.ts` 编排正式回测，由 `backtests/strategy-backtest-lifecycle.ts` 启动。`signal-worker.*` 已归入 [signals/runs](../signals/runs/signal-worker.ts)，由 Signals 任务启动。Agent 快速回测工具及其专用 Worker 已于 2026-09-10 退役，策略对话生成代码后由用户在工作台显式回测。

## DataPort 与沙盒如何协作

`EngineConfig.dataPort` 是必填项。模拟核心只通过 `EngineDataPort` 读取外部数据，不再导入 Prisma 或选择默认数据库；调用方负责选定端口。数据端口的方法和金融口径没有改变。

- 正式策略执行由 [strategy/backtests/run.ts](../strategy/backtests/run.ts) 选择语言和宿主 Prisma 端口；TS/Python 因子均由宿主 FactorHost 执行，调用方通过 `EngineConfig.factorExecution` 显式传入并负责关闭。
- 仓库策略的直接执行入口和回测脚本显式传入 Prisma 端口；测试显式传入 fixture 端口。
- TS/Python 用户策略均经 [共享模拟](../strategy/execution/simulation.ts) 使用宿主 Engine。TS runtime 创建
  isolate，仅在其中加载 [SDK bundle](../strategy/runtime/typescript/sandbox-bundle.ts) 与用户源码；Python
  runtime 连接 sandboxd。二者复用 [业务 bridge](../strategy/runtime/bridge.ts)，沙箱不能访问 DataPort。

SDK bundle 不包含 Engine、宿主适配器、数据库或 Node 内建模块；`metafile` 用于约束实际依赖。

自定义因子源码不再由 Engine 直接求值。FactorHost 统一调用 `FactorRuntime.start({ language, analysisKind, code })`，通过 metadata / execute / close 使用 TS 或 Python 因子实例，执行位置不依赖策略语言。
宿主 Engine 通过 FactorExecutionPort 调用 FactorHost，DataPort 只负责读取市场数据。每日回调前、截面加载和
`ensureBars` 后批量准备值；当日首次读取固定结果，未读取的提前计算结果可在输入加载后刷新。

纯核心包含 `simulation`、`data`、`factors` 及其纯辅助依赖；Engine 的 `adapters` 和业务模块中的 Worker 可以使用 Node/数据库。SDK bundle 不包含这些宿主能力。

## Review 与验证定位

本轮交易循环、账户规则、复权、手续费、历史状态、因子求值和归因算法不变。主要检查所有 `runStrategy` / 信号捕获调用者是否提供正确端口，以及 TS 源码与编译 JS 的 Worker、cell 子进程、sandbox entry 路径是否对应。

`simulation`、`data`、`factors` 下既有测试保持原断言；[runtime.test.ts](../strategy/runtime/typescript/typescript-strategy-runtime.test.ts)
比较可信原生 fixture 与沙箱回调的净值、成交和信号，[sandbox-bundle.test.ts](../strategy/runtime/typescript/sandbox-bundle.test.ts)
检查 bundle 不含 Engine 或宿主能力。本次迁移验证状态见 [执行边界设计](../../../../docs/design/python-and-sandbox.md)。
