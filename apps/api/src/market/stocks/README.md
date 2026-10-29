# 股票名录、行情与交易约束

| 文件 / 入口 | 调用方与职责 |
| --- | --- |
| [sync-partition.ts](sync-partition.ts) / [write.ts](write.ts) | 正式同步：来源完整性、名称历史和四种独立日截面；显式 Prisma 写入 |
| [basic-sync.ts](basic-sync.ts) `syncStockBasic`、`seedStockCodeChanges`、`syncStockNameHistory` | 底层映射与测试；名录、历史代码和名称写入，身份规则用 instruments |
| [daily-sync.ts](daily-sync.ts) `syncStockDailyData` | 低层整体校验与测试；某日 daily、adj_factor、daily_basic、stk_limit 候选校验后一次发布 |
| 同文件 `syncDaily`、`syncDailyBasic`、`syncStkLimit` | 低层映射与测试；各自现有范围／写入规则，不等价于四表发布 |
| [read.ts](read.ts) `stockCodesWithDailyData` | 已有行情证券集合的只读查询，不查询供应商 |

`syncStockDailyData` 先并行获取四类候选（client 实际通道仍串行），统一历史代码并检查日期、重复及覆盖，所有检查成功后才在一个数据库事务中替换四表。任一候选无效不会先发布其中一表。该事务不包括网络请求，也不代表 Maintenance 水位已发布。

其他范围入口保留各自跳过、刷新和写入行为；不能将 core 的保证推广到 `syncDaily` 等调用组合。历史代码和名称约束先看 [instruments](../instruments/README.md)，财报和分红归 [fundamentals](../fundamentals/README.md)，跨资产展示查询归 [queries](../queries/README.md)。

改每日门禁看 [daily-sync.test.ts](daily-sync.test.ts)；改供应商字段看 [stock-reference-api.test.ts](../providers/tushare/stock-reference-api.test.ts)、[reference-data-api.test.ts](../providers/tushare/reference-data-api.test.ts)；发布编排与整体修复见 [Maintenance](../../maintenance/README.md)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[daily-quality.ts](daily-quality.ts) 检查股票日线关联覆盖及旧代码残留；[repair.ts](repair.ts) 查缺、制定修复建议并执行股票数据补齐。[audit.ts](audit.ts) 检查日历覆盖、空值、复权跳变、历史可投资性及样本窗口；阈值与 PIT 语义保持。Maintenance 选择真实日期窗口；正式流程独立接纳价格、复权、估值和涨跌停，合法价格不因辅助输入缺失丢失。写入、窗口资格和 revision 随同一短事务提交，不触发已退役派生计算。
