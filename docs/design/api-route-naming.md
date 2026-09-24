# `/api/app` 资源路由设计

> 2026-09-24 更新：未被现有产品调用的 HTTP 入口及专用依赖已清理，详见 [清理记录](unused-http-endpoints.md)。下文涉及已退役入口的旧设计与验收记录保留为历史，不表示现行接口。

2026-09-10 用户确认；同日 Strategy 路由职责整理方案再次确认。本文是当前 HTTP 路径契约，替代此前以单数表示动作、复数表示 CRUD 的约定；历史迁移记录保留在 Git 与 [后端重构记录](backend-architecture-refactor.md)。

## 约定与组装

- 同一业务资源统一前缀：策略 `/strategies`，因子 `/factors`。从路径直接识别资源、对象和操作，不靠单复数区分功能。
- GET 读取、POST 创建资源或触发操作、PATCH 局部修改、DELETE 删除。发布、归档、复制、holdout 和 reveal 保留明确动作，避免伪装成普通字段更新。
- 对象归属 ID 放在路径。回测/扫描不再通过 `?strategyId=` 选择所属策略，策略/因子 Agent 和因子元数据刷新不再要求 body 的 `id`。HTTP 层以路径 ID 构造业务输入，额外 body/query ID 不能覆盖它。
- 查询条件、分页与增量日志仍在 query；分析参数、代码、消息等仍在 body。除 Strategy 活动任务与扫描寻址、Factor 相关性提交和任务查询的下述调整外，响应结构、业务状态、鉴权和持久化语义保持。
- 多组路由模块的 `routes/index.ts` 是唯一对外路由入口，具名导出模块总路由。Strategy 在 `routes/index.ts` 直接组合 definition、agent、backtest、scan 四组处理器；Factor 在 `routes/index.ts` 直接组合 definition、composite、agent、analysis、correlation、weather 六组处理器。多组处理器按业务职责放在模块的 `routes/` 中，文件名省略 `-routes` 后缀；共用 HTTP 错误映射放在 `routes/errors.ts`。实现文件直接导入子路由，避免反向引用入口；单文件模块可继续使用根级 `routes.ts`。
- 中间件从 `middleware.ts` 导入：`requireAuth` 与 `maintenanceGate` 不由路由总入口导出。
- 集合保留路径先注册，通用 `/:strategyId`、`/:factorId` 后注册。

```ts
import { strategyRoute } from '#strategy/routes/index.js';
import { factorRoute } from '#factor/routes/index.js';

app.route('/api/app/strategies', strategyRoute);
app.route('/api/app/factors', factorRoute);
```

以下路径均省略 `/api/app`。

## 策略

| 方法 | 路径 | 职责 |
| --- | --- | --- |
| GET / POST | `/strategies` | 策略列表 / 创建 |
| GET / DELETE | `/strategies/:strategyId` | 读取 / 删除定义 |
| PATCH | `/strategies/:strategyId/visibility` | 修改可见性 |
| POST | `/strategies/:strategyId/agent/turns` | 启动策略 Agent 对话 |
| POST | `/strategies/:strategyId/backtests` | 保存配置并提交回测 |
| GET | `/strategies/:strategyId/backtest-reports` | 成功且有结果的历史回测报告 |
| GET | `/strategies/backtest-reports/:reportId` | 读取持久化回测报告 |
| GET | `/strategies/:strategyId/backtest-jobs/active` | 查找 queued/running 回测任务 |
| GET | `/strategies/backtest-jobs/:jobId` | 查询回测任务状态及日志，保留 `since` |
| POST | `/strategies/:strategyId/scans` | 提交扫描，不覆盖当前草稿 |
| GET | `/strategies/:strategyId/scan-reports` | 各状态扫描报告，最多 50 条 |
| GET | `/strategies/scan-reports/:reportId` | 读取扫描报告 |
| GET | `/strategies/:strategyId/scan-jobs/active` | 查找 queued/running 扫描任务 |
| GET | `/strategies/scan-jobs/:jobId` | 查询扫描任务状态及日志，保留 `since` |
| POST | `/strategies/scan-parameters/inspect` | 检查代码可扫描参数，不要求已保存策略 |

Strategy 是当前可编辑策略，Report 保存一次计算的冻结输入、状态与结果，Job 表达后台执行状态和日志。提交回测与扫描均返回 `{ jobId: string, reportId: string }`，保留原有 config/spec body；活动任务查询均返回该引用或 JSON `null`，`active` 包含 queued 和 running。查询用户没有对应资源时，列表返回空数组、活动查询返回 null，单个报告/任务详情返回 404。

报告列表与详情使用同一资源名；任务只能用 jobId 查询，检查 userId 和任务类型（backtest / strategy-scan）。日志仍按 `since` 返回增量 `logs` 和 `nextSince`。Web 使用提交或活动查询返回的 jobId 轮询，使用 reportId 读取结果。扫描报告详情仍携带 jobId。

移除独立名称建议接口 `/strategies/name-suggestions`。创建策略及配置提交仍使用内部命名能力；命名失败时创建策略保留默认名称回退。参数检查保留独立代码输入，不要求 strategyId。

## 因子

| 方法 | 路径 | 职责 |
| --- | --- | --- |
| GET / POST | `/factors` | 自定义因子列表 / 创建草稿 |
| GET / PATCH / DELETE | `/factors/:factorId` | 读取 / 修改 / 删除定义 |
| POST | `/factors/:factorId/publish` | 发布经报告验证的因子 |
| POST | `/factors/:factorId/archive` | 归档 |
| POST | `/factors/:factorId/copy` | 复制为新草稿 |
| PATCH | `/factors/:factorId/visibility` | 修改可见性 |
| GET | `/factors/catalog` | 可选因子目录，包含预置、模板、自定义与组合来源 |
| POST | `/factors/composites` | 创建组合 |
| GET / PATCH / DELETE | `/factors/composites/:compositeId` | 读取 / 修改 / 删除组合 |
| POST | `/factors/composites/:compositeId/publish` | 发布组合 |
| POST | `/factors/composites/:compositeId/archive` | 归档组合 |
| POST | `/factors/composites/:compositeId/copy` | 复制组合 |
| PATCH | `/factors/composites/:compositeId/visibility` | 修改组合可见性 |
| POST | `/factors/:factorId/agent/turns` | 启动因子编辑对话 |
| POST | `/factors/:factorId/metadata/refresh` | 刷新代码元数据 |
| POST | `/factors/questions` | 因子问答，无需持久化因子 ID |
| POST | `/factors/analyses` | 提交分析 |
| GET | `/factors/analysis-reports` | 按 `factor` 来源筛选报告，保留分页参数 |
| GET | `/factors/analysis-reports/:reportId` | 读取报告 |
| POST | `/factors/analysis-reports/:reportId/holdout` | 发起留出集验证 |
| POST | `/factors/analysis-reports/:reportId/reveal` | 揭示留出集报告 |
| GET | `/factors/analysis-jobs/:jobId` | 查询分析任务，保留 `since` |
| GET / POST | `/factors/correlations` | 查询 / 提交相关性分析 |
| GET | `/factors/correlation-jobs/active` | 查找 queued/running 相关性任务，返回 `{ jobId }` 或 null |
| GET | `/factors/correlation-jobs/:jobId` | 查询相关性任务状态与增量日志，保留 `since` |
| GET | `/factors/research/window` | 研究窗口与留出集规则 |
| GET | `/factors/research/summary` | 研究概况，保留可选 `factor` 查询 |
| GET | `/factors/weather` | 因子天气 |
| POST | `/factors/weather/pins` | 固定因子 |
| POST | `/factors/weather/pins/:pinId/refresh` | 刷新固定项 |
| DELETE | `/factors/weather/pins/:pinId` | 取消固定 |

分析来源可能是预置、模板、自定义或组合，继续由 body 的 `factor` 指定，不强行挂到自定义因子 ID 下。相关性分析涉及多个因子：GET 结果和活动任务查询使用 query 的 `keys`（逗号分隔）、`freq`、`start`、`end`；POST 提交使用 JSON body 的 `keys`（字符串数组）、`freq`、`start`、`end`、`refresh`（布尔值，默认 false）。频率和区间默认值仍为 month / 20150101 / 20261231。天气固定项使用 pinId，与其引用的 factorId 区分。

## 迁移对照

| 旧路径/方法 | 新路径/方法 |
| --- | --- |
| `POST /strategies/:id`、`POST /strategies/:id/visibility` | 对应路径改用 PATCH |
| `POST /strategy/agent` | `POST /strategies/:strategyId/agent/turns`，ID 从 body 移到路径 |
| `POST /strategy/name`、`POST /strategies/name-suggestions` | 删除；创建策略时内部命名 |
| `POST /strategy/backtest?strategyId=...` | `POST /strategies/:strategyId/backtests` |
| `GET /strategy/backtest/reports?strategyId=...`、`GET /strategies/:strategyId/backtests` | `GET /strategies/:strategyId/backtest-reports` |
| `GET /strategy/backtest/running?strategyId=...`、`GET /strategies/:strategyId/backtests/running` | `GET /strategies/:strategyId/backtest-jobs/active`；返回 `{ jobId, reportId }` 或 null |
| `GET /strategy/backtest/reports/:reportId` | `GET /strategies/backtest-reports/:reportId` |
| `GET /strategy/backtest/:jobId` | `GET /strategies/backtest-jobs/:jobId` |
| `POST /strategy/scans/parameters` | `POST /strategies/scan-parameters/inspect` |
| `POST /strategy/scans?strategyId=...` | `POST /strategies/:strategyId/scans` |
| `GET /strategy/scans?strategyId=...`、`GET /strategies/:strategyId/scans` | `GET /strategies/:strategyId/scan-reports` |
| `GET /strategy/scans/running?strategyId=...`、`GET /strategies/:strategyId/scans/running` | `GET /strategies/:strategyId/scan-jobs/active`；返回 `{ jobId, reportId }` 或 null |
| `GET /strategy/scans/:reportId` | `GET /strategies/scan-reports/:reportId` |
| `GET /strategy/scans/:reportId/job`、`GET /strategies/scan-reports/:reportId/job` | `GET /strategies/scan-jobs/:jobId`；jobId 从提交、活动查询或报告详情获取 |
| `/factors/custom[/... ]` | `/factors[/... ]`，修改定义和可见性改 PATCH |
| `POST /factors/composites/:id[/visibility]` | 对应路径改用 PATCH |
| `POST /factor/agent`、`POST /factor/metadata` | `/factors/:factorId/agent/turns`、`/factors/:factorId/metadata/refresh`，ID 从 body 移到路径 |
| `POST /factor/qa` | `POST /factors/questions` |
| `POST /factor/analysis/run` | `POST /factors/analyses` |
| `GET /factor/analysis/job/:jobId` | `GET /factors/analysis-jobs/:jobId` |
| `/factor/reports...`、`/factors/reports...` | 对应 `/factors/analysis-reports...` |
| `/factor/research...` | 对应 `/factors/research...` |
| `GET /factor/correlation`、`POST /factor/correlation/run` | `GET / POST /factors/correlations` |
| `GET /factor/correlation/running`、`GET /factors/correlations/running` | `GET /factors/correlation-jobs/active` |
| `/factor-weather...` | `/factors/weather...` |

这次同步迁移后端、Web client、测试及 E2E，不提供旧路径别名。已有打开的旧前端需要刷新；外部或本地自建 HTTP 调用方需要按上表更新。发布时 API 与 Web 应一起更新。

Auth、Maintenance、Agent、Market、Research、Signals、Library 的 HTTP 路径，以及前端页面、共享类型、Prisma schema、SDK 和研究方法不在此次迁移范围。公开帮助没有新增用户操作或能力，无需变更中英 UI 文案。

## 验证

初次资源前缀迁移的验证范围：代码 review 前只运行格式、lint、类型与后端边界静态检查。Review 后执行策略/因子路由集成测试、回测路由与多用户权限测试、API/Web 构建，以及回测报告历史和因子天气 E2E。重点覆盖集合路径与动态 ID 匹配、PATCH 约定、路径 ID 不被 body/query 覆盖、报告归属及封存保护、前端请求与轮询迁移。

### Strategy 路由职责整理验收（2026-09-10）

以下记录迁移当时的范围与结果；Factor 路由不属于该次提交。

提交：`refactor(strategy): clarify resource routes and route ownership`。

完成范围：五个路由文件、显式报告列表与活动任务路径、扫描按 jobId 轮询、任务类型隔离、删除独立命名接口，并同步 Web client、Lab、现有 E2E 调用和架构约定。无 Prisma schema、数据迁移、引擎或 SDK 变更；不保留旧 URL 别名，API/Web 需同步更新。

新增路由集成覆盖：两类任务的 queued/running/终态活动查询、空值契约、跨用户和跨任务类型拒绝、reportId 不可用于任务查询、since 增量日志、报告列表状态语义、旧路径移除及创建时命名失败回退。

人工代码审查已通过。静态检查全部通过：变更代码的 Prettier、ESLint，根级 `pnpm typecheck`（包括全部 workspace 类型、Research/Factor SDK 与运行时生成物一致性、后端边界检查：637 files，0 violations），以及 `git diff --check`。

行为验证结果：

- 策略路由集成测试 28 项、回测路由测试 3 项、多用户权限测试 6 项，共 37 项全部通过。
- API `tsc` 与 Web 生产构建均通过；Web 构建保留大 chunk 提示，无构建错误。
- 策略操作 E2E：创建、回测提交、重复提交拒绝、结果保存与刷新恢复通过。
- 回测历史 E2E：历史报告选择、结果对比、Research 交接保留指定 reportId 通过。
- 参数扫描 E2E：4 个参数组合、3 个仓位方案、3 个资金规模，以及扫描刷新恢复全部通过。

E2E 使用编译后的 API 与 Web 预览服务及独立 SQLite 副本。两类刷新恢复通过一次受控的活动任务响应复现“活动查询后计算恰好完成”，随后读取真实任务及报告；真实活动查询的状态与权限由 SQLite 集成测试覆盖。截图 `backtest-report-comparison.png`、`research-backtest-report-handoff.png`、`strategy-scan-reconnect.png`、`strategy-parameter-scan.png` 保存在 `apps/web/acceptance/`，已逐张检查。

临时 API/Web 服务已关闭，3107/5187 监听和数据库连接已释放，隔离数据库副本已删除。原开发数据库未修改。


## Factor 路由职责整理（2026-09-10）

用户已确认方案，计划提交 `refactor(factor): clarify resource routes and route ownership`。Factor 路由按定义、组合、Agent、分析、相关性、天气六组组织；元数据刷新归定义，发布异常映射由 `routes/errors.ts` 共用。

普通分析（含 holdout）与相关性分别从 `/analysis-jobs/:jobId` 和 `/correlation-jobs/:jobId` 查询。**迁移当时**两类持久化任务使用 `kind: factor`，查询层按报告关联与 `payload.task` 区分，并兼容缺少 task 的历史分析任务。该存储方式后来已由独立 kind 替代，当前查询与部署转换见 [Factor jobs](../../apps/api/src/factor/jobs/README.md)；封存的 holdout 日志仍不能从相关性路径读取。

相关性结果沿用缓存，不新增报告资源或 reportId。POST 返回 `{ jobId }` 或缓存命中 `{ done: true, report }`。旧 query-only POST 调用必须迁移到 JSON body；原来通过 analysis-jobs 轮询相关性的调用必须迁移到 correlation-jobs。旧 `/reports` 和 `/correlations/running` 不保留别名；API/Web 与仓内调用同步迁移。

### 当时的实施与验收

提交：`refactor(factor): clarify resource routes and route ownership`。

完成范围：七个路由文件、37 个 HTTP 接口、显式 analysis-reports 路径、相关性专用任务查询与 JSON 提交、任务隔离和历史任务兼容；同步 Web client、Factor store、仓内 E2E 调用及架构约定。没有 Prisma schema、数据迁移、SDK、分析算法或发布准入变更；天气恢复刷新机制保持。旧路径不提供别名，API/Web 需同步更新。用户页面操作和指标未改变，公开帮助、SDK 参考与双语 UI 文案不需要更新。

人工代码审查已通过。静态检查通过：格式、改动文件 ESLint、全仓 `pnpm typecheck`（包含生成契约一致性与后端边界检查，640 个文件、0 违规）及 `git diff --check`。

审查后验证通过：8 个测试文件、81 项测试（含 32 项路由集成测试，以及 publication、composition、reports、weather refresh、analysis-job），API/Web 构建，以及 factor-report-history、factor-composite、factor-weather 和新增 factor-correlation 四组 E2E。Web 构建仅有既有大 chunk 提示。

相关性 E2E 验证真实 JSON 提交、任务轮询、缓存命中，并用一次受控活动查询响应模拟任务完成后的重连；天气 E2E 沿用既有 HTTP fixtures，业务权限与刷新由路由集成测试覆盖。验证期间只修正相关性测试的标签切换、因子键搜索和多层 canvas 定位，未修改已审查的产品代码。验收截图已检查；独立数据库快照、临时 API/Web 服务及连接已清理。


## Research 路由职责整理（2026-09-11）

用户已确认方案，计划提交 `refactor(research): clarify resource routes and route ownership`。当时 `research/routes/index.ts` 组合八组具名路由、36 个接口。下表记录该次整理范围，路径均相对于 `/api/app/research`；后续新增嵌入分析及接续入口见 [Research embedded](../../apps/api/src/research/embedded/README.md) 和 [其设计记录](embedded-python-analysis.md)。

| 文件 | 方法 | 路径 |
| --- | --- | --- |
| `routes/document.ts` | GET | `/documents` |
| `routes/document.ts` | POST | `/documents` |
| `routes/document.ts` | GET | `/documents/:documentId` |
| `routes/document.ts` | POST | `/documents/:documentId/archive` |
| `routes/document.ts` | POST | `/documents/:documentId/restore` |
| `routes/document.ts` | POST | `/documents/:documentId/cells` |
| `routes/document.ts` | PATCH | `/cells/:cellId` |
| `routes/document.ts` | DELETE | `/cells/:cellId` |
| `routes/document.ts` | PATCH | `/documents/:documentId` |
| `routes/document.ts` | DELETE | `/documents/:documentId` |
| `routes/execution.ts` | POST | `/cells/:cellId/run` |
| `routes/execution.ts` | POST | `/cells/:cellId/run-affected` |
| `routes/execution.ts` | POST | `/documents/:documentId/run` |
| `routes/execution.ts` | POST | `/documents/:documentId/runtime/interrupt` |
| `routes/execution.ts` | POST | `/documents/:documentId/runtime/reset` |
| `routes/evidence.ts` | GET | `/artifacts/:artifactId` |
| `routes/evidence.ts` | GET | `/documents/:documentId/executions` |
| `routes/evidence.ts` | GET | `/executions/:executionId` |
| `routes/evidence.ts` | POST | `/executions/:executionId/promote` |
| `routes/evidence.ts` | POST | `/executions/:executionId/factor-draft` |
| `routes/evidence.ts` | POST | `/executions/:executionId/strategy-draft` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/apply` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/review` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/review/accept` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/review/revert` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/reject` |
| `routes/proposal.ts` | POST | `/cell-change-proposals/:proposalId/attempts` |
| `routes/agent.ts` | POST | `/agent/turns` |
| `routes/curator.ts` | POST | `/curator/runs` |
| `routes/curator.ts` | GET | `/curator/runs/latest` |
| `routes/curator.ts` | GET | `/curator/runs/:runId` |
| `routes/curator.ts` | PATCH | `/curator/findings/:findingId` |
| `routes/data.ts` | GET | `/data-catalog` |
| `routes/data.ts` | POST | `/universe-queries` |
| `routes/language.ts` | POST | `/language/python` |

创建入口统一为 `POST /documents`，body 使用互斥的 `{ template }` 或 `{ source: { type: 'backtest-report', reportId } }`；模板枚举与 blank 默认值不变。PATCH document 仍接收 `{ title }`；review/accept、review/revert 保留 `{ expectedContentRevision }`；全文运行保留 `{ clean }`。Agent 使用 `/agent/turns`，保留原 body 和 `{ conversationId, turnId }` 返回。

| 旧接口 | 新接口 |
| --- | --- |
| `GET /conversations` | 删除，统一使用 `GET /documents`（文档摘要） |
| `PATCH / DELETE /conversations/:id` | `PATCH / DELETE /documents/:documentId` |
| `POST /documents/from-backtest-report/:reportId` | `POST /documents`，来源放入 body |
| `POST /documents/:documentId/analyze` | `POST /documents/:documentId/dependency-analysis` |
| `POST /documents/:documentId/interrupt` | `POST /documents/:documentId/runtime/interrupt` |
| `POST /documents/:documentId/reset` | `POST /documents/:documentId/runtime/reset` |
| `POST /cell-change-proposals/:proposalId/apply-for-review` | `POST /cell-change-proposals/:proposalId/review` |
| `POST /cell-change-proposals/:proposalId/accept-review` | `POST /cell-change-proposals/:proposalId/review/accept` |
| `POST /cell-change-proposals/:proposalId/revert-review` | `POST /cell-change-proposals/:proposalId/review/revert` |
| `POST /cell-change-proposals/:proposalId/run-affected` | `POST /cell-change-proposals/:proposalId/attempts` |
| `POST /agent` | `POST /agent/turns` |
| `POST /universe/run` | `POST /universe-queries` |
| `POST /language` | `POST /language/python` |

Research 的 Cell/全文/尝试请求等待执行结果；完整 execution 是冻结证据，单 Cell 或局部执行不强行统一为这种资源。股票池查询直接返回结果，语言服务仍按 action 分派。Curator 保留独立 Run 和后台 Job，四个接口不变。所有重命名接口同步 Web 与仓内调用，旧路径不留别名；不改变数据库、SDK、锁/事务边界、执行协议或 Curator 用途。

### 当时的实施与验收

同步 Web client/store、仓内 E2E 请求及架构约定。旧路径不保留兼容别名，API/Web 必须同步部署。无 Prisma schema、数据迁移、SDK、分析算法或 Curator 产品能力调整；用户页面操作未变，帮助内容与双语 UI 文案无需调整。

审查前静态检查已通过：改动文件格式与 ESLint、全仓 `pnpm typecheck`、生成契约一致性、后端边界检查（648 个文件、0 违规），以及 `git diff --check`。静态核对确认 36 组方法/路径无重复；Curator、证据交接、Agent、数据和语言服务 handler 除已批准路径外与原实现一致。

边界检查器将业务模块 `routes/index.ts` 和 `routes/` 目录识别为 HTTP 适配，包含 `research/routes/errors.ts`，与 Factor/Strategy 同规则；仍禁止业务反向导入 HTTP、禁止 HTTP 直接访问数据库，并补充相应检查器测试。

审查后执行 `pnpm test:backend-boundaries`，以及 Research 路由集成、documents、execution/lifecycle、dependencies、proposals、evidence、handoff、language、curator 与 universe 相关测试，API/Web 构建；浏览器覆盖文档管理、执行/冻结、下游运行、中断、提案审阅/尝试、Agent Cell 上下文、图片、语言服务、Curator 和回测报告交接。涉及 LLM 的交互采用受控 fixture；实际 Python/数据库流程使用隔离环境，不调用真实 LLM 或执行供应商同步。

人工代码审查后验证全部通过：

- Research 22 个测试文件、147 项测试通过，其中路由集成 43 项；覆盖文档来源/归属、历史补建、归档/删除级联、运行锁、提案审阅、语言请求和旧路径 404。边界检查器 24 项测试通过。
- API/Web 构建通过；Web 仅有既有的大 chunk 提示。
- 十组 E2E 通过：document-management、execution、affected-run、interrupt、cell-change-proposal、cell-change-review、agent-cell-context、matplotlib、curator、backtest-report-history。覆盖执行快照不可变与固化、取消、提案尝试对比、开放审阅阻止运行、连续修改/接受/撤销、Agent Cell 上下文、图片权限、中英 Curator 与报告来源创建。
- 编译 API 的 `language/python` 通过真实 Pyright pandas 补全和错误诊断，`universe-queries` 返回股票池实际结果，data-catalog 查询通过。九组 E2E 使用构建后的 Web；提案审阅使用 Vite 开发模式，以读取既有开发专用 Monaco 测试钩子。
- 首轮发现并修正两处测试脚本问题：旧 GET 路径用例误传请求体、Curator 关闭按钮定位不唯一。修正文件格式、ESLint 与 API typecheck 通过，相关测试重跑通过；没有测试后产品代码修改。
- 数据库使用开发数据的只读备份副本，真实 Python 查询仅访问副本；未调用真实 LLM 或供应商同步。API、Web preview、Vite 临时进程已关闭，3107/5187/5188 端口和数据库连接已释放，数据库副本已删除。验收截图已检查，保留于 `apps/web/acceptance/`。


## 剩余模块路由整理（2026-09-11）

方案已获确认，计划提交 `refactor(api): clarify remaining resource routes and ownership`。Signals / Agent / Market 的 routes/index.ts 直接组合职责路由；Sharing 仅明确 strategyId 参数名；Auth / Maintenance 及健康检查保持现状。剩余六模块最终 33 个接口，含一个开发专用登录接口，另有两个根级服务接口。

以下是全部终局路径，已整理的 Strategy / Factor / Research 见前文。

| 模块 | 文件 | 方法 | 完整路径 |
| --- | --- | --- | --- |
| signals | `routes/deployment.ts` | GET | `/api/app/signals/deployments/latest-runs` |
| signals | `routes/deployment.ts` | GET | `/api/app/signals/deployments` |
| signals | `routes/deployment.ts` | POST | `/api/app/signals/deployments` |
| signals | `routes/deployment.ts` | POST | `/api/app/signals/deployments/:deploymentId/pause` |
| signals | `routes/execution.ts` | GET | `/api/app/signals/deployments/:deploymentId/execution-overview` |
| signals | `routes/execution.ts` | PATCH | `/api/app/signals/executions/:executionId` |
| signals | `routes/run.ts` | GET | `/api/app/signals/deployments/:deploymentId/runs` |
| signals | `routes/run.ts` | POST | `/api/app/signals/deployments/:deploymentId/runs` |
| signals | `routes/run.ts` | GET | `/api/app/signals/run-jobs/:jobId` |
| agent | `routes/chart.ts` | POST | `/api/app/agent/sql-queries` |
| agent | `routes/chart.ts` | POST | `/api/app/agent/chart-computations` |
| agent | `routes/turn.ts` | GET | `/api/app/agent/turns/active` |
| agent | `routes/turn.ts` | GET | `/api/app/agent/turns/:turnId` |
| agent | `routes/turn.ts` | GET | `/api/app/agent/turns/:turnId/stream` |
| agent | `routes/turn.ts` | POST | `/api/app/agent/turns/:turnId/cancel` |
| market | `routes/instrument.ts` | GET | `/api/app/market/instruments/names` |
| market | `routes/instrument.ts` | GET | `/api/app/market/instruments/:assetType/:instrumentId/series` |
| market | `routes/instrument.ts` | GET | `/api/app/market/indices/:indexCode/series` |
| market | `routes/state.ts` | GET | `/api/app/market/weather` |
| market | `routes/valuation.ts` | GET | `/api/app/market/index-valuations` |
| market | `routes/valuation.ts` | GET | `/api/app/market/index-valuations/:indexCode` |
| sharing | `routes.ts` | GET | `/api/app/library` |
| sharing | `routes.ts` | POST | `/api/app/library/strategies/:strategyId/copy` |
| auth | `routes.ts` | GET | `/api/auth/me` |
| auth | `routes.ts` | POST | `/api/auth/logout` |
| auth | `routes.ts` | POST | `/api/auth/email/request` |
| auth | `routes.ts` | POST | `/api/auth/email/verify` |
| auth | `routes.ts` | POST | `/api/auth/dev/login` |
| maintenance | `routes.ts` | GET | `/api/maintenance/status` |
| server | `server.ts` | GET | `/` |
| server | `server.ts` | GET | `/api/health` |

Auth 的 `/dev/login` 仅在非 production 环境注册。Agent 的 stream 另外保留非 GET 请求的错误兜底，不视为独立业务 API。

| 旧接口（省略 `/api/app`） | 新接口或处理 |
| --- | --- |
| `GET /signals/today` | `GET /signals/deployments/latest-runs`；返回每个部署及最新运行，不做今日过滤 |
| `GET /signals/runs?deploymentId=&limit=` | `GET /signals/deployments/:deploymentId/runs?limit=` |
| `POST /signals/run` | `POST /signals/deployments/:deploymentId/runs`；body 只需可选 tradeDate |
| `GET /signals/jobs/:jobId` | `GET /signals/run-jobs/:jobId`；增加 signal 类型校验 |
| `GET /agent/conversations` | 删除闲置列表入口与专用列表函数，保留消息和历史存储 |
| `GET /agent/turns/:turnId/detail` | `GET /agent/turns/:turnId` |
| `GET /agent/turns/running?entity=` | `GET /agent/turns/active?entity=` |
| `POST /agent/sql` | `POST /agent/sql-queries` |
| `POST /agent/chart/compute` | `POST /agent/chart-computations` |
| `GET /market/names?codes=` | `GET /market/instruments/names?codes=` |
| `GET /market/objects/:assetType/:id/series` | `GET /market/instruments/:assetType/:instrumentId/series` |
| `GET /market/indices/valuation/catalog` | `GET /market/index-valuations` |
| `GET /market/indices/:code/valuation` | `GET /market/index-valuations/:indexCode` |
| `GET /market/futures/:code/series` | 删除闲置专用 HTTP、loader 与 client；使用统一 instrument 查询 |
| `GET /market/industry-weather` | 删除旧 HTTP；内部行业天气计算继续供 `/market/weather?dimension=industry` 使用 |

Signals 路径中的 deploymentId 是运行归属的唯一 HTTP 来源，额外 body/query ID 不得覆盖它。部署列表保留 strategyId 筛选；运行仍返回 `{ runId, jobId, started }`，失败重试复用 Run 并创建新 Job；任务保留 since 增量日志、nextSince 与既有响应结构，其他类型或其他用户的 Job 返回 404。最新运行聚合保留暂停部署和 null 运行。

Agent 活动查询保留 `{ turnId: string | null }`，Turn 不接入通用 Job。SSE 的快照、结束帧、取消及 stream 非 GET 错误行为保留。SQL / 计算图表直接返回行数据，不新增持久化资源或 LLM 调用。

Market 保留精简指数收盘序列接口，其响应、日期默认值和空数据行为不合并进统一 instrument 查询；估值大小写规范化、天气缓存和各类数据口径保持。非法证券类型使用现有 i18n 机制提供中英错误。Sharing 只修改参数标识，公开库 URL 与响应不变。

全部仓内 client / E2E 同步迁移；不提供旧路径别名，API/Web 必须同步部署。没有 Prisma schema、SDK、数据迁移、交易算法、队列/Worker、会计或 Agent 执行协议改动。页面操作保持原样，无需重写公开帮助；HTTP 错误新增中英 key 已同步。

### 审查与验证记录

本轮已通过人工代码审查。审查前静态检查已通过：34 个代码文件的 Prettier / ESLint、全仓 `pnpm typecheck`、Research runtime / Research SDK / Factor SDK 生成契约一致性、后端边界检查（656 个文件、2361 条运行时边、568 条类型边、0 违规、0 跨域循环），以及 `git diff --check`。

静态扫描核对 Signals / Agent / Market 共 24 个业务方法/路径无重复，另有一条 SSE 非 GET 兜底。对重组前后 handler 做 TypeScript token 对比：批准的路径/参数标识归一化后，21 个 handler（含 SSE 兜底）主体一致；其余四处对应运行列表/提交从路径取 ID、Signal Job 查询入口和 instrument ID/i18n 调整。旧路径仅保留在迁移说明与明确的 404 回归用例中；前端页面 `/objects/...` 属于页面导航，按原约定保留。

已准备 Signals 路由的 path/body/query 归属、Job 类型/用户隔离和日志增量测试，Agent 消息/Turn/SSE/SQL/计算图表及旧路径测试，Market 连续/直接期货行情、估值、日期默认值、双语错误和旧路径测试。既有部署冻结、重试、账户结算、共享资源权限测试继续保留。

审查通过后运行 Signals / Agent / Market / Sharing 相关测试与 API/Web 构建，使用隔离数据库执行报告部署/每日信号、图表重绘、市场行情与估值、Agent 活动恢复及 SSE 验证；涉及模型时使用受控 fixture。验证结束清理临时服务、端口、数据库副本和连接，检查并展示 E2E 截图，全部通过后按计划信息提交。


人工代码审查后验证结果：

- 16 个相关测试文件、116 项测试全部通过。首轮 115 项通过，默认关闭的账户数据库流随后使用独立空 SQLite 和 `ACCOUNTING_INTEGRATION=1` 显式运行并通过。覆盖 Signals 部署冻结/归属、运行幂等/重试、路径 ID、signal Job 类型及增量日志、账户初始化/结算/人工成交；Agent 消息/Turn/SSE/取消/SQL/图表；Market 序列/估值/i18n；Sharing 权限与复制。
- API 与 Web 构建通过，Web 仅有既有大 chunk 提示。
- 六组浏览器验收通过：report-deployments、daily-signals、computed-chart、public-library、market-valuation，以及 instrument 页面专项验证。使用编译 API/Web 和独立数据库副本，真实回测/Signal Worker、SQL/计算图表读取及股票/ETF/指数/连续期货图表成功；市场四维天气和估值选择/历史图表成功。Agent 活动查询空值经浏览器验证，活动恢复与 SSE 快照/终态/归属由路由集成测试覆盖。
- 市场截图脚本原来假设每个配置指数在最新月份都有数据；副本实际覆盖规模 9/10、板块 7/8、风格 11/16。仅修正测试：保留固定配置分组/数量断言，并逐项检查 API 最新周期返回的全部卡片按顺序展示。格式/ESLint 和该 E2E 重跑通过，未修改产品代码或伪造行情补齐数量。
- 测试数据库为开发数据库的只读备份副本和账户专项空库，未写开发数据库，未调用真实 LLM、行情同步或邮件。所有浏览器已关闭，API/Web 进程已退出，3107/5187 端口和数据库连接已释放，两个临时数据库均已删除。
- 本次截图已检查，保存于 `apps/web/acceptance/`；市场帮助截图通过临时运行副本定向输出到 acceptance，未覆盖公开帮助图片。提交前 `git diff --check` 通过。
