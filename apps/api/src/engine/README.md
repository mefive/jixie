# Engine 后端阅读地图

Engine 提供交易模拟能力：推进交易日、读取当时可得的数据、执行策略、模拟成交并累计绩效。策略保存、任务提交、语言选择和报告风险分析由 Strategy 负责。

## 从职责找文件

| 职责 | 入口 |
| --- | --- |
| 模拟主循环、信号捕获、绩效结果 | [simulation/run.ts](simulation/run.ts) |
| 股票/ETF 与期货账户和交易规则 | [simulation/portfolio.ts](simulation/portfolio.ts)、[simulation/futures-portfolio.ts](simulation/futures-portfolio.ts) |
| 逐日持仓/成本/再平衡归因累计 | [simulation/allocation-analysis.ts](simulation/allocation-analysis.ts) |
| 所需数据接口 | [data/data-port.ts](data/data-port.ts) |
| 缓存、截面、复权、历史状态等数据语义 | [data/engine-data.ts](data/engine-data.ts) |
| 引擎内自定义因子求值 | [factors/custom-factor.ts](factors/custom-factor.ts) |
| 宿主数据库读取 | [adapters/prisma-port.ts](adapters/prisma-port.ts) |
| 宿主 Python 因子计算桥 | [adapters/python-factor-host.ts](adapters/python-factor-host.ts) |
| 确定性测试数据源 | [testing/fixture-port.ts](testing/fixture-port.ts) |
| 引擎输入、策略接口与结果类型 | [types.ts](types.ts) |

`backtest-worker.ts` 是回测计算线程入口，调用 Strategy 的配置执行编排；它属于宿主入口，不属于纯模拟核心。`signal-worker.*` 与 `agent-backtest-worker.*` 暂留根级，按开发计划分别在 Commit 9/10 归回 Signals/Agent。

## DataPort 与沙盒如何协作

`EngineConfig.dataPort` 是必填项。模拟核心只通过 `EngineDataPort` 读取外部数据，不再导入 Prisma 或选择默认数据库；调用方负责选定端口。数据端口的方法和金融口径没有改变。

- 正式策略执行由 [strategy/execution/run-configured.ts](../strategy/execution/run-configured.ts) 选择语言和宿主 Prisma 端口；Python 因子需要时在宿主端口外接计算桥。
- 仓库策略的直接执行入口和回测脚本显式传入 Prisma 端口；测试显式传入 fixture 端口。
- 用户/Agent 编写的 TS 策略由 [strategy/runtime/typescript/walled-run.ts](../strategy/runtime/typescript/walled-run.ts) 创建 isolate。墙内 [wall-entry.ts](../strategy/runtime/typescript/wall-entry.ts) 使用代理 DataPort，通过宿主提供的调用边界请求数据，然后在墙内运行同一个模拟核心。

[wall-bundle.ts](../strategy/runtime/typescript/wall-bundle.ts) 使用 esbuild 的 neutral 平台打包真实 SDK 和 Engine，宿主按进程缓存结果。原来用于替换 `prisma-port` 的插件已经移除：核心自身没有该依赖，打包不再需要制造替身。`metafile` 用于检查实际依赖，生产仍只取 bundle 文本；不会把宿主适配器、数据库或 Node 内建模块带进 isolate。

纯核心包含 `simulation`、`data`、`factors` 及其纯辅助依赖；`adapters` 和 Worker 可以使用 Node/数据库。不能因为顶层目录都叫 Engine，就把宿主入口也加入墙内 bundle。

## Review 与验证定位

本轮交易循环、账户规则、复权、手续费、历史状态、因子求值和归因算法不变。主要检查所有 `runStrategy` / 信号捕获调用者是否提供正确端口，以及 TS 源码与编译 JS 的 Worker、cell 子进程、wall entry 路径是否对应。

`simulation`、`data`、`factors` 下既有 `.test.ts` 保持原断言；[walled-run.test.ts](../strategy/runtime/typescript/walled-run.test.ts) 比较 direct/walled 的真实结果，新增 [wall-bundle.test.ts](../strategy/runtime/typescript/wall-bundle.test.ts) 检查无宿主依赖的 bundle。上述用例已随全量 API 198 文件/1065 项测试通过，API 编译通过；真实源码/编译 Worker 均执行实际 wall bundle，净值、成交和扫描指标一致。Python 编译入口使用本地 socket 对接真实 runner，未覆盖生产容器隔离；详情见 [开发计划](../../../../docs/design/backend-architecture-refactor.md#78-commit-8-实现记录2026-09-09完成)。
