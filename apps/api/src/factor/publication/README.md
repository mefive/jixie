# 发布、归档与公开范围

本能力将当前定义与可用证据绑定，并维护 published / archived 及 visibility。草稿写入归 [definitions](../definitions/README.md)，评估和 holdout 揭示归 [evaluations](../evaluations/README.md)。

| 文件 / 入口 | 调用方式与结果 |
| --- | --- |
| [factor.ts](factor.ts) `publishFactor`、`archiveFactor` | definition 路由传 userId、factorId；发布还传 approvedReportId，返回发布资源或业务拒绝；归档找不到可转状态对象时返回 null |
| [panel-composite.ts](panel-composite.ts) `publishPanelComposite`、`archivePanelComposite` | composite 路由；校验组合与证据后更新组合状态 |
| [visibility.ts](visibility.ts) `setFactorVisibility`、`setCompositeVisibility` | 定义／组合路由；拥有者调整公开范围，继续遵循资源状态限制 |

单因子发布要求本人 draft 和本人已完成报告，分析类型、语言、runtimeVersion、冻结源码和哈希匹配；未揭示 holdout 不能作为可用证据。宏观报告另检查 as_available 和 PIT 资格，资产因子编译检查受控研究输入，编译失败按报告无效处理。编译对象在 finally 释放。

发布先查询／验证，再以 draft 条件更新状态，并未用一个事务包住所有查询和编译。不得将它写成已具备全链路锁定。归档使资源私有；已有消费者能否使用 archived，由 [Strategy 因子准备](../../strategy/factor-inputs/README.md) 按场景判断。可见性与因子是否可运行不是同一开关。

Panel 组合证据检查先读 panel-composite，再读 [composition/panel-source.ts](../composition/panel-source.ts)；不要直接复用单因子源码相等判断。共用错误类型 `FactorPublicationError` 在 [errors.ts](../errors.ts)，HTTP 映射在 routes，纯语言／类型映射在 definitions/views。

修改准入先看 [factor.test.ts](factor.test.ts)、[panel-composite.test.ts](panel-composite.test.ts) 与 [路由集成测试](../routes/index.integration.test.ts)。方法背景见 [因子研究纪律](../../../../../docs/design/factor-research-discipline.md)、[Factor 到 Strategy](../../../../../docs/design/factor-to-strategy.md)。

[返回 Factor 总览](../README.md)
