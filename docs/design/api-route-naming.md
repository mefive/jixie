# `/api/app` 资源路由设计

2026-09-10 用户确认；同日 Strategy 路由职责整理方案再次确认。本文是当前 HTTP 路径契约，替代此前以单数表示动作、复数表示 CRUD 的约定；历史迁移记录保留在 Git 与 [后端重构记录](backend-architecture-refactor.md)。

## 约定与组装

- 同一业务资源统一前缀：策略 `/strategies`，因子 `/factors`。从路径直接识别资源、对象和操作，不靠单复数区分功能。
- GET 读取、POST 创建资源或触发操作、PATCH 局部修改、DELETE 删除。发布、归档、复制、holdout 和 reveal 保留明确动作，避免伪装成普通字段更新。
- 对象归属 ID 放在路径。回测/扫描不再通过 `?strategyId=` 选择所属策略，策略/因子 Agent 和因子元数据刷新不再要求 body 的 `id`。HTTP 层以路径 ID 构造业务输入，额外 body/query ID 不能覆盖它。
- 查询条件、分页与增量日志仍在 query；分析参数、代码、消息等仍在 body。除 Strategy 活动任务与扫描寻址、Factor 相关性提交和任务查询的下述调整外，响应结构、业务状态、鉴权和持久化语义保持。
- 模块根级 `routes.ts` 是唯一对外路由入口，具名导出模块总路由。Strategy 在 `routes.ts` 直接组合 definition、agent、backtest、scan 四组处理器；Factor 在 `routes.ts` 直接组合 definition、composite、agent、analysis、correlation、weather 六组处理器。处理器按业务职责分文件实现。实现文件直接导入子路由，避免反向引用入口。
- 中间件从 `middleware.ts` 导入：`requireAuth` 与 `maintenanceGate` 不由 `routes.ts` 导出。
- 集合保留路径先注册，通用 `/:strategyId`、`/:factorId` 后注册。

```ts
import { strategyRoute } from '#strategy/routes.js';
import { factorRoute } from '#factor/routes.js';

app.route('/api/app/strategies', strategyRoute);
app.route('/api/app/factors', factorRoute);
```

以下路径均省略 `/api/app`。

## 策略

| 方法 | 路径 | 职责 |
| --- | --- | --- |
| GET / POST | `/strategies` | 策略列表 / 创建 |
| GET / PATCH / DELETE | `/strategies/:strategyId` | 读取 / 修改 / 删除定义 |
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

Strategy 路由职责整理的提交为 `refactor(strategy): clarify resource routes and route ownership`，开发记录见 [Strategy README](../../apps/api/src/strategy/README.md)。本次已通过人工代码审查、静态检查、37 项策略路由/多用户权限测试、API/Web 构建，以及策略操作、回测报告历史、参数扫描三组 E2E，覆盖 jobId/reportId 分离、任务类型隔离、活动任务空值及刷新恢复。Factor 路由不在本次调整范围。


## Factor 路由职责整理（2026-09-10）

用户已确认方案，计划提交 `refactor(factor): clarify resource routes and route ownership`。Factor 路由按定义、组合、Agent、分析、相关性、天气六组组织；元数据刷新归定义，发布异常映射由 `route-errors.ts` 共用。

普通分析（含 holdout）与相关性分别从 `/analysis-jobs/:jobId` 和 `/correlation-jobs/:jobId` 查询。两类持久化任务仍使用 `kind: factor`，查询层按报告关联与 `payload.task` 区分，并兼容缺少 task 的历史分析任务；封存的 holdout 日志不能从相关性路径读取。

相关性结果沿用缓存，不新增报告资源或 reportId。POST 返回 `{ jobId }` 或缓存命中 `{ done: true, report }`。旧 query-only POST 调用必须迁移到 JSON body；原来通过 analysis-jobs 轮询相关性的调用必须迁移到 correlation-jobs。旧 `/reports` 和 `/correlations/running` 不保留别名；API/Web 与仓内调用同步迁移。

人工代码审查、静态检查、81 项测试、API/Web 构建和四组 Factor E2E 均已通过。验证范围与实际结果记录在 [Factor README](../../apps/api/src/factor/README.md)。


## Research 路由职责整理（2026-09-11）

用户已确认方案，计划提交 `refactor(research): clarify resource routes and route ownership`。根级 `research/routes.ts` 直接组合八组具名路由，最终 36 个接口。下表路径均相对于 `/api/app/research`。

| 文件 | 方法 | 路径 |
| --- | --- | --- |
| `document-routes.ts` | GET | `/documents` |
| `document-routes.ts` | POST | `/documents` |
| `document-routes.ts` | GET | `/documents/:documentId` |
| `document-routes.ts` | POST | `/documents/:documentId/archive` |
| `document-routes.ts` | POST | `/documents/:documentId/restore` |
| `document-routes.ts` | POST | `/documents/:documentId/cells` |
| `document-routes.ts` | PATCH | `/cells/:cellId` |
| `document-routes.ts` | DELETE | `/cells/:cellId` |
| `document-routes.ts` | PATCH | `/documents/:documentId` |
| `document-routes.ts` | DELETE | `/documents/:documentId` |
| `execution-routes.ts` | POST | `/cells/:cellId/run` |
| `execution-routes.ts` | POST | `/cells/:cellId/run-affected` |
| `execution-routes.ts` | POST | `/documents/:documentId/dependency-analysis` |
| `execution-routes.ts` | POST | `/documents/:documentId/run` |
| `execution-routes.ts` | POST | `/documents/:documentId/runtime/interrupt` |
| `execution-routes.ts` | POST | `/documents/:documentId/runtime/reset` |
| `evidence-routes.ts` | GET | `/artifacts/:artifactId` |
| `evidence-routes.ts` | GET | `/documents/:documentId/executions` |
| `evidence-routes.ts` | GET | `/executions/:executionId` |
| `evidence-routes.ts` | POST | `/executions/:executionId/promote` |
| `evidence-routes.ts` | POST | `/executions/:executionId/factor-draft` |
| `evidence-routes.ts` | POST | `/executions/:executionId/strategy-draft` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/apply` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/review` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/review/accept` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/review/revert` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/reject` |
| `proposal-routes.ts` | POST | `/cell-change-proposals/:proposalId/attempts` |
| `agent-routes.ts` | POST | `/agent/turns` |
| `curator-routes.ts` | POST | `/curator/runs` |
| `curator-routes.ts` | GET | `/curator/runs/latest` |
| `curator-routes.ts` | GET | `/curator/runs/:runId` |
| `curator-routes.ts` | PATCH | `/curator/findings/:findingId` |
| `data-routes.ts` | GET | `/data-catalog` |
| `data-routes.ts` | POST | `/universe-queries` |
| `language-routes.ts` | POST | `/language/python` |

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

已通过人工代码审查、格式/ESLint、全仓 typecheck/契约一致性、147 项 Research 测试、24 项边界检查器测试、API/Web 构建和十组 E2E；另通过真实 Pyright 与股票池查询验证。验证范围和实际结果记录在 [Research README](../../apps/api/src/research/README.md)。


## 剩余模块路由整理（2026-09-11）

方案已获确认，计划提交 `refactor(api): clarify remaining resource routes and ownership`。Signals / Agent / Market 根级 routes.ts 直接组合职责路由；Sharing 仅明确 strategyId 参数名；Auth / Maintenance 及健康检查保持现状。剩余六模块最终 33 个接口，含一个开发专用登录接口，另有两个根级服务接口。

以下是全部终局路径，已整理的 Strategy / Factor / Research 见前文。

| 模块 | 文件 | 方法 | 完整路径 |
| --- | --- | --- | --- |
| signals | `deployment-routes.ts` | GET | `/api/app/signals/deployments/latest-runs` |
| signals | `deployment-routes.ts` | GET | `/api/app/signals/deployments` |
| signals | `deployment-routes.ts` | POST | `/api/app/signals/deployments` |
| signals | `deployment-routes.ts` | POST | `/api/app/signals/deployments/:deploymentId/pause` |
| signals | `execution-routes.ts` | GET | `/api/app/signals/deployments/:deploymentId/execution-overview` |
| signals | `execution-routes.ts` | PATCH | `/api/app/signals/executions/:executionId` |
| signals | `run-routes.ts` | GET | `/api/app/signals/deployments/:deploymentId/runs` |
| signals | `run-routes.ts` | GET | `/api/app/signals/runs/:runId` |
| signals | `run-routes.ts` | POST | `/api/app/signals/deployments/:deploymentId/runs` |
| signals | `run-routes.ts` | GET | `/api/app/signals/run-jobs/:jobId` |
| agent | `chart-routes.ts` | POST | `/api/app/agent/sql-queries` |
| agent | `chart-routes.ts` | POST | `/api/app/agent/chart-computations` |
| agent | `conversation-routes.ts` | GET | `/api/app/agent/conversations/:conversationId/messages` |
| agent | `turn-routes.ts` | GET | `/api/app/agent/turns/active` |
| agent | `turn-routes.ts` | GET | `/api/app/agent/turns/:turnId` |
| agent | `turn-routes.ts` | GET | `/api/app/agent/turns/:turnId/stream` |
| agent | `turn-routes.ts` | POST | `/api/app/agent/turns/:turnId/cancel` |
| market | `instrument-routes.ts` | GET | `/api/app/market/instruments/names` |
| market | `instrument-routes.ts` | GET | `/api/app/market/instruments/:assetType/:instrumentId/series` |
| market | `instrument-routes.ts` | GET | `/api/app/market/indices/:indexCode/series` |
| market | `state-routes.ts` | GET | `/api/app/market/weather` |
| market | `state-routes.ts` | GET | `/api/app/market/state` |
| market | `valuation-routes.ts` | GET | `/api/app/market/index-valuations` |
| market | `valuation-routes.ts` | GET | `/api/app/market/index-valuations/:indexCode` |
| sharing | `routes.ts` | GET | `/api/app/library` |
| sharing | `routes.ts` | GET | `/api/app/library/strategies/:strategyId` |
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
