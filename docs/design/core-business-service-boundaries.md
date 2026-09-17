# 核心业务模块服务职责与文件边界审查

## 状态与范围

- 基线：`6e6aa446`（`refactor(market): align data domains and consumer boundaries`）。开始审查时工作区干净。
- 当前阶段：2026-09-17，C1 已提交 `62f17b47`，C2 已提交 `84dc9d5e`，C3 已提交 `c7eed1ac`；**C4 已通过人工 review、行为验证与干净构建，随本提交交付**。C5 已准备单次开工计划，等待范围批准；C5–C6 尚未实施；不推送。
- 已完整阅读根 `CLAUDE.md`、review-gated-development 工作流，并阅读五个模块 README、[架构地图](../backend-architecture.md)、[边界规则](../backend-boundaries.md)、[运行入口](../backend-runtime-entries.md)及[上一轮整理计划](core-business-internal-structure.md)。本轮不涉及 Web/Docs 前端实现。
- 交付对象是后端维护者；不新增用户能力、HTTP/SDK 方法、表或迁移，不改变权限、数据语义、事务、执行顺序及资源释放。
- 已确认 **6 个实现 commit**，准确标题见 §4。本文随 Commit 1 提交，不额外安排计划文档 commit。每个 commit 的说明、测试和开发记录一起交付。
- 审查基线执行 `pnpm check:backend-boundaries`：703 个文件、2,680 条运行时边、628 条类型边、0 违规、0 跨域循环组。另对生产文件的静态 import/re-export 做了模块内部环检查，未发现环；该补充检查不证明动态资源路径正确。实施后的检查结果单独记录于 §7。
- 上一轮的 225 文件 / 1,351 用例是历史验证结果，不把它记为本轮验收；本轮实际验证见 §7。

## 1. 整体判断与审查覆盖

目录整理后的主要业务流程已经有明确归属。本轮有价值的变化集中在：查询与独立执行流程混居、纯规则通过操作文件引入运行依赖、交接流程跨域写入，以及少量重复映射和仅转发的接口。没有理由为五个模块各安排一次目录重构。

审查从 HTTP、Agent、Job、Worker、CLI 追到实际实现、持久化和收尾，并反查共享函数的消费者。没有把函数名称中的 `read`、`compute` 或 `operations` 当作无副作用或职责混乱的证据。

| 模块 | 已追踪的实现与关键调用链 | 判断 |
| --- | --- | --- |
| Factor | `routes` → definitions/composition/publication；`submitFactorAnalysis` → `startFactorAnalysis` → `factorAnalysisJob` → `runFactorEvaluation`；`submitFactorHoldout` 的独立冻结事务；correlations 的缓存/活动 Job/提交/完成；weather 固定/刷新/恢复；两个 Agent 分析工具与问题上下文 | 生命周期主体保留。定义元数据、种子写入、编译检查与共用报告映射存在可消除的依赖和重复，见 C3。Agent 与 HTTP 的不同提交政策不强行合并。 |
| Strategy | definitions 的创建/保存/公开范围；`submitStrategyBacktest` → Job/Worker → `runConfiguredBacktest`；扫描提交 → 父 Worker → cell 子进程；`prepareStrategyFactors` 的三个使用场景；风险后处理与数据就绪要求 | 回测/扫描/Signals 复用输入准备有真实消费者。纯源码引用提取应独立，扫描的单消费者转发函数可删除，见 C4。 |
| Research | documents 列表/详情/编辑；文档锁、单 Cell/全文/下游/attempt；evidence 记录/固化；提案应用/接受/撤销；embedded 提交/执行/完成/取消；Curator；SDK dispatch/datasets/results；Factor/Strategy handoff | 文档列表归属明确可改；Curator 实际混合三条工作流；交接直接管理其他域草稿，见 C1、C2、C5。文档执行、提案审阅、嵌入分析不能按函数外形统一。 |
| Market | 股票四表同步、ETF 按日发布/按证券历史回填；日历、指数/统一序列、估值/状态/天气；财报来源/版本选择、宏观 as-of；商品连续收益的加载/计算/写入及审计消费者；国债/外部美债汇率同步、基准换算、风险驱动及直接消费者 | 数据领域及同步事务大体合理。共享曲线/汇率身份放在同步实现中，使读取和纯换算依赖同步，见 C6；其余不按“纯函数必须独占文件”批量拆分。 |
| Signals | `deployBacktestReport`；手动/每日入口 → `enqueueSignalRun` → `signalJob`/IPC；依赖血缘/利率准入；`initializeSignalAccounting` → `settleStrategyAccounts`/`rebuildDeploymentAccount` → `replayAccountDay`；人工成交与查询映射 | 暂不安排独立重构。部署、运行、记账、每日编排的职责和事务可以直接定位；`manage.ts` 只管理部署生命周期，名称没有掩盖其他独立业务。 |

相邻模块只追踪直接消费者。Maintenance 保留跨模块维护协调；Agent 的通用对话镜像、Engine 的宿主适配和 Sharing 的公开投影不套本轮目录模板。

## 2. 具体证据、收益与取舍

### E1：Research 列表放在文档操作文件中

基线证据：原 `documents/document-operations.ts` 的 `listResearchDocuments` 只查询会话、Cell 状态和末条消息，再用 `messagePreview` 形成摘要。唯一生产调用方是 `routes/document.ts` 的文档列表。它不创建文档、不关闭会话，也不执行归档。C1 已将实现迁入 [read.ts](../../apps/api/src/research/documents/read.ts)。

将这两个函数放入现有 `documents/read.ts`，列表与详情的查询条件/映射有同一阅读入口；`document-operations.ts` 保留创建、归档、恢复、重命名、删除。这里无需新增一层 query service。

`getResearchDocument` 仍在首次读取旧会话时补建文档。`read.ts` 表示对外读取入口，不承诺绝对无写入；不能把兼容补建移除、改成批量迁移或延后到编辑操作。

### E2：Curator 的执行、查询和人工反馈混居

基线证据：原 `curator/runs.ts`（C2 拆为 [prepare.ts](../../apps/api/src/research/curator/prepare.ts)、[read.ts](../../apps/api/src/research/curator/read.ts)、[feedback.ts](../../apps/api/src/research/curator/feedback.ts) 与 [views.ts](../../apps/api/src/research/curator/views.ts)）中：

- `prepareResearchCuratorRun` 被 `curator/job.ts` 调用，标记运行、提取证据、调用 LLM、检索仓库、核对能力/供应商探测并生成候选。`extractResearchCuratorEvidence`、`summarizeEvidence*`、`verifyDraft` 属于这条链。
- `getLatestResearchCuratorRun` / `getResearchCuratorRun` 被 HTTP 和 `curator/submit.ts` 调用，只读取结果并附加 `researchCuratorQuality`。
- `updateResearchCuratorFindingFeedback` 被 PATCH 路由调用，写 disposition/verificationAssessment；`setResearchCuratorFindingDisposition` 仍被现有测试使用。
- 三组实现共用记录映射，却让查询/反馈也依赖 LLM、仓库检索、SQL 能力目录和候选生成实现。

拆成执行、读取、反馈三组，窄的纯记录映射供读取和反馈共用。候选生成仍整体保留，不再按“证据提取/摘要/核验/指纹”各建一个文件。`job.ts` 继续拥有完成事务中的查重、finding 发布、计数和 Run/Job 终态；不把候选生成放进完成事务。

### E3：Factor 的共用定义信息牵连编译、种子与发布操作

基线证据（C3 已按下述目标调整归属，当前入口见 §3 和 §7）：

1. [definitions/views.ts](../../apps/api/src/factor/definitions/views.ts) 同时提供纯 `strategyKey` / `factorLanguage` 和会编译、释放运行时的 `customFactorTargetAssetClasses`。`definitions/catalog.ts`、`drafts.ts` 只需要前者；实际编译检查由 `definitions/read.ts` 消费。把编译能力移到 runtime，保留纯映射入口。
2. [definitions/builtin-factors.ts](../../apps/api/src/factor/definitions/builtin-factors.ts) 同时导出 `BUILTIN_*` / `builtinCatalog` 和 `seedBuiltinFactors`。目录、来源解析、天气、复制 key、相关性及 Strategy 只读取注册定义，bootstrap 才执行种子写入。`#infra/database/prisma.ts` 在模块初始化时创建 Prisma 并发出 PRAGMA，因此这里不只是文件看起来大。
3. [publication/factor.ts](../../apps/api/src/factor/publication/factor.ts) 导出纯 `normalizeAnalysisKind`，Strategy 准备因子却因此导入发布/编译实现。`normalizeFactorLanguage` 与 `definitions/views.ts` 的 `factorLanguage` 等价。`FactorPublicationError` 又被 `definitions/copy-key.ts` 和 Panel 发布共用，错误类型没有必要携带单因子发布实现。
4. [evaluations/start.ts](../../apps/api/src/factor/evaluations/start.ts) 的私有 `reportCompatibilityColumns` 与 [report-views.ts](../../apps/api/src/factor/evaluations/report-views.ts) 中同名实现重复，分别供普通分析、holdout 使用。两份都将 daily/weekly/monthly 映射为 day/week/month，同一存储口径以后容易分叉。

收益是定义查询/消费者只依赖所需的纯事实，发布状态仍由 publication 管理；普通分析与 holdout 共享同一份报告参数映射。并不合并它们的提交事务。

另外，原 `metadata-operations.ts` 仅包含 `refreshOwnedFactorMetadata`，负责 HTTP 所需归属/草稿检查和错误转换，再调用 `metadata.ts`。将其并回 [metadata.ts](../../apps/api/src/factor/definitions/metadata.ts)，保留原函数和 Agent 回调所用的 `refreshFactorMetadata`，可减少理解同一元数据刷新能力时的跳转。两次检查的时机与不同失败语义保留，不趁合并改变规则。

### E4：Strategy 的纯引用扫描与运行准备耦合，另有单消费者转发

基线证据：原 [factor-inputs/prepare.ts](../../apps/api/src/strategy/factor-inputs/prepare.ts) 的 `extractFactorKeys` 只做正则匹配、过滤引擎内置键、去重；消费者包括 `definitions/drafts.ts`、`visibility.ts`、`backtests/submit.ts`、`sharing/catalog.ts`。同文件还导入数据库、TS/Python 编译、Engine 因子类型和发布相关实现。C4 当前归属见 §3 和 §7。

将纯引用识别放到 `factor-inputs/references.ts`。`prepareStrategyFactors` 继续查询已发布来源、解析 Panel 快照/研究范围、编译模块、检查输入限制并返回 `{ modules, factors }`。它被回测、扫描和 Signals 使用，是真实共享能力，不应删掉或按消费者复制三份。

`prepareCustomFactors` 只返回上述结果的 `.modules`，唯一生产调用方是扫描父 Worker。删除该转发，父 Worker 直接解构 `prepareStrategyFactors` 的结果；不另建扫描 adapter，也不让扫描经过完整回测。

### E5：Research 交接直接拥有目标草稿的命名、重试和写入

证据：

- [handoff/factor-drafts.ts](../../apps/api/src/research/handoff/factor-drafts.ts) 的 `createResearchFactorDraft` 查询 Factor 复用关系、分配 key、避开 Factor/Composite/内置键冲突、捕获 P2002、直接 `prisma.factor.create`。
- [handoff/strategy-drafts.ts](../../apps/api/src/research/handoff/strategy-drafts.ts) 的 `createResearchStrategyDraft` 查询 Strategy 复用关系、分配名称、组装默认回测配置、捕获 P2002、直接 `prisma.strategy.create`。
- 两者由 `research/routes/evidence.ts` 调用；Research 同时负责成功/固化检查、LLM 生成、来源证据及返回结果。

这不是普通的跨模块只读投影：Research 在维护目标模块的身份和创建规则。把目标草稿的查询复用、分配、保存、冲突重试及目标结果映射交给 Factor/Strategy 的具名业务入口；Research 保留冻结研究准入、生成和 handoff 元数据。目标模块不反向调用 Research/Agent，也不接收生成器回调。

不能直接替换成普通 `createFactorDraft` / `createStrategy`：交接需要保留源执行唯一关联、既有默认值、预生成消息，以及“已存在时不再次生成”的行为。也不强行合并 Factor 的 `_2` 后缀与复制操作的 `_v2` 后缀。

### E6：Market 的共享数据身份依赖同步实现

证据：

- 纯 [deriveBenchmarkCnyCloses / deriveHkdCnhMidCloses](../../apps/api/src/market/cross-market/benchmark-conversion.ts) 从 `cross-market/external-drivers.ts` 取 `USD_CNH_CODE` / `USD_HKD_CODE`，后者导入 Prisma 并实现完整同步。
- `research/datasets/series.ts` 只需 `EXTERNAL_FX_CODES`；`market/macro/risk-axes.ts`、`state/market-risk-drivers.ts` 和 Maintenance 审计只需外部曲线/汇率标识，却也导入该同步文件。
- `engine/adapters/prisma-port.ts`、`factor/observations/etf-trend-observations.ts`、`rates/government-yield-availability.ts` 只需中国国债 source/code/type，却导入含 HTTP client、解析、数据库替换的 `rates/china-treasury-curve.ts`。

将共享曲线和汇率静态定义移到 Market 现有的 `registry/` 边界。消费方和同步方共同读取定义；同步函数、客户端、解析与 availableDate 分派保留原位。这能让纯汇率换算脱离数据库初始化，避免查询方通过同步实现取得身份事实。没有性能提速的实测结论，不以此声称优化了查询速度。

## 3. 改前 / 改后与内部接口

以下路径均相对 `apps/api/src`；改前归属以审查基线为准，新增目标的实施状态见 §7。没有兼容转发文件或总 barrel，测试/脚本中的直接引用一起更新。

| 当前归属 | 计划归属 | 函数与调用关系 |
| --- | --- | --- |
| `research/documents/document-operations.ts` 中列表及摘要 | 已有 `research/documents/read.ts` | `listResearchDocuments`、私有 `messagePreview` 整体迁移；document route 分别导入 read 与 operations。 |
| `research/curator/runs.ts` 的候选生成 | 新增 `research/curator/prepare.ts` | `prepareResearchCuratorRun`、`PreparedResearchCuratorRun`、证据提取、LLM/核验私有辅助；job → prepare。 |
| 同文件的查询和质量统计 | 新增 `research/curator/read.ts` | `getLatestResearchCuratorRun`、`getResearchCuratorRun`、`researchCuratorQuality`；route/submit → read。 |
| 同文件的人工反馈 | 新增 `research/curator/feedback.ts` | `updateResearchCuratorFindingFeedback`、`setResearchCuratorFindingDisposition`；PATCH → feedback。 |
| 同文件的记录映射 | 新增 `research/curator/views.ts` | `curatorRunRecord`、`curatorFindingRecord` 及映射所需类型；read/feedback → views；仅 type 导入 Prisma，不查询、不导入 prepare。旧 runs 文件删除。 |
| `factor/definitions/builtin-factors.ts` 的写库部分 | 新增 `factor/definitions/seed.ts` | 仅迁移 `seedBuiltinFactors` 及写库依赖；bootstrap → seed → builtin-factors/templates。内置定义/目录仍在原文件。 |
| `factor/definitions/views.ts` 的编译检查 | 新增 `factor/runtime/inspect-definition.ts` | `customFactorTargetAssetClasses` 与原编译/释放代码；definitions/read → runtime/inspect-definition。 |
| `factor/publication/factor.ts` 的共用归一化/错误 | 已有 `factor/definitions/views.ts`、`factor/errors.ts` | `normalizeAnalysisKind` 归 views；语言归一化复用 `factorLanguage`；`FactorPublicationError`/reason 归共用业务 errors。publication、copy-key、HTTP error adapter 和 Strategy 消费相应窄入口。 |
| 两份 `reportCompatibilityColumns`；views 内 spec 解码 | 新增 `factor/evaluations/report-spec.ts` | 一份 `reportCompatibilityColumns` 与 `reportResearchSpec`；start/holdout/report-views 按需导入。结果投影和封存仍归 report-views/read。 |
| `factor/definitions/metadata-operations.ts` | 合入已有 `factor/definitions/metadata.ts` | 保留 `refreshOwnedFactorMetadata`、`refreshFactorMetadata`、`generateFactorMetadata` 三个不同层次的入口，删除额外文件。 |
| `strategy/factor-inputs/prepare.ts` 的引用扫描 | 新增 `strategy/factor-inputs/references.ts` | `extractFactorKeys` 与内置键集合；定义/公开范围/提交/Sharing 和 prepare 直接消费。 |
| `prepareCustomFactors` → `prepareStrategyFactors().modules` | 合并到扫描调用点 | 扫描父 Worker 调用 `prepareStrategyFactors` 并解构 modules；类型使用 `PreparedStrategyFactors['modules']`，不保留转发函数。 |
| Research 内 Factor 草稿 DB 操作 | 新增 `factor/definitions/from-research.ts` | 拟导出 `findResearchFactorDraft(userId, executionId)`、`createFactorDraftFromResearch(userId, input)`。 |
| Research 内 Strategy 草稿 DB 操作 | 新增 `strategy/definitions/from-research.ts` | 拟导出 `findResearchStrategyDraft(userId, executionId)`、`createStrategyDraftFromResearch(userId, input)`。 |
| `china-treasury-curve.ts` / `external-drivers.ts` 的曲线静态定义 | 新增 `market/registry/yield-curves.ts` | 中国国债 source/code/name/type/terms、美国 nominal/real source/code/name/type；保持常量名称和值。 |
| `external-drivers.ts` 的 FX 静态定义 | 新增 `market/registry/fx.ts` | `USD_CNH_CODE`、`USD_HKD_CODE`、`FXCM_EXCHANGE`、`EXTERNAL_FX_CODES`；换算、数据查询、同步和审计直接引用。 |

### 交接调用关系

```text
改前
Research route → handoff
  → 目标表 findFirst
  → evidence 成功/固化检查 → LLM 生成
  → 目标 key/name 分配与默认值 → 目标表 create / P2002 重试

改后
Research route → handoff
  → Factor/Strategy.findResearch*Draft（返回既有草稿结果或 null）
  → evidence 成功/固化检查 → 原 LLM 生成 → handoff 元数据
  → Factor/Strategy.create*DraftFromResearch（分配、保存、重试、目标结果映射）
```

目标入口的 input 是本模块声明的普通数据类型：来源 executionId、生成的名称/key base/code/messages、既有 shared handoff 对象及必要 locale/analysisKind。不能导入 `research/handoff/*` 的生成器类型，不能接收 `Prisma.CreateInput` 或任意更新字段作为接口。`find*` 保留 `reused: true`，`create*` 正常返回 `reused: false`，唯一冲突命中并发胜者返回 `reused: true`。

先查询既有草稿、后检查源执行和调用 LLM 的顺序保留；没有新事务包住外部生成。Factor 保留最多 100 次 key 尝试及 32 字符规则；Strategy 保留外层 50 次写入重试、`uniqueStrategyName` 的现有命名策略。未知数据库错误仍原样抛出。

## 4. 提交计划与逐项验收

已确认的准确英文提交标题如下。按顺序执行，每个提交完成整个约定范围后再交 review；实际进度见 §7。

| Commit | 准确标题 | 完整交付范围 |
| --- | --- | --- |
| C1 | `refactor(research): group document queries in the read entry` | E1 的列表/摘要迁移、所有引用和相关测试、Research README；本文一并提交。 |
| C2 | `refactor(research): separate curator preparation and feedback` | E2 的 prepare/read/feedback/views 四组职责、job/submit/route 引用、现有 Curator 测试与 README；删除 runs.ts。 |
| C3 | `refactor(factor): clarify definition and evaluation support boundaries` | E3 中种子/纯映射/运行检查/共用错误/spec 映射的归属，以及 metadata 文件合并；bootstrap、Strategy 直接消费者和相关测试/文档同步。 |
| C4 | `refactor(strategy): isolate factor references from runtime preparation` | E4 的纯 references、全部直接消费者、扫描父 Worker 去掉转发、对应测试及 Strategy/Sharing 阅读说明。 |
| C5 | `refactor(research): delegate handoff persistence to owning modules` | E5 的两个目标域创建入口与 Research 编排迁移，保持来源和并发语义；目标域/交接测试，三模块 README 和架构地图。 |
| C6 | `refactor(market): separate shared data identities from synchronization` | E6 的两组 registry 定义、所有直接消费者/测试及 Market README；完成全轮验证与本文记录。Signals 不另做结构修改。 |

C3 的范围是 Factor 向内部和直接消费者提供的支撑能力边界；不混入候选提交政策、发布准入或评估器算法变更。C5 则是完整的跨域交接边界，不能只搬 Factor 一侧而留下 Strategy 一侧另待下一轮。

### 所有实现 commit：人工 review 前

1. 检查改动文件格式和 ESLint，运行全仓 `pnpm typecheck`。已核对该命令包含后端边界与三个生成契约一致性检查，不运行行为测试或构建。
2. `git diff --check`；检查旧 import/重导出、脚本/测试引用及新增文件依赖。逐项核对 §3 的目标，不新增循环或纯入口到数据库/编译/同步的运行时边。
3. 检查公开 HTTP/schema/shared SDK、Prisma schema/migration、Job payload、Worker URL 和资源路径没有意外变化。无 deployable workspace/package 或跨包构建依赖变化，因此不修改 deployment impact 清单。
4. 交付未提交的完整 diff、准确标题、静态结果与待运行验证，明确等待人工代码 review。此前不运行 unit/integration/E2E、smoke、业务脚本或 build。

### 人工 review 后的行为验证

| Commit | 必要回归 | 事务、运行与资源验收 |
| --- | --- | --- |
| C1 | 文档操作与 routes 集成测试：active/archived 排序、preview 的 text/research/universe 分支和 80 字截断、Cell 计数、owner/embedded 排除；既有 legacy 首读补建/归档恢复场景 | 隔离 SQLite 验证列表不补建、详情才补建；创建/归档/删除的关闭会话和级联行为保持。不新增真实 Python 运行，因为执行代码未动。 |
| C2 | `curator/runs.test.ts` 随职责调整、`reference-search.test.ts`、Research routes、`tests/job-lifecycle.integration.test.ts` 的相关场景：owner/cursor/embedded 排除、候选核验、反馈及质量统计 | 受控 LLM + 临时 SQLite 跑 submit → execute → complete/fail/recover；Run+Job 创建一起回滚，完成时查重与 findings/计数一起提交。源码及干净编译入口验证一次受控 Curator Job，并从 API cwd 验证仓库检索。 |
| C3 | builtin 公式对照、metadata、Factor routes、publication、start/read/holdout、Strategy 因子准备；对共享 spec 映射覆盖四类 analysisKind 和旧 spec 回退 | 临时 SQLite 验证种子新增/重复执行/源码变更及历史报告保留；普通分析与 holdout 的旧列/冻结快照/哈希一致，创建失败不唤醒队列。真实 TS 定义检查覆盖成功/异常释放；Python 目标资产读取只解析字面量，沿用 validator 回归，不因此启动 Python 沙箱。源码/干净编译 bootstrap 保留后台种子启动时机，Factor Job 完成/失败/恢复沿用现有 harness。 |
| C4 | references 提取既有 TS/Python 声明、ctx.factor、过滤/顺序用例；prepare、definitions/config、Strategy routes、Sharing 权限及 scans 回归 | 源码与干净编译的扫描父 Worker + cell 子进程实际运行，确认只准备一次、每 cell 正常退出后汇总；回测和 Signals 的共享准备回归覆盖 published/archived、Panel 冻结范围和血缘。|
| C5 | handoff 的 Factor/Strategy drafts 与 generation 测试、目标定义/Research routes。增加缺失的 key/name 冲突、源执行并发胜者复用、P2002 非源冲突继续尝试和非 P2002 原样失败覆盖 | 真实临时 SQLite 写入两个目标草稿并通过原查询入口读取：来源、messages、默认配置、私有草稿状态一致；复用不调用生成器。生成失败不留目标记录；重试不包入新的总事务。源码/编译调用原 Research 交接入口，LLM 使用受控替身。 |
| C6 | treasury、external-drivers、benchmark-conversion、market-risk-drivers、macro risk-axes；Research series、Factor ETF observations、Engine adapter、Signals rates 的相关测试 | 本地供应商替身 + 隔离 SQLite 验证两种同步原有代码值/次日 SSE 可得日/空响应保留/范围替换。同步入口与 CLI 不搬迁；对受影响 CLI 用源码/编译入口验证导入、调用、输出、退出。最后执行完整 API 测试、干净 API 构建及受影响 Factor/Strategy/Signals 运行入口回归。 |

已有测试足以覆盖的语义直接保留，不为每次函数移动增加镜像测试。新增覆盖只针对真实边界风险，例如交接重试、列表与详情的不同写入语义。每个提交的 API 编译在人工 review 后完成；已通过的相同验证不因形式完整重复执行，后续改动触及它时才重跑。

运行验证使用独立数据库、本地供应商/LLM 替身，不向真实行情源、邮件服务发送请求。源码使用 development 条件，生产入口使用干净 dist 和原 package imports；遵循 [运行入口清单](../backend-runtime-entries.md)，不能把 import 成功代替 Worker/CLI 执行。测试结束关闭临时 API/Worker/Python/IPC/数据库连接并核对资源释放。

本轮不改变前端、公开帮助、SDK 文档或双语文案；不计划浏览器 E2E。若实施发现必须改变用户契约、事务、资源协议或运行 URL，则先修订计划并讨论，不能只补一个测试后带过。

review 通过后视为授权执行约定验证并按上表标题提交，不再增加 commit 确认。测试/fixture/harness 问题在批准范围内自主修正，不跳过用例、不弱化断言；产品代码再变则重新静态检查和人工 review，之后才恢复验证。不推送。

整体计划批准不替代各 commit 的单次开工批准。每个提交完成后，先交付下一个 commit 的范围、准确标题、交付接口、技术路径和验收安排，停在 Gate 1；获准后才实施。

## 5. 应保留的差异与不采用的拆分

| 结构/看似不一致的实现 | 具体理由 |
| --- | --- |
| `documents/read.ts` 的兼容写入 | `getResearchDocument` 为旧会话生成首份文档，是既有读取语义；移动列表不改变它。 |
| `archive-idle-document.ts` 与底层 archive 分开 | HTTP 入口额外检查 Cell/Agent 忙碌状态；底层 archive 负责归档和会话关闭。两者不是同义转发，不能随合并增加所有调用方的拒绝条件。 |
| `curator/prepare.ts` 内保留证据提取、LLM 摘要与候选核验 | 都为一次候选生成服务；目前没有多个独立生产消费者要求单独生命周期。四个目标文件已能区分执行、读、反馈与共用映射。 |
| `evidence/execution-records.ts` 的创建/完成/读取/固化 | 同一冻结证据记录，未混入 Python 执行或另一业务流程。当前约 300 行的共同快照/视图有内聚性；仅因同时有读写不足以拆出四层。 |
| `proposals/cell-changes.ts` 的应用/接受/撤销 | 共享修订冲突、位置重排、review 链和 `applyOperations(transaction, ...)`；普通 Cell 编辑和提案修改有不同审核/批量规则。文件较长值得继续关注，但本轮没有证据支持拆散事务或复用普通 CRUD。 |
| 普通文档、attempt、embedded 的执行 | 分别有干净全文冻结、尝试绑定与内容修订检查、Job/首次成功冻结/超时取消。共用 Python 会话不代表应共用同一业务执行器。`run-result` 被多个运行入口消费，`execute-plan` 被 affected/attempt 消费，均不是无消费者层级。 |
| Factor `submit.ts` → `start.ts` | HTTP 解析已保存来源；两个 Agent 工具冻结候选代码，另有限制 explore 截止日等政策。`startFactorAnalysis` 有三个生产入口复用，负责报告/Job 冻结，不是纯转发。不可直接让 Agent 调 HTTP 提交而丢失候选代码。 |
| Factor correlations 的 `operations.ts` | 约 180 行围绕同一缓存身份、授权键集合和活动 Job 复用；read/submit 共用的规范化和寻址内聚。不为“operations 宽泛”再加 read/submit/keys 三层。 |
| Factor composition 的 `operations.ts` | 读取与草稿操作共用同一资源映射；跨作者 Panel 复制还要在同一事务中创建组件与组合。保留完整复制边界，不调用会自行提交的普通草稿入口。 |
| Factor weather 的查询副作用 | `listFactorWeatherPins` 会触发 pending/running 刷新；`refreshFactorWeatherPin` 拥有进程内并发和观察点写入。不能把列表改成纯读、取消恢复刷新或强行改成 Job。 |
| Factor 元数据刷新两个业务入口 | HTTP 的缺失/非草稿为错误，Agent 的低层刷新在目标不可用时直接返回；合并文件不合并这两个契约。 |
| Strategy `backtests/reports.ts` 与 `scans/reports.ts` | 回测只列成功且有结果的报告，扫描列各状态且最多 50 条；活动查询起点也不同。不能因接口外形相似统一查询与错误。 |
| Strategy `scans/scan.ts` | 规格、组合枚举、结果摘要及注入 run 回调的串行扫描，没有数据库、fork 或语言 runtime 依赖；实际进程管理在 Worker。无需再拆所谓计算层与服务层。 |
| Strategy `factor-inputs/prepare.ts` 的使用场景 | deployment 只许 published；research/signal 允许 published/archived。Signals 另核对冻结血缘，既有部署的后续运行不等同于新部署准入。 |
| Signals `submit.ts` 与 daily/scheduler | 手动入口解析日期后先结算再入队；每日入口一次同步/结算后串行处理部署。两者最终共用 enqueue，但前置职责不同；不是应该删除的薄转发。 |
| Signals accounting 的 read/settlement/replay | 查询映射无编译/LLM；重放是纯计算，settlement 管逐日写入，executions 管人工成交与重建。`deploymentWire` / `executionWire` 位于各自 read 文件无需再各建 views。 |
| Signals Job 的 afterCommit | 完成事务后先初始化记账，再通知；记账失败不会撤销已完成 Run/Job，并会阻止后续通知。保留顺序，不趁重构添加 outbox/重试协议。 |
| Market 股票/ETF/期货同步与私有校验 | 候选校验服务原范围替换；股票四表、ETF 三表、历史证券/年度切片具有不同原子性/断点要求。保留 `syncDailyCoreDate`、`syncEtfMarketDate`、`syncEtfDaily` 的不同流程。 |
| Market 客户端、解析器与同步相邻 | C6 只抽有跨流程消费者的身份事实；不为每个纯 parser 新建文件。美债/FX 仍联合取数和汇总、按原顺序分别写入；不虚构一个联合总事务。 |
| Market 商品、宏观、财报的数据构造与读取 | `computeCommodityContinuousReturns` 实际加载映射/行情/日历，供 rebuild 和质量审计复算；不能因 compute 名称误判纯函数。`macro/as-of.ts` 仅类型依赖数据库，加载和纯选择围绕同一 vintage 规则。财报 source-contract 的 append 是纯数组合并，不是落库。 |
| Research datasets/results 跨域只读 | SDK 有 owner、已完成/holdout 封存、传输限制及 snake_case 等映射要求，不能用 HTTP 详情的返回形状替换。它们不接管来源状态或写入，不加全域 repository。 |
| Maintenance / Agent / Engine 的既有职责 | Maintenance 保留同步/发布/恢复协调；Engine 宿主桥仍可读取 Market；Agent 保留对话关联/镜像，不按核心模块目录模板重排。 |

## 6. 单独记录，不混入本次重构

### Factor Agent 候选分析的语言传递

静态调用链发现一个行为问题：`agent/profiles/factor.ts` 在 Python 的 cross_sectional/time_series profile 中仍装配 `runFactorAnalysisTool` / `runTimeSeriesFactorAnalysisTool`；两个工具调用 `startFactorAnalysis` 时构造的 source 都省略 language/runtimeVersion。`factorAnalysisSourceLanguage` 对省略 language 的 source 返回 TypeScript，因此候选 Python 代码会按 TS 标记并选择运行路径。`withEmbeddedAnalysis` 只是追加嵌入工具，没有移除这两个正式分析工具。

这是从实现得到的静态结论，尚未做行为复现；不能将其描述成已验证的生产故障。修复会改变报告语言、哈希、运行选择，或改变工具可用性，需要单独确定产品行为与回归范围，不包含在六个 refactor commit 中。

### 其他既有边界限制

- `agent/conversations/entity-messages.ts::writeMessages` 直接镜像 Strategy/Factor messages，Factor 还检查 draft 状态。这是现有 Agent 对话适配职责；将其改成业务回调/新的持久化协议会涉及消息顺序和更广的 Agent 设计，另议，不混同 C5 的草稿身份与创建流程。
- Signals 手动提交会在 enqueue 的部署归属检查前调用全局 `settleStrategyAccounts`；人工成交写入与实际账户完整重建也不是同一总事务。本轮保留这些可观察顺序，不把职责移动变成授权顺序/原子性的修复。
- 提案撤销的 `validateProposedDocument` 会在现有事务上下文内做 Python 分析。将外部分析移出事务需要重新定义并发复查，不能以“拆文件”名义顺手改动。

上述事项不阻碍结构整理；若用户选择在本轮解决，应另定行为目标与提交计划，不悄悄扩充已批准提交。

## 7. 执行记录

| 项目 | 状态 |
| --- | --- |
| 五模块整体审查与静态基线 | 完成 |
| 整体计划讨论 / 批准 | 2026-09-16 用户确认；不代替各 commit 的单次开工批准 |
| C1 产品实现 | 列表与摘要迁至 read；路由、查询测试、README 已同步；补充列表不补建旧会话的集成断言 |
| C1 静态检查 / 人工 review | 静态检查通过；2026-09-16 用户确认代码 review |
| C1 行为验证 / 提交 | 4 个测试文件、67 项通过；API 构建通过；已提交 `62f17b47` |
| C2 产品实现 / 静态检查 | prepare/read/feedback/views、调用方和测试已归位；静态检查通过 |
| C2 人工 review / 行为验证 / 提交 | 2026-09-17 用户确认代码 review；4 文件、90 项回归及源码/编译入口通过；已提交 `84dc9d5e` |
| C3 产品实现 / 静态检查 | seed、inspect-definition、纯映射/共用错误、report-spec 归位，metadata 合并；静态检查通过 |
| C3 人工 review / 行为验证 / 提交 | 2026-09-17 用户确认代码 review；15 文件、188 项回归、干净构建及源码/编译入口通过；已提交 `c7eed1ac` |
| C4 单次开工计划 | 2026-09-17 用户批准 |
| C4 产品实现 / 静态检查 | references 纯入口、四个业务消费者、扫描直接准备及测试/文档同步；静态检查通过 |
| C4 人工 review / 行为验证 / 提交 | 2026-09-17 用户确认代码 review；10 文件、99 项回归、干净构建及源码/编译入口通过，随本提交交付 |
| C5 单次开工计划 | 已准备，等待范围批准；尚未实施 |
| C5–C6 | 尚未实施 |
| 当前工作区变化 | C4 实现、回归测试、Strategy/Sharing README 与本文；不推送 |

每个获准提交完成后在此记录人工 review、静态检查、实际测试/运行条件、限制与 commit hash；历史测试结果不能填入本轮结果。

### C1：文档列表查询归属（2026-09-16，验收通过）

提交标题：`refactor(research): group document queries in the read entry`。

- `listResearchDocuments` 和私有 `messagePreview` 原样迁入 `documents/read.ts`；HTTP 列表与详情统一从此导入。`document-operations.ts` 保留创建、归档、恢复、重命名、删除，没有兼容转导出。
- 列表单元测试迁至 `documents/read.test.ts`，保留 active/archived 查询、归属/embedded 过滤及摘要断言；补充 blocked 计数和 text/research/universe 摘要首条选择、80 字截断。原操作测试继续覆盖归档关闭会话及恢复幂等性。
- 现有临时 SQLite 路由用例补充断言：列表包含旧会话且不建 ResearchDocument，非所有者详情请求仍不创建，所有者详情才补建。归档恢复和删除级联继续由已有集成用例覆盖。README 已同步查询入口与兼容写入说明。
- 静态检查通过：变更 TS 文件 Prettier、ESLint、全仓 `pnpm typecheck`（含三个生成契约检查）；后端边界为 704 个文件、2,682 条运行时边、627 条类型边、0 违规、0 跨域循环组。`git diff --check` 通过。
- 补充静态核对：以 AST 提取原 operations/read 两文件的 11 个函数并对比基线，函数源码全部一致；只是文件位置和导入改变。未改公开 API、schema、SDK、事务、Python 会话或资源路径。
- 人工 review 通过后执行：documents 的 read/operations 单元测试与 Research routes 集成测试，3 文件、50 项通过；embedded lifecycle 实际运行完整文件，17 项全部通过（包含约定的 owner-scoped APIs 场景）。共 4 文件、67 项通过，`pnpm --filter api build` 通过。
- 使用现有临时 SQLite 与受控运行时替身，未调用真实 LLM/供应商或启动 HTTP/Python 服务。测试进程与构建正常退出，数据库连接由 afterAll 断开；核对两类临时目录均无新增残留。
- 验证后未修改产品代码或测试；已按确认标题提交 `62f17b47`，未推送。

### C2：Curator 执行、查询与人工反馈（2026-09-17，验收通过）

提交标题：`refactor(research): separate curator preparation and feedback`。

- `curator/runs.ts` 拆为四个具名入口并删除原文件：prepare 保留证据提取、LLM 摘要与候选核验的完整流程；read 保留两种 Run 查询与质量统计；feedback 保留人工处置/核验评价；views 只做纯记录映射，全部 import 为类型导入。
- job → prepare，submit/GET → read，PATCH → feedback；read/feedback → views，不再导入 LLM 或检索实现。Job 的 parse/execute/complete/fail/recover 与提交事务本身不变，候选生成仍位于完成事务之外，完成事务仍查重并发布 findings、更新 Run/Job。
- 保留 `runs.test.ts` 作为跨 Curator 流程集成测试，直接导入新职责入口；生命周期测试替身改为拦截 prepare。没有为四个实现文件机械新增四份测试。
- Research HTTP 集成测试增加查询/反馈连通场景，覆盖空 latest、owner 隔离、旧 verification 字段回退、独立处置/核验评价及质量统计；仓库检索测试增加 finally 清理临时目录，原断言保留。
- 静态检查通过：变更 TS 文件 Prettier、ESLint、全仓 `pnpm typecheck`（含三个生成契约检查）；后端边界为 707 个文件、2,688 条运行时边、634 条类型边、0 违规、0 跨域循环组。旧实现 import 与 mock 引用均已移除，`git diff --check` 通过。
- AST 核对原 runs 文件的全部 27 个函数/类型/常量声明，除两个映射函数新增具名 export 外，源码保持一致；无公共 API、schema、LLM 提示、核验规则或执行顺序变化。
- 人工 review 后运行 Curator runs/reference-search、Research routes、Job 生命周期回归：4 文件、90 项全部通过（8 + 1 + 44 + 37），覆盖创建/完成事务回滚、批内及并发查重、失败与恢复。未修改产品代码或仓内测试。
- 使用全新输出目录完成 API `tsc` 构建，保留 API package imports 和依赖解析；确认无旧 `curator/runs.js` 残留。源码启用 development 条件，编译入口不启用；均从 API cwd 实际调用 submit → claim → executor → Curator Job，并验证完成后的反馈/读取、失败/恢复及默认仓库检索。每种入口接收两次受控 LLM 响应，无真实网络请求。
- 运行入口 harness 首次缺少空 SQLite 文件，Prisma 在迁移前报 schema engine error；按现有 fixture 方式先创建文件后两种入口均通过，不改变产品实现或弱化断言。
- 测试和 harness 正常退出、断开 Prisma；核对临时数据库无打开句柄，各类测试 fixture 目录无新增残留，随后删除本次临时数据库、干净构建和 harness 目录。未启动 HTTP/Python 服务，未调用真实模型、行情或邮件。
- 已按确认标题提交 `84dc9d5e`，未推送；本段均为 C2 实测结果，不沿用 C1 的 67 项结果。

### C3：Factor 定义与评估支撑能力（2026-09-17，验收通过）

提交标题：`refactor(factor): clarify definition and evaluation support boundaries`。

- `seedBuiltinFactors` 原样迁到 `definitions/seed.ts`；bootstrap 及其测试导入新入口，后台启动时机不变。builtin-factors 只保留静态定义、模板键和目录映射，没有 Prisma 导入或兼容转导出。
- `customFactorTargetAssetClasses` 原样迁到 `runtime/inspect-definition.ts`；definitions/read 直接消费。保留 TS 编译后的 finally 释放、Python 字面量解析和其他 analysisKind 返回 equity 的既有路径。
- `normalizeAnalysisKind` 归 definitions/views；发布复用已有 `factorLanguage`；发布错误类及 reason 归 factor/errors，发布、复制与路由统一引用同一类。Strategy 只为分析类型映射导入 views，不再为此导入发布实现。catalog 的既有分析类型投影以及 cross-sectional/series 接受空值的私有语言辅助不改。
- `report-spec.ts` 保存一份兼容列映射和原 spec 解码；普通分析、holdout、资格检查及报告读取按需消费。旧 spec 缺失/非法时的回退保持，包括旧 freq 非 week 时仍回退为 month；没有合并普通提交与 holdout 的事务或改动封存映射。
- `refreshOwnedFactorMetadata` 并入 metadata，删除 metadata-operations；三个原函数的实现保持。HTTP 首次 owner/draft 检查、低层第二次检查、消息回退与错误转换均保留，Agent 不新增 HTTP 拒绝条件。
- 新增种子临时 SQLite 回归，覆盖三类预置的新增/幂等、源码等字段修复和历史报告不变；补充 metadata 入口差异、二次检查与提供方失败用例。普通提交补齐四类分析的兼容列断言及 daily/weekly/monthly，HTTP 读报告补充三种旧 spec 回退情形。
- 静态检查通过：变更 TS 文件 ESLint、Prettier、全仓 `pnpm typecheck`（含三个生成契约检查）；后端边界为 710 个文件、2,711 条运行时边、634 条类型边、0 违规、0 跨域循环组。旧实现 import/mock 引用均已迁移，`git diff --check` 通过。
- AST token 对照确认 10 个迁移/合并声明保持一致；28 个保留声明仅发布调用的语言辅助标识符按计划替换，其他 token 不变；两份兼容列映射在参数同名后函数体完全一致。静态追踪 builtin-factors、views、errors、report-spec 的已解析项目依赖，无数据库、LLM、执行器或发布实现依赖、无静态环。report-spec 经既有 schema 引用纯 Python 协议校验定义，不将其误算成运行 Python。
- 本次实施前遗漏了 C3 单次开工确认；用户指出流程问题后接受当前实现进入 review，并于 2026-09-17 确认代码 review。后续提交严格遵守独立 Gate 1，不将整体计划批准视为后续实施授权。
- 人工 review 后，bootstrap、builtin 公式、seed、metadata、Factor HTTP、两组 publication、start/read/research-policy/spec、TS 资产编译、Python validator、Strategy factor preparation 与 Job lifecycle 共 15 文件、188 项测试通过。包括临时 SQLite 种子/历史报告、普通提交/holdout 冻结与回滚、HTTP 错误类映射和旧 spec 回退；Strategy 准备测试使用真实本地 Python runner，validator 使用 Pyright，相关进程正常结束。
- 全新输出目录完成 API `tsc` 构建，保留 API package imports 与依赖解析，确认不存在旧 metadata-operations 编译文件。用固定行情隔离数据库分别验证源码 development 条件及不带该条件的干净编译入口，实际经 `startFactorAnalysis` → claim → executor → Factor Worker 完成普通分析和 holdout。重复申请、冻结代码/哈希/参数列、创建失败回滚、封存/揭示/日志保护、执行失败和中断恢复均通过。
- 两种入口分别执行 time_series/Panel 的真实 TS 定义检查成功与校验失败，观测到每次创建的 4 个真实 isolate 全部 disposed；Python 目标资产读取使用含禁止执行语句的源码，仍只解析字面量，缺失声明保持拒绝。资源探针起初尝试修改原生只读对象失败，改用临时导入钩子记录真实 isolate；不替换其计算实现。
- 两种入口实际调用 bootstrap：先恢复 running Job/报告，再后台启动种子与 HTTP。临时阻塞种子首个查询时，HTTP health 已返回 200 且预置行数仍为 0；解除阻塞后各完成 31 个预置定义写入。沙箱初次拒绝本机端口监听，使用已授权的验收权限重试后两种入口均通过。
- 验证期间没有修改产品代码、仓内测试或断言，仅修正临时 harness。实际 Worker 正常退出，临时 HTTP 服务关闭、Prisma 断开；核对两种入口的端口均已关闭、本次数据库无打开句柄、harness 进程及测试 fixture 均无新增残留，随后删除本次临时数据库、干净构建与探针目录。未调用真实模型、行情供应商或邮件服务。

### C4：Strategy 因子引用与运行准备（2026-09-17，验证通过）

准确标题：`refactor(strategy): isolate factor references from runtime preparation`。

交付为后端内部接口整理，不增加用户可见能力。当前 `extractFactorKeys` 只做源码正则提取、内置键过滤及去重，但四个外部消费者为此导入含数据库/编译器的 prepare；扫描父 Worker 的 `prepareCustomFactors` 则只有一个生产消费者且只转发 `.modules`。

- 新增 `strategy/factor-inputs/references.ts`，迁入 `extractFactorKeys` 与 `ENGINE_FACTOR_KEYS`，仅依赖 shared 静态事实。`definitions/drafts.ts`、`definitions/visibility.ts`、`backtests/submit.ts`、`sharing/catalog.ts` 和 prepare 直接引用；同步所有测试/mock，不保留兼容转导出。
- `prepare.ts` 保留 `prepareStrategyFactors`、使用场景类型及完整查询/编译/Panel 快照准备。删除 `prepareCustomFactors`；扫描父 Worker 直接调用 `prepareStrategyFactors` 并取 modules，cell 参数类型引用 `PreparedStrategyFactors['modules']`。每次扫描只准备一次、各 cell 的串行进程和正常退出后汇总保持。
- 不改变源码识别正则、返回顺序、去重、内置过滤或公开范围政策；deployment 只允许 published，research/signal 允许 published/archived，Panel 冻结范围及血缘规则保持。回测、Signals 继续消费原准备入口；不改 Engine、HTTP/SDK、数据表、事务、Job payload、Worker URL 或资源释放。
- 同步 Strategy/Sharing README 和本文。review 前执行改动文件 ESLint/格式、全仓 typecheck/生成契约/后端边界、旧引用核对及 `git diff --check`；静态确认 references 不依赖数据库或编译实现。
- review 后执行纯引用提取、prepare、definitions/config、Strategy HTTP/回测路由、Sharing 权限、scans 和 Signals 因子血缘相关回归，API 干净构建；在隔离数据库以源码及编译入口实际运行扫描父 Worker/cell 子进程，检查准备次数、结果和退出，并回归回测/Signals 的共享准备场景。

单次开工计划已于 2026-09-17 获用户批准。若实现需要改变提取规则、发布准入、事务或执行/释放语义，先讨论范围，不混入本提交。

实施与检查记录：

- `ENGINE_FACTOR_KEYS` 与 `extractFactorKeys` 整体迁入 references；prepare 使用新入口，原正则、过滤、去重及返回顺序保持。四个业务消费者与回测路由 mock、Engine 现有引用提取测试均改为直接引用 references，没有兼容转导出。
- 删除 `prepareCustomFactors`；扫描父 Worker 在原调用点解构 `prepareStrategyFactors(...).modules`，仍传入相同 source/userId/locale、使用默认 research 场景，并在每次扫描开始前准备一次。cell 参数只调整类型引用；fork、消息、退出判断和 finally 断开 Prisma 的代码保持。
- 原 prepare 测试中的 TS/Python 提取用例迁入 `references.test.ts`，不再需要数据库替身；补充跨调用/声明的排序去重，以及内置键、非法标识符、动态表达式和空源码过滤断言。运行准备、Panel 快照与使用场景测试保留在 prepare.test；既有 HTTP 私有化、Sharing 目录过滤和扫描用例继续作为行为回归。
- Strategy/Sharing 阅读说明同步新入口；未修改公开契约、数据模型、引擎计算、权限或部署清单。
- 静态检查通过：11 个改动/新增 TS 文件的 ESLint、Prettier，全仓 `pnpm typecheck`（含三项生成契约检查），后端边界扫描 712 文件 / 2,714 runtime edges / 635 type edges，0 违规、0 跨域循环组；`git diff --check` 通过。
- 静态 AST 对比确认：迁移的提取函数和内置键集合与 C3 完全一致；prepare 剩余 7 个声明、4 个业务消费者的非 import 代码完全一致；扫描只内联 modules 选择并调整类型引用。references 仅导入 shared 静态定义；源码、测试和脚本中无 `prepareCustomFactors` 残留，也无从 prepare 导入引用提取的旧调用。
- 2026-09-17 用户确认代码 review 后，10 个文件 / 99 项测试通过：references、prepare、definitions/config、Strategy HTTP/回测路由、scans、Sharing HTTP、Signals HTTP/lineage 和 Engine 既有因子语义；包含 Python 准备、Panel 冻结范围/组合与使用场景差异。API 在全新临时 outDir 完整编译通过，编译入口使用原 package imports 和依赖链接，没有复用旧 dist。
- 独立 SQLite 使用现有迁移和合成行情构造 fixture；首次 Prisma migrate 因目标文件未预建报 schema engine 错误，创建空 SQLite 文件后重试通过，未改迁移或产品代码。源码使用 development 条件，编译入口使用生产解析，均实际完成回测 Worker、扫描父 Worker 与两个 cell 子进程、Signals IPC 成功与血缘漂移拒绝。
- 临时探针包装真实 `prepareStrategyFactors` 并追踪真实 fork：两种入口的扫描都只准备一次，使用默认 research 场景，准备完成后才启动第一个 cell；每个 cell 返回结果并以 0 退出，随后才启动下一 cell / 汇总。两格均有非空交易，扫描不创建普通回测报告；回测使用冻结 Panel 范围，报告含 252 个风险观察点。
- deployment 拒绝 archived；research/signal 保留 published/archived 规则。实际 Signals 使用归档后的冻结依赖生成非空输入摘要，并拒绝 codeHash 漂移；两种入口的回测、扫描、依赖和 Signals 四组结果完全一致。
- review 后 11 个 TS 文件的内容哈希均未变化，未修正仓内测试或弱化断言。10 个被追踪进程全部退出，Prisma 已断开，三个 fixture 数据库无打开句柄；本次不启动 HTTP/socket 服务，不调用真实模型、行情供应商或邮件服务。临时数据库、构建和探针在交付前清理。

### C5：Research 交接持久化归属（单次开工计划，待批准）

准确标题：`refactor(research): delegate handoff persistence to owning modules`。

交付面向后端维护者，不新增用户能力。当前 `research/handoff/factor-drafts.ts::createResearchFactorDraft` 和 `strategy-drafts.ts::createResearchStrategyDraft` 在完成证据准入和生成后，还直接负责目标表查询、key/name 分配、默认配置、创建、唯一冲突重试与结果映射。唯一产品消费者是 Research evidence 路由。此次把目标身份和持久化规则归还 Factor/Strategy，Research 继续拥有证据准入及生成编排。

- 新增 `factor/definitions/from-research.ts`，导出 `findResearchFactorDraft(userId, executionId)` 与 `createFactorDraftFromResearch(userId, input)`。前者查找并映射已有目标，后者拥有 key 分配、Factor/Composite/内置 key 冲突检查、创建与重试。input 在 Factor 定义，包含 sourceExecutionId、factorKeyBase、factorName、analysisKind、Python language/code、messages、handoff 和 locale 等明确数据；不接受 Prisma CreateInput、任意字段或生成器回调。
- 新增 `strategy/definitions/from-research.ts`，导出 `findResearchStrategyDraft(userId, executionId)` 与 `createStrategyDraftFromResearch(userId, input)`。输入为 sourceExecutionId、strategyName、code、messages、handoff；目标入口复用原 `uniqueStrategyName`，拥有默认 Python/py-v1 回测配置、创建与冲突重试。两个目标文件仅依赖本域、shared 和 infra，不导入 Research/Agent 生成实现。
- Research 原两个 create 入口、错误类型和路由契约保留，按原顺序执行目标复用查询 → 源执行成功/固化检查 → 原生成器 → handoff 元数据 → 目标创建。先命中已有草稿时不读取源执行或再次调用生成器；不把 LLM 放入新事务。
- 保留 Factor 最多 100 次尝试、32 字符与 `_2` 后缀规则，以及 Strategy 外层 50 次写入重试和现有命名策略；P2002 后先查询源执行并发胜者，未命中则继续尝试，其他错误原样抛出。保留 reused 标记、messages、来源、语言/描述、私有草稿默认值及无回测副作用；不合并普通创建/复制入口的业务差异。
- 交付包含两个目标入口及其测试、Research handoff 消费者和测试、三个模块 README、架构地图及本文。review 前执行 ESLint/格式、全仓 typecheck/生成契约/后端边界、跨域写入与调用链核对、`git diff --check`。
- review 后执行 Factor/Strategy handoff drafts 与 generation、目标定义和 Research routes 回归，补齐 key/name 冲突、P2002 源执行胜者复用、非源冲突继续尝试及非 P2002 原样失败覆盖；API 干净构建。在独立 SQLite 从源码/编译的原 Research 交接入口写入两类草稿并通过原查询入口读取，检查来源、messages、默认配置、私有状态、复用不生成及生成失败无目标残留。生成器使用受控替身，不调用真实 LLM；保持原重试与事务范围。

当前仅完成 C5 只读核对和计划，尚未修改 C5 产品代码。若实现需要改变归属校验、准入、重试上限、公开响应、数据默认值或事务范围，先讨论，不混入本提交。
