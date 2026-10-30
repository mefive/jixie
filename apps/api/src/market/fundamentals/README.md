# 财报来源、版本选择与财务指标

本能力维护底层财务事实、来源和可得性；Research 负责 SDK 公开列映射，用户在普通文档中写明研究假设。报表版本不等于最新财务指标快照，不能用后者替代时点证据。

| 文件 / 入口 | 调用方及输入输出 |
| --- | --- |
| [source-contract.ts](source-contract.ts) `normalizeFinancialStatementSourceRow`、`resolveFinancialAvailability`、`appendFinancialStatementSourceRows` | 同步和测试消费的纯规则；规范来源、证据可得性、合并内存版本数组，不写数据库 |
| [resolver.ts](resolver.ts) `resolveFinancialState`、`resolveFinancialStates`、`selectLatestStatementVersions` | Research／审计；前两者按 asOfDate 查库和规范代码，后者选择版本，保留报告类型、来源和可得性 |
| [normalize.ts](normalize.ts) `normalizeIncomeFlows`、`normalizeCashFlows` | 累计流量转单季／TTM，缺少必要期数保留缺失而非补零 |
| [metrics.ts](metrics.ts) `calculateFinancialMetrics` | 输入 ResolvedFinancialState，按版本化公式生成指标及来源，不查询市场 |
| [reference-periods.ts](reference-periods.ts) `financialHistoryStart`、`quarterlyReportPeriods` | 纯时间范围计算 |
| [sync-partition.ts](sync-partition.ts) / [write.ts](write.ts) | 正式同步的分页准备、版本身份、PIT 与显式 Prisma 写入 |

resolver 以 availableDate ≤ asOfDate 读取支持的工业合并报表，并使用当时可得财报与市值构造状态；市值从供应商万元转换为元。批量入口允许调用方提供 market snapshots，报告窗口也有独立边界。版本哈希、公告日期和更正证据不能因为相同 endDate 合并丢失。

三表同步按批次保存，完成回调在对应范围处理后；没有覆盖网络、所有报表及整轮维护的总事务。[accounting-quality.ts](accounting-quality.ts) 的 `inspectFinancialAccounting` 与 [valuation-sample-audit.ts](valuation-sample-audit.ts) 的 `auditValuationState` 检查财务／估值样本，不同步数据。

改来源与版本先读 [source-contract.test.ts](source-contract.test.ts)、[sync-partition.test.ts](sync-partition.test.ts)、[resolver.test.ts](resolver.test.ts)；公式看 [normalize.test.ts](normalize.test.ts)、[metrics.test.ts](metrics.test.ts)，参考同步看 [reference-partition.test.ts](reference-partition.test.ts)。`fixtures/financial-source-versions.json` 是这些规则的测试样本，由本能力覆盖，不是生产 seed 或独立能力。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

正式入口使用 [sync-partition.ts](sync-partition.ts) 准备一个季度报表／指标窗口或单股分红年窗口，再由 [write.ts](write.ts) 显式写对应表。报表对象按版本指纹追加，财务指标保留捕获版本；日常不写通用来源证据表。分红当前值的 `observedAt`／`availabilityQuality` 随业务行保存，同值重复抓取和代码接续保留时间，真实修订更新捕获时间。Research 的经济除权日与可得日期继续分开。

[audit.ts](audit.ts) 拥有财报可得时间、会计勾稽与指标覆盖检查，测试包括 [真实临时 SQLite](audit.integration.test.ts)。升级搬移和中断恢复见 [升级测试](../../../tests/minimal-sync-migration.test.ts)。

正式下载只通过 `sync-partition.ts` 的领域准备和 `write.ts` 的类型化写入。旧的独立下载／替换实现已移除，测试使用同一入口。

[correction-evidence.ts](correction-evidence.ts) 保留已核实更正公告的存储和无歧义版本关联；正式报表准备继续读取已有证据。报告期检查完成表示本次来源响应已检查，不表示所有公司已经披露。指标追加版本与当前快照分开；技术 ID 不参与业务去重，旧公告版本不覆盖新快照，同日歧义明确报告。
