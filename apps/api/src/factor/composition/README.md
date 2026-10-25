# 因子组合

组合定义的草稿操作、来源冻结和数值组合在此；正式报告归 [evaluations](../evaluations/README.md)，Panel 发布归 [publication](../publication/README.md)。横截面组合与 Panel 组合保留不同定义和使用条件。

| 文件 / 入口 | 用途与主要调用方 |
| --- | --- |
| [operations.ts](operations.ts) `readFactorComposite`、`createFactorComposite`、`updateFactorComposite`、`deleteFactorComposite`、`copyFactorComposite` | composite 路由；接收用户、组合 ID 或定义，返回资源投影并按操作写库 |
| [panel-source.ts](panel-source.ts) `resolvePanelFactorSource` | 正式评估提交；按用户解析模板、自定义 Panel 或组合，将定义和组件源码交给计算侧 |
| [composite.ts](composite.ts) `combineFactorSeries`、`combinePanelFactorObservations` | 横截面评估与共享评估执行；对已准备的组件值做标准化、方向与组合计算，不创建报告 |

组合只允许本人读取和复制。复制会创建新草稿并沿用组件引用，不复制组件；外部用户的已发布组合也不可读取或复制。草稿编辑／删除与发布状态检查由 operations 自己承担。

更改组件读取或冻结格式时，一并查看 [sources](../sources/README.md) 与 [Strategy 因子输入](../../strategy/factors/README.md)：策略消费已批准报告中的 Panel 组合快照及研究资产范围，不应临时换成当前可编辑组件。

数值规则看 [composite.test.ts](composite.test.ts)；归属隔离、自有组合复制和草稿操作看 [路由集成测试](../routes/index.integration.test.ts)；发布准入看 [panel-composite.test.ts](../publication/panel-composite.test.ts)。设计背景见 [多因子合成](../../../../../docs/design/multi-factor-composition.md)。

[返回 Factor 总览](../README.md)
