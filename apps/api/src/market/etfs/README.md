# ETF 数据

`sync-partition.ts` 同步全量基础目录；价格与复权只下载 [管理员名单](../downloads/README.md) 中的代码。上市／退市日期约束请求窗口。字段省略不清除已知信息，未知空响应不删除历史。

历史份额／规模／净值同步、SDK、研究清单与专用审计已退役。`EtfLatestSize` 只保存最新同日规模快照，供初始化或显式重选；不参与历史研究。旧 `sync.ts`、`recovery.ts` 及 registry 审计已删除；`history-sync.ts` 仅保留价格与复权低层映射，正式写入口统一走 Maintenance。

[write.ts](write.ts) 显式合并目录、行情和复权；只在已验证完整范围内删除缺席记录，未知空连续序列不删除。

维护协调与覆盖见 [Maintenance](../../maintenance/README.md)。
