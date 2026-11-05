# 财报来源、版本选择与财务指标

本能力维护底层财务事实、来源和可得性；Research 负责 SDK 公开列映射，用户在普通文档中写明研究假设。报表版本不等于最新财务指标快照，不能用后者替代时点证据。

| 文件 / 入口 | 调用方及输入输出 |
| --- | --- |
| [source-contract.ts](source-contract.ts) `normalizeFinancialStatementSourceRow`、`resolveFinancialAvailability`、`appendFinancialStatementSourceRows` | 同步和测试消费的纯规则；规范来源、证据可得性、合并内存版本数组，不写数据库 |
| [resolver.ts](resolver.ts) `resolveFinancialState`、`resolveFinancialStates`、`selectLatestStatementVersions` | Research／审计；前两者按 asOfDate 查库和规范代码，后者选择版本，保留报告类型、来源和可得性 |
| [normalize.ts](normalize.ts) `normalizeIncomeFlows`、`normalizeCashFlows` | 累计流量转单季／TTM，缺少必要期数保留缺失而非补零 |
| [metrics.ts](metrics.ts) `calculateFinancialMetrics` | 输入 ResolvedFinancialState，按版本化公式生成指标及来源，不查询市场 |
| [reference-periods.ts](reference-periods.ts) `quarterlyReportPeriods` | 纯时间范围计算 |
| [sync-partition.ts](sync-partition.ts) / [write.ts](write.ts) | 正式同步的分页准备、版本身份、PIT 与显式 Prisma 写入 |

resolver 以 availableDate ≤ asOfDate 读取支持的工业合并报表，并使用当时可得财报与市值构造状态；市值从供应商万元转换为元。批量入口允许调用方提供 market snapshots，报告窗口也有独立边界。版本哈希、公告日期和更正证据不能因为相同 endDate 合并丢失。

三表同步按批次保存，完成回调在对应范围处理后；没有覆盖网络、所有报表及整轮维护的总事务。[accounting-quality.ts](accounting-quality.ts) 的 `inspectFinancialAccounting` 与 [valuation-sample-audit.ts](valuation-sample-audit.ts) 的 `auditValuationState` 检查财务／估值样本，不同步数据。

改来源与版本先读 [source-contract.test.ts](source-contract.test.ts)、[sync-partition.test.ts](sync-partition.test.ts)、[resolver.test.ts](resolver.test.ts)；公式看 [normalize.test.ts](normalize.test.ts)、[metrics.test.ts](metrics.test.ts)，参考同步看 [reference-partition.test.ts](reference-partition.test.ts)。`fixtures/financial-source-versions.json` 是这些规则的测试样本，由本能力覆盖，不是生产 seed 或独立能力。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

正式入口使用 [sync-partition.ts](sync-partition.ts) 准备报告期窗口、公告日期窗口或单证券历史，再由 [write.ts](write.ts) 显式写对应表。三张报表的 `ann_date`／`f_ann_date` 查询使用与季度查询相同的完整字段和版本映射；日期筛选与返回报告期分别验证，按公告记录涉及的证券和报告期读取已有版本。报表对象按版本指纹追加，财务指标保留捕获版本；日常不写通用来源证据表。分红当前值的 `observedAt`／`availabilityQuality` 随业务行保存，同值重复抓取和代码接续保留时间，真实修订更新捕获时间。Research 的经济除权日与可得日期继续分开。

[audit.ts](audit.ts) 拥有财报可得时间、会计勾稽与指标覆盖检查，测试包括 [真实临时 SQLite](audit.integration.test.ts)。升级搬移和中断恢复见 [升级测试](../../../tests/minimal-sync-migration.test.ts)。

正式下载只通过 `sync-partition.ts` 的领域准备和 `write.ts` 的类型化写入。旧的独立下载／替换实现已移除，测试使用同一入口。

[correction-evidence.ts](correction-evidence.ts) 保留已核实更正公告的存储和无歧义版本关联；正式报表准备继续读取已有证据。报告期检查完成表示本次来源响应已检查，不表示所有公司已经披露。指标追加版本与当前快照分开；技术 ID 不参与业务去重，旧公告版本不覆盖新快照，同日歧义明确报告。

财务指标当前快照先合并缺值，再判断修订：来源未返回字段或返回 null 时保留已有值，原来缺失的字段可以由新值补齐，零属于已知值。同一响应中同公告日、同修订优先级的记录也允许缺值互补；只有双方非空且不一致的业务值才构成冲突。共同已知值的变更仍须遵循公告日期和 `update_flag` 的既有优先级规则。

缺值互补用于快照和消费者的有效状态，不改写来源版本。`FinaIndicatorVersion` 继续分别保留每条实际来源记录及其指纹、捕获时间和可得性，不把合并结果写成新的来源版本。回归入口为 [reference-partition.test.ts](reference-partition.test.ts)，覆盖实际 null 样本、字段缺席、零值、来源顺序、真实冲突及重复同步。

已确认的证券代码接续使用“同一报告期新来源优先”规则：先选择来源代码，再比较该来源的公告日期和修订标记。缺少新来源该期记录时使用旧来源；已接纳的新来源不会被后续旧代码响应降级。同一新来源内部存在歧义时报告冲突，不用旧来源掩盖。切换来源整条采用所选记录，缺值互补只在同一来源内进行，避免混用不同财务口径。

[indicator-selection.ts](indicator-selection.ts) 统一下载、写入与读取的选择规则。快照的 `sourceTsCode` 和版本的 `sourceTsCode`／`updateFlag` 保存来源身份与修订标记；版本指纹包含这两项，重复抓取仍保留首次捕获时间。迁移仅增加可空字段，旧记录及其指纹、捕获时间不改写，原始来源未知时保持 null。普通未接续证券仍遵守旧公告保护和缺值保留；已接续证券的未知来源快照由重新抓取的明确来源替换。

[indicator-versions.ts](indicator-versions.ts) 向 Research、因子和回测提供按实际可得日形成的有效指标序列，原始版本继续留库供审计。读取先纳入查询起点之前的来源选择状态，再过滤输出日期；未来才捕获的新来源不能影响此前结果。相同来源内应用与写入相同的公告、修订和缺值规则。同一可得日、证券、报告期只返回最后接纳的状态，公开 SDK 列保持不变。新增回归与迁移保留用例见 [indicator-source.test.ts](indicator-source.test.ts)。

财务指标、股票日数据、名称、三表、分红及指数成分统一按当前代码选择来源，不保存策略版本。升级时撤销受影响旧资格并由正式同步重查，原始业务数据和捕获时间保留；日常同步只按范围、完成状态及依赖资格判断。

三表各新增可空的 `sourceTsCode`，下载继续保留新旧来源的所有版本及原始指纹。读取先执行 `availableDate ≤ asOfDate` 和质量约束，再按证券／报表类型／报告期选来源，之后应用该来源内的公告与报告版本优先级。未来才可得的新来源不影响此前结果，`reconstructed` 不参与严格 PIT。普通未接续股票的未知旧来源与明确当前代码保持同级，仍按公告时间选版本；接续股票的未知来源排在明确来源之后。旧库未知来源不用于推断新代码同公告修订；重新抓取到相同指纹时可补上确切来源，保留版本 ID 和捕获时间。更正证据按规范证券身份匹配，业务数值比较仍区分原始来源。

分红逐个请求规范代码及已确认的旧代码，按证券、报告期、公告日、除权日、阶段和分配形态选择来源；不同事件不因同属一个报告期而合并。所有来源请求完整才允许替换窗口，任一来源失败／预算不足均保留缺口；起始日取接续链上市历史的并集下界。已知新来源不被后续旧来源覆盖，同值来源确认不重置捕获时间。回归见 [stock-source.test.ts](stock-source.test.ts)。

分红另保存 Tushare `base_date` 与 `base_share`。在原有来源和事件身份内，同一响应优先接纳明确较新的基准；已保存的新基准不会被较旧或缺少基准日的响应覆盖。同基准日金额／股本仍冲突时记录问题，保留已有值和独立合法事件。基准日缺失不猜日期，旧行由重抓补充；不按响应顺序选择版本。该规则仅属于分红；其他数据的 hash 及 `ann_date` 口径不变。分红来源身份补充下述分配形态，唯一可匹配的旧 ID 保留。

分红采用最新来源值，不提供完整历史预案版本还原。`baseDate` 不代表已核实的版本公告时间，`availabilityQuality` 仍为 `latest_only`，Research SDK 的公开列和可得性过滤不变。无需公告检索、PDF 解析或新增核验服务。回归见 [dividend-selection.integration.test.ts](dividend-selection.integration.test.ts)。

十表迁移只新增可空来源列，旧值默认 null；Prisma schema 的内部字段不增加 Research SDK 列。财报 resolver 版本提升至 3，消费者继续通过现有显式映射读取。


Ingestion 的财报历史基线从 1988 年枚举季度，通过 VIP 获取全市场；后续按公告日及实际公告日增量获取，新纳入证券补齐 1988 年起历史。[scope.ts](scope.ts) 按最终截止日筛选证券，`catalogThrough` 与请求日期或报告期分别保存，允许已上市证券保存这一覆盖范围内的上市前财务。[statement-requests.ts](statement-requests.ts) 声明报表类型、日期入口和完整收据匹配规则。


## 分红独立方案与现金实施记录

分红保留 `stk_div` 送转合计、送股和转增分量、登记日、派息日、实施公告日与红股上市日。合计不再与分量相加。来源身份在原五项上增加现金／送转／混合／无分配／未明确形态，金额、比例、基准股本都不参与身份；因此方案内改额仍受原较新 `baseDate` 规则约束。同形态同身份的真实冲突仍报告，形态不冒充全局稳定方案编号。

永太科技 002326.SZ 的 2018 年预案及股东大会记录分别保留现金 0.15 元和定向转增 0.12 股，两条实施公告也分别留库。Research 仅在查询截止日前已可得的记录中，按规范证券、年度、登记日、除息日、派息日归并内容一致的现金实施记录；先归并再过滤查询起点，避免后来重复公告再次成为现金。现金内容或股本／送转口径冲突、关键日期不足以唯一匹配时明确拒绝，不覆盖或累加。纯送转不作为现金输出，混合方案的现金只返回一次。

旧记录只有能唯一匹配时才沿用 ID；单纯字段补齐保留捕获时间。记录仍为 `latest_only`，不因此获得历史 PIT 证据。未完成 Run 的旧分红成功收据如未请求完整字段，仅补采一次，新的完整收据恢复时跳过；其他成功批次不变。不改变独立下载的 `adj_factor`、复权行情或公开 Research SDK 列。
