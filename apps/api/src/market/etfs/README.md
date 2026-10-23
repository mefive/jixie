# ETF 数据

统一写流程通过 `sync-partition.ts` 独立准备 ETF 元数据、日价格、复权和份额。对象来自研究 registry 和活跃部署 watch，实际历史边界结合上市/退市日期与项目固定基线。元数据完整性不以当日价格最大日期替代；缺失基金补充字段不能清除已知信息。

各来源分区保存自己的覆盖和待办，未完成价格/复权不撤销已经取得的另一类合法数据。连续序列需要日历与实际观察范围证明；份额使用严格下一 SSE 交易日的 availableDate。未知空响应不删除已有历史；只有完整权威范围允许精确替换。维护协调、有限预算与消费者资格见 [Maintenance](../../maintenance/README.md)。

原 `history-sync.ts`、`sync.ts`、`recovery.ts` 的低层映射/审计测试保留用于业务口径对照，不再公开独立 CLI 或维护工作流。`history-coverage.ts`、`registry-audit.ts` 与 `audit.ts` 继续提供只读审计；它们不是新分区覆盖的替代证据。
