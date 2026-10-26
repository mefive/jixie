# 发布与归档

本能力将当前定义与可用证据绑定，并维护 published / archived 。草稿写入归 [definitions](../definitions/README.md)，分析报告归 [evaluations](../evaluations/README.md)。

| 文件 / 入口 | 调用方式与结果 |
| --- | --- |
| [factor.ts](factor.ts) `publishFactor`、`archiveFactor` | definition 路由传 userId、factorId；发布还传 approvedReportId，返回发布资源或业务拒绝；归档找不到可转状态对象时返回 null |

单因子发布要求本人 draft 和本人已完成报告，分析类型、语言、runtimeVersion、冻结源码和哈希匹配。宏观报告另检查 as_available 和 PIT 资格，资产因子编译检查受控研究输入，编译失败按报告无效处理。编译对象在 finally 释放。

发布先在事务外读取与编译验证，再在同一事务内确认报告仍存在，并以 draft 与原源码／定义条件更新状态；不把编译放进数据库事务。报告清理事务保护发布绑定，即使归档也保留。发布不开放跨用户访问；归档仅更新状态和归档时间。已有消费者能否使用 archived，由 [Strategy 因子准备](../../strategy/factors/README.md) 按场景判断。



[返回 Factor 总览](../README.md)
