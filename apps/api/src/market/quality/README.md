# Market 共享质量结果

- [report.ts](report.ts)：各 Market 数据域使用的 AuditFinding / AuditStatus 与序列 PIT 结果类型；Maintenance 作为消费者汇总，不拥有这些数据契约。
- [coverage.ts](coverage.ts)：根据明确的交易日和观测计数计算首尾／内部缺口、行数陡降及 finding；数据库读取分别在 stocks 和 indices。
- [format.ts](format.ts)：审计结果共同使用的数字、百分比及日期列表格式。

这里不集中各业务数据检查，不处理维护运行、水位或发布。具体数据有效性归对应 Market 子域；跨业务模型要求由 Maintenance 组合 Strategy 能力。
