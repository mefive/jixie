# TypeScript 因子运行

业务消费者调用 [FactorRuntime.start](../factor-runtime.ts)，传 `language: 'typescript'`、analysisKind、code 和可选日志 sink；返回实例具有 `metadata / execute / close`。宿主类型归 [contract.ts](../contract.ts)，不再从语言目录导出 Compiled 对象或 compile 工厂。

[typescript-factor-runtime.ts](typescript-factor-runtime.ts) 中 `TypeScriptCrossSectionalFactorRuntime` 和 `TypeScriptAssetFactorRuntime` 直接继承公共 SandboxRuntime。横截面 execute 接收 `{ items }`；time_series/panel 接收 `{ fields, indexes }`，返回顺序对应的 `(number | null)[]`。两类形状来自不同作者计算契约，语言选择不改变业务含义。

[sandbox-bundle.ts](sandbox-bundle.ts) 打包 [sandbox-entry.ts](sandbox-entry.ts)、纯 [SDK](../../sdk/README.md) 及无 Node 依赖的 [日志缓冲](../../../infra/runtime/log-buffer.ts)；开发入口为 `.ts`，生产为 `.js`。公共 TypeScriptTransport 创建 isolate 并加载入口后，runtime 通过 exchange 发送 factor_start 加载用户源码、等待 factor_ready；execute 发送 factor_compute_batch/series，最终收到 factor_values。所有启动、日志、计算结果都经公共循环，业务不再调用 callJson。

整批输入一次传输，SDK history/value/lag 在 isolate 内读已准备数组。逐点异常或非有限值仍返回 null，首次计算错误去重，结果数量必须匹配输入。isolate 仍无 Node/数据库能力、禁止外部 require；256 MiB 内存、5 秒声明、30 秒整批计算预算不变。传输帧及累计队列限额 256 MiB，避免直接套用 Strategy 的一万帧限制截断 Factor 日志。

日志在调用 console 时立即格式化，随后在沙箱内缓冲；达到 256 条或 64 KiB 序列化 UTF-8 字节时，以 log_batch 跨桥，命令正常返回前刷新尾部。公共 exchange 保留级别和顺序，逐条调用现有 onUserLog。单条超出批量阈值的日志先刷新前面的队列，再使用原 log 帧单独发送，仍受传输限额约束。普通命令异常退出时尽力刷新，不覆盖原错误；强制终止、超时或传输故障不保证尾部日志送达。日志可能延迟到下一阈值或命令结束，没有定时器刷新。实测结果及比较限制见统一方案文末。

启动失败由公共启动流程回收，成功后所有者必须 finally close，close 同步幂等。业务准入、用户权限和正式报告生命周期不归这里。

验证入口：[typescript-cross-sectional-factor-runtime.test.ts](typescript-cross-sectional-factor-runtime.test.ts)、[typescript-asset-factor-runtime.test.ts](typescript-asset-factor-runtime.test.ts)、[lifecycle.test.ts](lifecycle.test.ts)、[sandbox-bundle.test.ts](sandbox-bundle.test.ts)。审查/验证状态见 [统一方案](../../../../../../docs/design/sandbox-runtime-architecture.md)。

[返回 Factor runtime](../README.md)
