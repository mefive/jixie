# 股票名录、行情与交易约束

| 文件 / 入口 | 调用方与职责 |
| --- | --- |
| [sync-partition.ts](sync-partition.ts) / [write.ts](write.ts) | 正式同步：来源完整性、名称历史和四种独立日截面；显式 Prisma 写入 |
| [read.ts](read.ts) `stockCodesWithDailyData` | 已有行情证券集合的只读查询，不查询供应商 |


下载和写入使用同一正式入口。历史代码和名称约束先看 [instruments](../instruments/README.md)，财报和分红归 [fundamentals](../fundamentals/README.md)，跨资产展示查询归 [queries](../queries/README.md)。

改每日门禁看 [sync-partition.test.ts](sync-partition.test.ts)；改供应商字段看 [stock-reference-api.test.ts](../providers/tushare/stock-reference-api.test.ts)、[reference-data-api.test.ts](../providers/tushare/reference-data-api.test.ts)；发布编排与整体修复见 [Maintenance](../../maintenance/README.md)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[daily-quality.ts](daily-quality.ts) 检查股票日线关联覆盖及旧代码残留；补齐工作统一交给 Maintenance 的窗口循环。[audit.ts](audit.ts) 检查日历覆盖、空值、复权跳变、历史可投资性及样本窗口；阈值与 PIT 语义保持。Maintenance 选择真实日期窗口；正式流程独立接纳价格、复权、估值和涨跌停，合法价格不因辅助输入缺失丢失。写入、窗口资格和 revision 随同一短事务提交，不触发已退役派生计算。

正式下载只通过 `sync-partition.ts` 的领域准备和 `write.ts` 的类型化写入。旧的独立下载／替换实现已移除，测试使用同一入口。
