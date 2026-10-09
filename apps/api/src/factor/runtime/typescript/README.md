# TypeScript 因子运行

业务消费者调用 [FactorRuntime.start](../factor-runtime.ts)，传 `language: 'typescript'`、analysisKind、code 和可选日志 sink；返回实例具有 `metadata / execute / close`。宿主类型归 [contract.ts](../contract.ts)，不再从语言目录导出 Compiled 对象或 compile 工厂。

| 文件 / 入口 | 职责与消费者 |
| --- | --- |
| [prepare.ts](prepare.ts) | 宿主编译因子、缓存 bundle、准备 TypeScriptTransport 与 bridge 配置；资源获取和关闭交给公共 FactorRuntime |
| [entry.ts](entry.ts) | 外围接入：注册 __receiveCommand、解析 JSON、缓冲并刷新日志；首次 factor_start 调用 runFactor 并接入后续消息处理 |
| [adapter.ts](adapter.ts) | FactorAdapter：历史字段映射、数组/索引读取和声明输入访问；无宿主请求 |
| [runner.ts](runner.ts) | 显式 runFactor 入口与 FactorRunner：源码加载、元数据、start/compute 分派及用户回调 |
| [sandbox-bundle.ts](sandbox-bundle.ts) | 打包 entry/runner、SDK、日志；源码/编译入口分别解析 entry.ts / entry.js |
| [SDK typescript.ts](../../sdk/typescript.ts) | defineFactor/defineFactorV2、CrossSectionalFactorContext/AssetFactorContext；history/value/lag 只读取已准备的数据 |

与 Strategy 对应的 runner 类型使用 `FactorRunnerHost`、`FactorRunnerStartup`、`FactorRunnerCommand`、`FactorRunnerCommandHandler`。每个沙箱会话只创建一个 FactorRunner，定义、分析类型和声明输入均为实例状态；方法顺序为 handle、start、execute、loadFactor、metadata、computeValues，与 Python 的同名 snake_case 方法对应。业务入口同样按“创建实例 → 启动 → 接入消息处理”排列。FactorAdapter 将本地预备数据转为 SDK Capabilities，再构造 SDK Context；本地数组读取同样由 Adapter 提供。

用户源码通过 `new Function` 求值，工厂作为函数参数注入，与 Strategy 的 `defineStrategy` 相同。横截面只提供 `defineFactor`，time_series/panel 只提供 `defineFactorV2`；用户直接调用相应工厂，计算回调通过闭包保留该参数。运行时不向 `globalThis` 注册这两个工厂，显式通过 `globalThis.defineFactor` / `globalThis.defineFactorV2` 调用不受支持。

公共 FactorRuntime 直接继承 SandboxRuntime，通过 startSandboxRuntime 获取资源并建立 [共享 bridge](../bridge.ts)。启动发送 factor_start、等待 factor_ready；execute 发送 factor_compute_batch/series、等待 factor_values。横截面输入 `{ items }`，time_series/panel 输入 `{ fields, indexes }`，返回顺序对应的 `(number | null)[]`。传输入口只加载可信 bundle，用户源码在启动命令中求值。

整批输入一次传输，SDK history/value/lag 在 isolate 内读已准备数组。逐点异常或非有限值仍返回 null，首次计算错误去重，结果数量必须匹配输入。isolate 仍无 Node/数据库能力、禁止外部 require；256 MiB 内存、5 秒声明、30 秒整批计算预算不变。传输帧及累计队列限额 256 MiB，避免直接套用 Strategy 的一万帧限制截断 Factor 日志。

日志在调用 console 时立即格式化，随后在沙箱内缓冲；达到 256 条或 64 KiB 序列化 UTF-8 字节时，以 log_batch 跨桥，命令正常返回前刷新尾部。公共 exchange 保留级别和顺序，逐条调用现有 onUserLog。单条超出批量阈值的日志先刷新前面的队列，再使用原 log 帧单独发送，仍受传输限额约束。普通命令异常退出时尽力刷新，不覆盖原错误；强制终止、超时或传输故障不保证尾部日志送达。日志可能延迟到下一阈值或命令结束，没有定时器刷新。实测结果及比较限制见统一方案文末。

启动失败由公共启动流程回收，成功后所有者必须 finally close，close 同步幂等。业务准入、用户权限和正式报告生命周期不归这里。

验证入口：[cross-sectional-runtime.test.ts](cross-sectional-runtime.test.ts)、[asset-runtime.test.ts](asset-runtime.test.ts)、[factory-injection.test.ts](factory-injection.test.ts)、[lifecycle.test.ts](lifecycle.test.ts)、[sandbox-bundle.test.ts](sandbox-bundle.test.ts)。审查/验证状态见 [统一方案](../../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Factor runtime](../README.md)

两个语言 Adapter 都按输入类型 → FactorAdapter.bind → BoundCrossSectionalFactorCapabilities → BoundAssetFactorCapabilities 排列。bind 使用可辨识输入与重载，横截面和资产输入分别对应其能力类型；每点绑定独立索引／历史，Adapter 在会话内复用。
