# ETF 按日发布、历史回填与质量

ETF 研究身份由 [registry](../registry/README.md) 维护；本能力负责元数据、行情／复权／规模的实际同步和覆盖审计。

| 文件 / 入口 | 使用方式 |
| --- | --- |
| [history-sync.ts](history-sync.ts) `syncEtfBasic` | 合并 etf_basic/fund_basic，在事务中替换全状态 ETF 名录并计算现有交易属性 |
| 同文件 `syncEtfDaily` | ETF CLI 等历史回填；按代码／年份原子保存行情、复权和完成标记，refresh 重取，validateCoverage 额外检查覆盖 |
| [sync.ts](sync.ts) `syncEtfMarketDate` | Signals、Maintenance 和 CLI；按日筛选当日有效产品，拉取行情／复权／份额并发布 |
| 同文件 `fillEtfHistoryGap`、`refreshEtfRegistryRevisions` | 缺口回填及有界修订刷新，向维护调用方报告覆盖或最早语义变化 |
| 同文件 `syncEtfShareSizeDate`、`syncEtfShareSizeRange` | 只替换份额日期切片；范围回填可容忍并报告缺项，不能套用日发布的严格门槛 |
| [history-coverage.ts](history-coverage.ts) `inspectEtfHistoryCoverage`、[registry-audit.ts](registry-audit.ts) `auditEtfResearchRegistry` | 读取基础质量，不自行同步或发布 Maintenance 水位 |

日发布先确定 activeCodes，查询下一 SSE 交易日作为 availableDate；复权和份额须完整，行情允许实现限定的缺口，再把三类切片放入一个事务。历史回填则先校验证券存在，以代码／年标记恢复，不能仅因某日有行情就认定整年完成。

份额范围回填在未 refresh 时遇到已有行即跳过该日期；它的断点判断并非完整覆盖证明。修改时应分别看 [sync.test.ts](sync.test.ts)、[history-sync.test.ts](history-sync.test.ts)、[history-coverage.test.ts](history-coverage.test.ts)，而非合并两条流程。Research 公开列映射见 [datasets](../../research/datasets/README.md)。

[返回 Market 总览](../README.md)
