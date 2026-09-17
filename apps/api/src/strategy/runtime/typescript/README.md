# TypeScript 策略墙内运行

数据库中的策略源码在 isolated-vm 中执行，实际 Engine 核心由 bundle 放入墙内；宿主显式提供 DataPort 和日志，不能用 Prisma stub 替代核心。

| 文件 / 入口 | 使用方与契约 |
| --- | --- |
| [walled-run.ts](walled-run.ts) `runWalledBacktest` | 正式 TS 回测、扫描 cell；传冻结配置、已准备因子、DataPort 及日志，返回模拟结果 |
| 同文件 `runWalledSignalCapture` | Signals IPC Worker；相同模拟能力附加最后交易日的下一开盘意图 |
| 同文件 `inspectWalledStrategyParameters`、`inspectWalledStrategyMetadata` | 扫描参数检查、Signals 部署和数据准备；只检查声明，取市场数据会拒绝；每次检查 finally 释放 isolate |
| [wall-bundle.ts](wall-bundle.ts) `buildWallBundle`、[wall-entry.ts](wall-entry.ts) | 构建真实 Engine 的 neutral bundle 及墙内入口；进程内复用 bundle，源码／编译路径分别解析 |
| [compile.ts](compile.ts) `compileStrategy`；[sdk.ts](sdk.ts) `defineStrategy`、`enrich` | 既有编译及编写契约，供生成校验／测试等消费者；正式数据库回测入口使用 walled-run |
| [codegen-prompt.ts](codegen-prompt.ts) `buildCodegenPrompt` | TS Strategy profile 的生成提示词 |

宿主先把用户源码转 CommonJS，再创建 isolate，挂载取数／日志桥并加载 bundle。运行 finally 关闭 PythonFactorHost、释放 isolate；Python 因子可通过宿主桥参与 TS 策略，但不能把用户 TS 移到宿主直接执行。因子权限由 [factor-inputs](../../factor-inputs/README.md) 在此前检查。

改运行边界看 [walled-run.test.ts](walled-run.test.ts)、[wall-bundle.test.ts](wall-bundle.test.ts)；改 SDK／参数看 [sdk.test.ts](sdk.test.ts)、[params.test.ts](params.test.ts)、[sdk-reference.test.ts](sdk-reference.test.ts)；编译看 [compile.test.ts](compile.test.ts)。[walled-run.test-worker.mjs](walled-run.test-worker.mjs) 仅供测试，不能被生产导入。运行路径见 [清单](../../../../../../docs/backend-runtime-entries.md)。

[返回 Strategy 总览](../../README.md)
