# ETF 数据

`sync-partition.ts` 只同步上市（L）和退市（D）基础目录，在映射和校验前跳过待上市（P）；价格与复权只下载 [管理员名单](../downloads/README.md) 中的代码。上市／退市日期约束请求窗口。字段省略不清除已知信息，未知空响应不删除历史。

历史份额／规模／净值同步、SDK、研究清单与专用审计已退役。`EtfLatestSize` 只保存最新同日规模快照，供初始化或显式重选；不参与历史研究。旧 `sync.ts`、`recovery.ts` 及 registry 审计已删除；`history-sync.ts` 仅保留价格与复权低层映射，正式写入口统一走 Maintenance。

[write.ts](write.ts) 显式合并目录、行情和复权；只在已验证完整范围内删除缺席记录，未知空连续序列不删除。

维护协调与覆盖见 [Maintenance](../../maintenance/README.md)。

退市代码留在已保存名单中，只补退市日及以前的价格／复权；退市日缺失、非法或早于回补起点时跳过该代码并报告缺口，其他代码继续。`download-range.ts` 为名单查询、同步窗口和缺口摘要提供同一边界。部署时通过 `market/cli/cleanup-pending-etfs.ts` 离线清理无依赖的旧 P 记录；已有行情、复权、规模、历史标记、同步状态／分区、名单引用或上市日期的记录保留并报告。
