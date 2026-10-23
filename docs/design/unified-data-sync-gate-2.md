# 统一数据同步 — Gate 2 审阅交接

本轮基线：`0de7bbc6647ff1a7f77ca0b605849a05ffe4ae23`。Gate 1 范围与精确提交信息、第四轮产品代码和新增 Prisma SQL 均已获批准。2026-10-24 已完成开发验证：143 文件、751 项联合回归全部通过，完整构建、静态检查、隔离迁移、源码/干净编译 CLI 及双语 UI 检查通过。完整实际证据与验收对应见 [开发验证交付](../reports/unified-data-sync-verification.md)。下面各轮“待执行/未提交/等待复审”文字保留为当时交接历史，以本段及验证记录为当前状态；依用户批准完成提交，不 push。没有对工作库执行迁移或真实供应商同步。

## 迁移 SQL 复审交接（2026-10-23，当时记录；2026-10-24 已批准并验证）

[第四轮审阅](/Users/liucong/Projects/jixie/docs/reports/unified-data-sync-review.md)已通过产品代码，并允许进入隔离迁移生成阶段。新增文件：[20261023154111_unified_data_sync/migration.sql](/Users/liucong/Projects/jixie/apps/api/prisma/migrations/20261023154111_unified_data_sync/migration.sql)。文件由 **Prisma 6.19.3** 自动生成，216 行、37 条完整 SQL 语句，复制回仓库后未手工修改。

| SQL 范围 | 生成内容及复审重点 |
| --- | --- |
| 1–3 行 | FactorWeatherPin 增加可空 dirtyFrom/inputRevision，不填造旧输入版本或覆盖事实。 |
| 5–129 行 | 新建 DataSyncRun、DatasetSyncState、DatasetSyncPartition、MarketCalculationState、MarketDataState、MarketRecordEvidence、FinaIndicatorVersion、FutureMarketRevision 共 8 表；主键、默认值与 JSONB 字段对应已审阅 schema。新表初始为空，不将旧最大日期或现存行数冒充完成证明，不将旧财务值冒充历史 vintage。 |
| 131–189 行 | SQLite 重建 IndexIndicator、MarketIndicator、Moneyflow，分别放宽涨跌停计数与 netMain 的非空约束；生成 SQL 显式 INSERT SELECT 复制全部旧列后，才 DROP 旧表并重命名，并恢复 IndexIndicator/Moneyflow 的日期索引。需要留意实际升级的表复制时间、额外磁盘空间及事务部署窗口；含数据升级保真验证尚未执行。 |
| 191–216 行 | 新建运行时间、分区状态/范围、计算状态/日期、记录数据集、财务指纹/可得日及期货修订索引；分区范围和财务指纹保留唯一性。 |

没有删除旧 Maintenance* 历史、用户结果或 FutureMarketPublication，没有 UPDATE/DELETE 回填既有业务数据；3 个 DROP TABLE 均属于上述带全列复制的 Prisma 标准重建。以上是 SQL 静态核对结论，不能替代升级验证。

生成环境与实际结果：

- 将当前 schema 与全部 97 个历史迁移复制到 `/private/tmp/jixie-unified-sync-migration-5rfh6zm7`；没有复制或连接工作数据库，没有加载项目 `.env`，没有改动产品 schema。
- 数据库 URL 固定为该目录内的 `development.db`。首次直接创建遇到无详细原因的 Schema engine error；显式初始化空临时 SQLite 后历史迁移回放成功。临时 schema 的显式影子库配置又遇到 P3006；移除该临时配置、恢复与仓库逐字节一致的 schema 后，使用 Prisma 自动创建/清理的影子库成功生成。未修改历史 SQL 或 Prisma 版本。自动与显式影子库的生命周期见 [Prisma 官方说明](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)。
- 成功命令在隔离目录执行：`DATABASE_URL=file:/private/tmp/jixie-unified-sync-migration-5rfh6zm7/development.db PRISMA_HIDE_UPDATE_MESSAGE=1 node /Users/liucong/Projects/jixie/apps/api/node_modules/prisma/build/index.js migrate dev --create-only --name unified_data_sync --skip-generate --skip-seed --schema /private/tmp/jixie-unified-sync-migration-5rfh6zm7/prisma/schema.prisma`，退出码 0。
- 只读核对临时开发库：97 个历史迁移已应用，新迁移无记录且 DataSyncRun 尚不存在。未对新 SQL 执行 migrate deploy、db push、测试或升级回放。
- 全部历史迁移及 migration_lock.toml 的 SHA-256 前后一致；产品 schema SHA-256 为 `0fbadaff35d42c7b2c6b2dd9f01535f9bcf16a26bfa9a3a424988eff39d41cc1`。新 SQL SHA-256 为 `ed6dd5291b5553ab564f559ca7dd95abb36440df6f7aed410cc2e1f06295d793`，与 Prisma 原始生成文件一致。
- 已完成 SQL 静态范围/完整语句核对、`git diff --check` 和交接本地链接检查。此次只新增生成 SQL 和更新交接，没有产品 TypeScript/Python/Shell 变化；类型/源码 ESLint/契约检查沿用上轮通过记录。
- Prisma 命令均已退出；`lsof -nP +D <隔离目录>` 无打开项。隔离开发库、显式影子库、schema/历史副本及临时凭据清单均已删除，确认目录不存在。仓库仅保留新生成迁移。

SQL 获批后才执行含旧数据的迁移升级/空库部署核验、A01–A14 与 R01–R16 隔离回归、受影响构建、源码/编译 CLI、双语 UI E2E 及资源清理。新 SQL 仍未提交；精确提交信息不变，全部必需验证通过后才提交，不 push。

## 第三轮反馈修订：R15、R16（产品审阅历史）

已按[第三轮审阅反馈](/Users/liucong/Projects/jixie/docs/reports/unified-data-sync-review.md)补齐两条遗漏的调用链，现重新交回 Gate 2。以下仍是实现及回归代码准备情况，**不是测试执行或最终验收通过记录**。独立审阅报告保持原文，R01–R14 的修订及原有回归全部保留。

| 反馈 | 当前修订与审阅入口 | 新回归（尚未执行） |
| --- | --- | --- |
| R15 覆盖资格滚动失效 | `maintenance/calculations.ts::invalidatePartitionCoverage` 将 index-prices 资格变化传播到分区及其后 20 个 SSE 交易日，脏范围只加入对应 `index:<code>`，并保留已有脏范围；其他指数、市场及行业资格不因此失效。SSE 日历证明变化传播至分区后 59 个交易日，覆盖包含当日在内的 60 日股票历史资格及 21 点指数收益窗口；非 SSE 日历不增加指标依赖。普通来源错误和直接抛出异常继续使用原发布事务/失败落库事务里的同一失效入口。原始 IndexDaily 值修订的后续窗口也改用真实交易日历定位 20 期终点，与 SQL 期限一致。 | [coverage-invalidation.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/maintenance/coverage-invalidation.integration.test.ts)：跨年真实行情和已就绪一月输出，分别对 index-prices/calendar × 普通来源失败/准备异常四条路径执行 synchronizeData；断言原始行完全不变、旧结果在重算前被屏蔽、第 20/21 或 59/60 个后续交易日的失效边界、无关指数/市场可用。真实私有副本 SQL 在证明缺失时发布局部 null、独立金额保留，证明恢复后再次重算恢复原收益。计划范围和延后计算由测试替身控制，获取映射/事务/读取资格/重算链使用真实实现。 |
| R16 Signals CLI 退出码 | `signals/cli/run-signals.ts` 将 `summary.accounts.errors` 与信号错误一并纳入退出条件。只有真实失败返回 1，正常账户等待保持 0；该入口仍只消费已有数据，没有调用市场同步。 | [run-signals.test.ts](/Users/liucong/Projects/jixie/apps/api/src/signals/cli/run-signals.test.ts)：实际加载 CLI 入口，分别断言信号完成但账户失败、仅账户等待、全部完成及信号失败的退出码、摘要输出和数据库资源关闭，并断言未调用 synchronizeData。 |

本轮仅修复失效范围和退出码，没有新增模式、schema 或通用抽象。精确提交信息和隔离迁移生成/SQL 复审/行为验证顺序均保持不变。当前依然未提交，测试、构建、迁移及真实同步未执行。

## 第二轮反馈修订：R09–R14

已按同一[审阅报告](/Users/liucong/Projects/jixie/docs/reports/unified-data-sync-review.md)完成第二轮代码及回归修订，现交回 Gate 2。下表仅说明实现和已准备的验证，**没有运行行为测试，不能据此记为验收通过**。审阅报告原文未修改，原有 R01–R08 回归保留。

| 反馈 | 当前修订与审阅入口 | 回归代码（未执行） |
| --- | --- | --- |
| R09 归一后快照完整性 | `market/indices/sync-partition.ts` 先映射最终证券身份，再检查最终键唯一性、分区/指数范围、有限权重及总权重；只有通过的完整日期可提出独立替换。`synchronization/records.ts` 对原子批次的任何重复键整批拒绝，包括字段完全相同的重复，禁止公共去重改变完整对象。 | `maintenance/review-regressions.integration.test.ts`：真实 index adapter → qualify → accept，旧/新代码各 50 的碰撞保留原快照并报错；另覆盖接纳层相同键/相同值拒绝。原 R01 完整快照和权威删除正例继续保留。 |
| R10 指数自身收益窗口 | `market/state/sync.ts` 用 SSE 精确开市日构造窗口，再左联该指数价格，必须连续 21 个有效价格点才计算 20 期收益；缺中间日期不会压缩行偏移。`eligibility.ts` 独立核验该指数的日历证明、价格分区证明及每个价格点，只屏蔽该指数依赖此窗口的 `return20`，保留其他字段。计算版本为 `market-state-sync-v2`，审计版本为 `market-eligibility-v3`，旧结果重新失效。 | 同一回归文件：股票 62 日完整、成分快照完整、指数中间缺一天但更早历史充足，执行真实 SQL 并检查 return20=null、缺项、独立均线/金额及市场输出；补齐后应为精确的 `161/141-1`。 |
| R11 近期扫描游标 | `maintenance/partitions.ts` 的日分区 fresh 仅更新计划进度，不修改 recent 的游标；recent 在连续已核验日历内扫描，遇冷却、exclude 或本轮已选日期会继续向后，预算/期限停止时保留扫描位置。较粗周期原有的 fresh 轮转保留。 | 同一回归文件：六轮真实计划，保留第一日冷却并在第二轮排除下一候选，后续日期仍获得机会；同时保留原 R02 不跨越未核验日历的回归。 |
| R12 证据与策略版本 | `maintenance/sync.ts` 在完整或不适用证据实际提交的同一事务内更新分区及对象状态的 policyVersion；仅排队、失败或部分响应不提前认可旧证据。资格变更按实际提交版本计算。 | `maintenance/publication-review.integration.test.ts`：旧策略完整分区经真实来源映射/资格/接纳/发布事务后，检查新版本、readiness、verifiedThrough 和真实计划器冷却；失败正交用例保留旧策略且资格未恢复。仅候选范围用计划替身固定。 |
| R13 持久未解决计算 | `maintenance/calculations.ts` 区分本轮 attempted 与持久 waiting/error/stale。`sync.ts` 收尾再次汇总全部同步计算状态，包括早目标修订影响的已有更晚结果，不按冷却或尝试限额过滤；真实计算错误进入运行 errors 和 error 状态，CLI 沿用 error→1，纯等待/失效为 partial。shared 摘要补充 attempted 说明。 | 同一 publication 回归：未来 nextAttemptAt 的 3 个 error、5 个 waiting；再种入 3 个更晚 stale、限额 1，验证剩余 stale 不消失；经过完整 synchronizeData 收尾，错误仍进入持久摘要，移除错误后仍为 partial。 |
| R14 账户错误汇总 | `signals/accounting/settlement.ts` 按每个部署的模拟/实际账户分别返回成功、正常等待、真实失败和诊断，独立账户继续；scheduler 保留单独 accounts 结果，consumer 将账户缺项/失败传入 sync。版本化重放对已知输入未就绪持久化 pending，未知异常仍 failed；不按文案识别错误。 | `signals/daily/settlement.integration.test.ts`：真实结算 → scheduler → consumer → synchronizeData；SQLite trigger 制造单账户真实写入失败，另一账户缺 ETF 输入，独立信号已完成；检查 error→去除故障后 partial→补齐输入后 complete、账户幂等及不新增信号/Job。没有 mock settlement 或账户重放。 |

真实 Worker 验证代码另见 [signals/runs/worker.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/signals/runs/worker.integration.test.ts)：启动真实 `signals/runs/worker.ts` IPC 子进程，仅通过测试 loader 替换用户计算。子进程实际建立 SQLite 连接及 TCP 监听，测试真实 `runWorker` 的取消与 Worker 自身父 IPC 断开处理；断言退出后 PID 消失、端口可复用，取消流程还经过真实 JobService，核对执行期间 owner/共享 R 存在、真实退出后才释放且 Job=stale。已有 mock Worker 的孤儿调度/通知回归保留，新测试不调用用户策略或真实邮件。上述均为**待执行断言**，尚无运行结果。

本轮没有新增数据集、命令模式、调度框架或 schema 变更；只调整收益窗口口径、资格及汇总等被要求修正的行为。尚未生成迁移 SQL，继续按产品代码批准 → 隔离库 Prisma 6 生成迁移 → SQL 复审 → 行为验证/构建/E2E → 验证通过后提交的既定顺序执行。

## 第一轮反馈修订：R01–R08

已依据[独立审阅报告](/Users/liucong/Projects/jixie/docs/reports/unified-data-sync-review.md)完成本轮代码修订。下表表示实现及回归代码已准备，**不表示行为验证通过或独立验收通过**；原审阅报告保持原文，供复审对照。

| 反馈 | 本轮修订 | 回归入口（尚未执行） |
| --- | --- | --- |
| R01 短响应误删 | 分页结束、业务范围证明和删除依据分开。来源只提出精确替换请求，`qualifyMarketPartition` 核验后才授予权限并记录授权证据。股票行情用已核验主表的上市区间及全天停牌证据确认证券集合；稠密辅助来源覆盖已核验行情集合。证据不足合并合法记录并保留缺口。独立完整成分快照按自身权限原子替换，其他坏快照不被拼接发布。 | [review-regressions.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/maintenance/review-regressions.integration.test.ts)：真实 stock/index adapter → qualify → accept，短行情/资金流、完整停牌修订、权威空事件删除、完整及不完整快照并存。 |
| R02 日历缺口越过历史 | 回补与近期巡检只在从游标起连续核验的日历内找下一交易日；未核验处保留边界，已证明的闭市区间才可越过。新日期使用独立预算和已核验近期交易日。 | 同一回归文件：先仅有目标年日历，确认 2015 游标不动且新日期仍被计划；补入较早日历后多轮覆盖 2015–2025 全部 fixture 交易日。 |
| R03 远期收益未成熟 | `loadSnapshots` 区分必需输入与 forward 观察；前瞻日历超出已完成、实际行情可观察范围的日期保留空快照。已成熟范围及形成日继续严格核验，不能借此忽略历史复权缺口。 | [forward-readiness.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/factor/analysis/cross-sectional/forward-readiness.integration.test.ts)：真实因子求值、200 证券截面、已实现样本、行情截止后 31 天日历、形成日/成熟收益缺口拒绝，以及真实月末气象 Worker 和落库。 |
| R04 孤儿信号与无限等待 | 每轮 Signals 只恢复失去真实 owner 的 signal Job，保护其他活跃执行者。取消传至恢复循环、账户前推、入队观察、Job 执行及 Worker；观察取消返回待办，持有的执行取消为 stale，不发送终态通知。Worker 失去父进程连接即退出。 | [recovery.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/signals/daily/recovery.integration.test.ts)：隔离进程持 owner 后被杀、宿主保持存活，真实 scheduler/enqueue/Job 及通知边界；活跃 owner 保护、观察取消、执行取消后重试、已完成结果及通知不重复。Worker 计算、账户初始化及邮件传输使用本地替身。 |
| R05 Research 失效泄漏 | 行业状态复用 `currentDerivedRows`，看板与 SDK 使用同一代次及资格解释，失效期间保留身份/样本数并屏蔽旧数值。读取也核对计算与审计版本。 | `review-regressions.integration.test.ts`：真实估值适配链修订 → 原始值与失效事务 → Research 读取屏蔽 → 私有副本 SQL 重算与发布 → 再次读取新换手率；不足历史的趋势仍为 null。 |
| R06 必需字段缺失 | 换手率要求实际交易证券具有正的有限 circMv，以及按既有优先级取到的有限、非负换手率；缺失数量进入 activity 缺项。指标字段分组、资格与输出屏蔽统一归 `market/state/eligibility.ts`，Maintenance 不再自行解释金融输出字段。首轮审计版本更新为 v2，本轮 R10 已进一步更新至 v3。 | 同一回归文件：两只证券均有 DailyBasic 行，但分别缺资本化字段或两种换手率；验证市场、含这些证券的指数与行业 activity 均为 null，独立 amount 仍可用。 |
| R07 新计算副本回收 | 副本改为来源库旁的私有 `market-calculations` 目录，创建前取得 owner，凭据记录来源库与目录 inode、资源 ID 和创建时间。同步开始和收尾自动回收：须凭据、来源身份、目录身份、已知文件清单一致且 owner 空闲；活跃、未知、替换路径及旧无凭据资源均保留。 | [read-copy.integration.test.ts](/Users/liucong/Projects/jixie/apps/api/src/infra/database/read-copy.integration.test.ts)：正常 close、活跃副本、未知目录、持副本进程被 SIGKILL 后回收；原始数据库及宿主继续可用。 |
| R08 旧回归契约 | 更新部署 activation 的 timer/入口断言；Signals 精确断言 waiting、错误可见性及独立部署继续；Maintenance 按实际 publication 状态模拟门禁，历史 active 记录不封站；更新 Research 资格 fixture、CLI alias 与 status 路径。 | `scripts/deploy/bootstrap.test.mjs`、`signals/daily/scheduler.test.ts`、`maintenance/routes.test.ts`、`research/datasets/market-reference.test.ts` 及既有 alias/部署版本测试，全部保留有意义的断言。 |

行情范围证明新增的是同一 Tushare 来源的辅助证据请求，遵守本轮 HTTP/取消预算，没有新增数据集或模式。[官方 suspend_d 契约](https://tushare.pro/document/2?doc_id=214)说明每日停复牌范围及日内时间字段；只有 S 且无日内停牌时段的记录用于全天停牌证明。接口无权限、失败、分页未结束或证据冲突时不授予行情删除权限，合法行情仍可合并，覆盖与正式计算保留缺口。

结构修订保留在原业务文件内：协调器分为获取、单分区原子发布、失败落库、身份归一与收尾；计划器分为对象发现、新日期、近期、待办、回补和到期巡检；计算器分为准备、三种完整计算操作和共同事务 CAS；接纳器分为批次核验、记录及证据合并、授权删除。财报分为报表/分红/指标分派，并将报表版本上下文与单版本映射分开；旧资源在持 owner 时核验及回收。保留既有因子引擎和账户算法；本轮 SQL 仅纠正 R10 的指数收益交易日窗口。

CLI 参数合并入 `cli/data.ts` 并复用纯日期校验，仍只在执行分支动态加载 `execute.ts`。状态扁平为 `maintenance/status.ts`，覆盖读取只保留按数据集聚合的生产契约。本轮没有增加 schema 变更；迁移生成及 SQL 复审顺序不变。

## 交付行为与审阅入口

- 唯一市场写入口：`pnpm data sync [--to YYYYMMDD]`。参数在环境和数据库加载前解析；默认日期在启动时冻结。入口见 `apps/api/src/maintenance/cli/{data,execute}.ts`。
- 协调器：`apps/api/src/maintenance/sync.ts`。固定目标、M 所有权、有限批次、运行恢复、逐分区发布、错误/待办摘要与后处理。原始记录、字段证据、覆盖、revision 与失效一起事务提交，成功计数在事务实际提交后增加。
- 计划与覆盖：`maintenance/partitions.ts`、`market/synchronization/{policies,coverage,qualify,readiness}.ts`。历史起点、计划游标、最大观察日与连续核验分开；活跃对象优先，待办/回补/旧范围巡检都有有限份额，退市合约不会持续占用当前数据份额。
- 接纳语义：`market/synchronization/{source,records}.ts`。实际字段与未知 null 分开，保留逐字段来源证据；冲突业务键拒绝，其他合法对象继续。完整权威范围才可删除。完整成分快照不可分拆发布；空事件集、闭市无观察、未知空响应和来源失败分别处理。
- 计算与资格：`maintenance/calculations.ts`、`market/state/{eligibility,prepare,current}.ts`。按真实字段和有限观察窗口传播失效，保留更晚输出的失效需求；指数/行业修订收敛输出族。SQL 在私有输入副本运行，输入 revision/代次核对通过后，输出与 ready 一起提交。当前输出按对象和指标组核验，旧无资格记录不能仅凭“行存在”显示为就绪。
- 消费者：`backtesting/adapters/prisma-port.ts`、`factor/observations/cross-sectional/data.ts`、`factor/weather/{invalidation,refresh}.ts`、`research/datasets/`、`research/sandbox/research-sandbox-pool.ts`、`signals/runs/readiness.ts`。正式截面不静默缩小为缺复权/缺估值的样本；资金流不补零，缺价格限制不按无限制撮合。ETF 信号按自身输入判断，正常等待单列；已完成信号、冻结市场输入及未前进账户代次不因市场修订重写。
- UI/契约：`packages/shared/src/api/maintenance.ts`、`packages/shared/src/market-state.ts`、`apps/web/src/components/maintenance-gate.tsx`、`apps/web/src/complex/market/industry-weather-map.*`。只有真实发布争用封闭准入，partial/空库/历史错误保留局部可用；缺组合输入显示双语“等待完整输入”。状态与 CLI 按数据集汇总覆盖，详细对象证据仍保存在分区表中；普通请求不执行全量覆盖聚合。
- 部署：`scripts/bootstrap.sh`、`scripts/deploy/activate-maintenance.sh`、`deploy/jixie-maintenance.*`。单一 timer 按上海时间每两小时 :15 推进；旧 weekly 停用。部署发布锁释放后才运行有限同步，市场历史未齐不阻塞应用启动。

## 既有能力映射

下表左列仅用于核对已退役任务，不是兼容入口。

| 原任务 | 当前归属/数据集 |
| --- | --- |
| stock-prices | calendar、stock-master、stock-prices、stock-adjustments |
| stock-history | stock-master、stock-names、已确认身份接续归一 |
| basic | stock-valuations |
| fina | financial-statements（3 表 × 3 报告类型）、financial-indicators、dividends |
| limit | stock-limits |
| moneyflow | stock-moneyflow |
| toplist | stock-toplist |
| sw-industry | industry-members（完整当前/历史归属） |
| etf | etf-master、etf-prices、etf-adjustments、etf-shares；registry 与部署需求 |
| index | index-weights、index-prices |
| index-daily | index-prices |
| index-basic | index-valuations |
| market-reference | index-catalog、index-prices、industry-prices |
| market-state | market-state 派生及逐组资格 |
| futures | future-contracts、future-prices、future-mappings、future-settlements、版本化输入发布 |
| commodity-futures | commodity-contracts、commodity-prices |
| commodity-continuous | commodity-mappings、同合约结算收益与换月分解 |
| commodity-holdings | commodity-holdings；仅完整代表合约样本和排名对象 |
| commodity-warehouse-receipts | commodity-receipts；保留产品与原始单位 |
| rates | treasury-curves |
| credit-curves | credit-curves |
| external-market | external-curves、external-fx |
| cross-market-benchmarks | cross-market-benchmarks；市场时区、币种、日历及严格后续 SSE 可得日 |
| macro | china-macro、us-cpi；观察期间、发布日与捕获 vintage 分开 |

原 daily/weekly 的 ETF 份额历史、已确认代码归一、因子气象、信号与账户前推也已纳入对应范围。没有建立新的用户数据管理页面或通用 DAG/Job 产品。

## Schema、迁移与数据语义

`apps/api/prisma/schema.prisma` 新增 DataSyncRun、DatasetSyncState、DatasetSyncPartition、MarketCalculationState、MarketDataState、MarketRecordEvidence、FinaIndicatorVersion、FutureMarketRevision；FactorWeatherPin 增加 dirtyFrom/inputRevision。Moneyflow.netMain 与市场/指数涨跌停数量允许未知 null。

旧 Maintenance* 历史及 FutureMarketPublication 保留。当前期货版本单独保存，账户仍持有自己的冻结输入。同步控制表与用户表不进入 Agent SQL 白名单；新增市场表及语义已更新 `SQL_TABLE_DOCS`。

供应商财务指标的公告日不能证明当前值的历史 vintage。新版本从实际捕获之后的已知 SSE 交易日使用；日历不足时保留 unknown 原始版本并限制正式读取。Research 公开增加公告/证据/观察时间列，分红分别返回经济 ex_date 和当前值可得 date；shared Contract、API 映射、Python runtime、生成 stub 及中英帮助联动。旧历史指标不会被冒充为新留存的可回放版本，因此依赖这些历史值的当前计算可能等待或不足样本。

迁移 SQL **已生成，等待 SQL 复审**，文件及隔离生成证据见本文开头。产品代码已获第四轮批准；新 SQL 复审通过后才继续剩余行为验证。没有对工作库 migrate/db push/reset，也没有手写或改写历史 migration。

退役资源回收只接受数据库记录与磁盘协议相符、已知文件范围且无活跃 owner 的旧候选；诊断先保留在历史运行记录中。未知文件或不一致凭据保留并报告，不恢复旧协议。

## 静态检查记录

- 已通过 `pnpm typecheck`：包括底层后端 AST 边界、生成契约一致性、scripts 与全部 workspace 类型检查。
- 已通过 `pnpm exec eslint . --ignore-pattern '.venv/**' --max-warnings 0`：源码零错误、零警告。
- 已通过 `pnpm format:check`，以及全部本次变更的 `prettier --write`；`date.ts` 已修正，逻辑分段空行人工核对。
- 前轮格式反馈修正：43 个变更文件中的 72 处单行双语 JSDoc 改为多行，中英文之间保留空段；另将 1 处双语行注释分行。此规则由人工专项检查，Prettier 不会自动拆分；该次纯注释修正前后源码 token 一致。本轮新增及修改的 113 处双语 JSDoc 已再次专项检查，均含中英文空段。
- Prisma 6.19.3 `validate`、schema-only `generate`；没有连接数据库执行迁移。
- 项目 Python 的 `scripts/checks/check-python-sdk-boundaries.py`：仅 AST/compile，11 文件、0 违规，不导入业务模块。
- `bash -n`、修改 MJS 的 `node --check`、`git diff --check`。

默认 `pnpm lint` 在前轮检查时会扫描本地 `.venv` 的第三方 JavaScript，产生 128 个 error/10 个 warning；这些环境文件未修改，未通过调整规则掩盖。排除该虚拟环境后的源码 lint 作为本轮有效检查。

R01–R08 修订后已重新通过 `pnpm typecheck`、上述零警告源码 ESLint、`pnpm format:check`、`node --check scripts/deploy/bootstrap.test.mjs` 和 `git diff --check`。本轮后端 AST 扫描为 894 文件、0 违规，shared/API/Web/Docs/sandboxd 类型检查及生成契约一致性均通过。Prisma、Python SDK AST/compile 与 Bash 语法记录沿用前轮结果；这些 schema/Python/Bash 源码本轮未改。

R09–R14 修订后已重新通过 `pnpm typecheck`（后端 AST：897 文件、3446 条运行时依赖、1005 条类型依赖、0 违规；全部 workspace 和生成契约一致性通过）、零警告源码 ESLint（仍排除 `.venv/**`）、`pnpm format:check`、`node --check scripts/deploy/bootstrap.test.mjs` 与 `git diff --check`。新增及修改的 118 处双语 JSDoc 专项检查通过，中英文均保留空段。上述只验证静态结果；未执行测试、构建、Worker、同步、数据库写入或迁移。

R15、R16 修订后已通过 `pnpm typecheck`：后端静态边界为 899 文件、3456 条运行时依赖、1010 条类型依赖、0 违规；生成契约一致性及全部 workspace 类型检查通过。源码 ESLint（排除 `.venv/**`）零错误、零警告；`pnpm format:check`、`git diff --check`、本交接本地链接检查，以及 119 处新增/修改双语 JSDoc 空段检查均通过。该轮未改 schema、Python 或部署脚本；相关语法检查沿用前轮记录。仍没有执行任何行为测试或构建。

## 审阅前准备的验证（现已执行，结果见开发验证交付）

| 验收 | 验证入口/计划 |
| --- | --- |
| A01 | cli-entrypoints.test.ts、import-aliases.test.ts、干净编译后真实 help/非法参数/统一入口检查 |
| A02–A07 | maintenance/sync.integration.test.ts、market/synchronization/source.test.ts：空库、独立部分合并、晚到缺口、合法空集、冲突/权威修订、快照原子性、错误与预算 |
| A08 | 新源字段校验/消费者 guard，受影响 Backtesting/Factor/Signals 用例及 market/state 计算用例 |
| A09 | 指标捕获版本/PIT 用例、financial source-contract/resolver、Research SDK 与已有固化/账户输入回归 |
| A10–A11 | 有界更晚失效、无原始变化的版本失效、事务回滚/幂等及同日 Research session 缓存失效 |
| A12 | sync.integration.test.ts 写锁争用，既有 market-access 原生跨进程/稳定读取测试 |
| A13 | 已准备活跃/未知/可回收资源 fixture；既有 Signals/Weather 独立恢复及账户输入不变回归 |
| A14 | 24 项映射、SDK/runtime 契约、SQL 文档、部署影响测试与双语 UI fixture |

审阅后使用临时 SQLite、本地 provider/通知替身，运行相关 API/SDK/协调测试、受影响构建、干净源码/编译 CLI 验证；UI 使用 `apps/web/e2e/maintenance-fallback.mjs`（已加入局部等待卡片）及市场气象回归，检查并展示实际截图。关闭所有临时进程、监听、Worker 和数据库连接。真实供应商长区间同步与生产部署不在本次开发验证范围。

以上表格保留审阅前的验证计划；当前实际结果见本文开头及开发验证交付，不代表原设计会话已独立验收。

## 精确提交信息

```text
feat(market)!: unify data synchronization by target date

Replace separate maintenance workflows with one date-targeted sync.
Track dataset coverage independently and compute from eligible inputs.

BREAKING CHANGE: Replace the maintenance, import:data, sync task, and
canonicalize:stock-codes entry points with data sync.
```

迁移交接时曾按既定 Gate 2 顺序等待 SQL 复审；该复审现已通过，用户已授权验证通过后提交。全部必需开发验证已通过，按上面的已批准信息提交，不 push。原设计会话的最终独立验收仍待用户交回。
