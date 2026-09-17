# TypeScript 因子适配

本目录把 TS 定义编译为可调用、需释放的因子对象，不运行正式报告生命周期。公共编译／isolate 设施来自 [Infra runtime](../../../infra/runtime/README.md)。

| 文件 / 入口 | 输入输出与消费者 |
| --- | --- |
| [compile-factor.ts](compile-factor.ts) `compileFactor` | 源码和可选日志 sink → 横截面对象，含 `computeBatch`、窗口／覆盖元数据及 `dispose`；供横截面序列、定义校验等使用 |
| [compile-asset-factor.ts](compile-asset-factor.ts) `compileTimeSeriesFactor`、`compilePanelFactor` | 源码 → V2 资产因子，含 inputs、targetAssetClasses、window、`computeSeries` 与 `dispose`；供共享评估、发布及 Strategy 准备使用 |
| [sdk.ts](sdk.ts) `defineFactor` 及类型 | TS 编写契约；Engine 的纯类型消费者可直接引用，不经过编译入口 |

编译先转 CommonJS，再在 isolate 加载并验证元数据；初始化失败由实现释放，成功返回后由调用方在 finally 调用 dispose。求值保持请求顺序；资产数组按交易日对齐，未声明字段访问、窗口、缺值和单点错误处理依照 setup 实现。日志在跨 isolate 调用后转发，计算错误的首条提示有去重。

这些函数不检查 userId、发布状态或报告资格；调用方必须先做所属业务的准入。Python 通过兼容宿主形状接入，不因此共用 TS 源码或公开字段名称。

改横截面看 [compile-factor.test.ts](compile-factor.test.ts)；改 V2 看 [compile-asset-factor.test.ts](compile-asset-factor.test.ts) 及 [Strategy 准备测试](../../../strategy/factor-inputs/prepare.test.ts)。返回 [运行能力说明](../README.md)。

[返回 Factor 总览](../../README.md)
