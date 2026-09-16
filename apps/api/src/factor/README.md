# Factor 后端阅读地图

Factor 负责因子从定义、分析到发布与持续观察的完整业务。Research 可以生成因子草稿或读取报告，Strategy 按现有发布规则消费因子；Agent 提供编辑与问答能力，因子的归属、状态和准入仍由 Factor 决定。

## 从产品操作找入口

| 要理解或修改的行为 | HTTP 入口 | 业务入口 |
| --- | --- | --- |
| 因子目录、自定义因子详情 | [routes/definition.ts](routes/definition.ts) | [definitions/catalog.ts](definitions/catalog.ts)、[definitions/read.ts](definitions/read.ts) |
| 创建、编辑、删除、复制草稿 | 同上 | [definitions/drafts.ts](definitions/drafts.ts)；输入定义在 [schema.ts](schema.ts) |
| 发布、归档、公开范围 | [routes/definition.ts](routes/definition.ts)、[routes/composite.ts](routes/composite.ts) | [publication/factor.ts](publication/factor.ts)、[publication/panel-composite.ts](publication/panel-composite.ts)、[publication/visibility.ts](publication/visibility.ts) |
| 创建、编辑、复制因子组合 | [routes/composite.ts](routes/composite.ts) | [composition/operations.ts](composition/operations.ts) |
| Agent 编辑、只读因子问答 | [routes/agent.ts](routes/agent.ts) | [agent/turn.ts](agent/turn.ts)、[questions/conversations.ts](questions/conversations.ts) |
| 元数据刷新 | [routes/definition.ts](routes/definition.ts) | [definitions/metadata-operations.ts](definitions/metadata-operations.ts) |
| 提交分析 | [routes/analysis.ts](routes/analysis.ts) | [evaluations/submit.ts](evaluations/submit.ts) → [evaluations/start.ts](evaluations/start.ts) |
| 历史报告、研究窗口、统计与任务进度 | 同上 | [evaluations/read.ts](evaluations/read.ts)；投影与封存处理在 [evaluations/report-views.ts](evaluations/report-views.ts) |
| 申请、揭示 holdout | 同上 | [evaluations/holdout.ts](evaluations/holdout.ts)；资格检查在 [evaluations/holdout-policy.ts](evaluations/holdout-policy.ts) |
| 相关性缓存、提交与进度查询 | [routes/correlation.ts](routes/correlation.ts) | [correlations/operations.ts](correlations/operations.ts) → [correlations/job.ts](correlations/job.ts) |
| 因子天气固定、刷新与取消固定 | [routes/weather.ts](routes/weather.ts) | [weather/pins.ts](weather/pins.ts) → [weather/refresh.ts](weather/refresh.ts) |

[routes/index.ts](routes/index.ts) 直接组合六组业务路由并具名导出 `factorRoute`，统一挂载 `/api/app/factors`。自定义定义位于集合根与 `/:factorId`，目录位于 `/catalog`，组合位于 `/composites`，天气位于 `/weather`；修改定义与可见性使用 PATCH。HTTP 只处理输入校验、身份与 locale 传入、响应和错误映射；业务入口不接收 Hono Context。API 入参与共用研究、组合配置 schema 集中在 [schema.ts](schema.ts)，HTTP 与业务入口共同引用；所属对象 ID 由路径传入。完整契约见 [路由设计](../../../../docs/design/api-route-naming.md)。

`sources/snapshot.ts` 保存纯来源类型、解析、快照及语言相关哈希；通用规范 JSON/SHA-256 归 `sources/fingerprint.ts`。发布、天气、模板及 holdout 直接引用这些纯能力，数据库来源解析归 `sources/resolve.ts`。

`errors.ts` 表达操作拒绝的类别、信息及原因详情，`routes/errors.ts` 转成现有 HTTP 错误，并复用单因子/组合的发布异常映射。发布模块保留已有 `FactorPublicationError` 及错误语义。

## 目录职责

| 目录 | 拥有什么 |
| --- | --- |
| `agent` | 本业务对话启动与上下文装配；通用执行器仍归顶层 Agent |
| `definitions` | 草稿、读取、复制 key 分配、预置因子、字段和元数据；`templates` 保留时间序列、Panel、宏观状态的不同模板 |
| `observations` | 各类观察数据准备与数据截止日；资产、PIT、历史可得性口径随实现归属 |
| `evaluations` | 正式评估的提交、冻结、身份、报告读取与投影、研究统计、holdout 申请/揭示和 Job 生命周期 |
| `correlations` | 相关性提交、计算、Worker 与缓存完成事务；不创建正式报告 |
| `execution` | 正式评估与天气复用的计算入口和 Worker；配置规范化、横截面/时间序列/Panel/宏观评估器 |
| `sources` | 纯来源快照及指纹；`resolve.ts` 负责需要数据库的来源解析 |
| `jobs` | 按独立 kind 查询任务归属；生命周期由各业务拥有 |
| `publication` | 发布、归档、可见性；核对证据报告、源码哈希与当前状态 |
| `composition` | 组合定义的读写/复制、横截面组合算法、Panel 组合来源解析 |
| `runtime` | 公共代码提示词、定义验证；`typescript` 为编译和 isolate 内 SDK，`python` 为协议、校验和执行适配 |
| `weather` | 固定快照的用户操作、刷新状态与月度计算 |

`evaluations/job.ts`、`correlations/job.ts` 定义任务生命周期，由 bootstrap 分别注册为 `factor-analysis`、`factor-correlation`，执行器直接按 kind 选择定义。新 payload 不再保存 task；任务完成/失败/重启恢复沿用同一契约。部署入口 `scripts/bootstrap.sh` 在停服和 schema 迁移后调用独立的 `apps/api/scripts/migrations/split-factor-job-kinds.ts`，分批转换旧 `kind: factor` 记录；冻结 payload、报告和日志保持，旧 task 仅用于转换分类。业务启动不执行数据迁移。

## 三条主要调用链

**普通分析：** `routes/analysis.ts` → `submitFactorAnalysis` 检查方法/假设、来源、数据截止日及父报告归属 → `startFactorAnalysis` 冻结输入并创建报告与 Job → 队列按 `factor-analysis` 调用 `evaluations/job.ts` 启动 `execution/worker.ts` → `execution/run.ts` 选择 evaluator、加载 observations 并使用 runtime 计算 → 主线程在 Worker 正常结束后提交结果与 Job 终态。HTTP 返回任务标识，前端随后读取进度和报告。

**Holdout 与发布：** `submitFactorHoldout` 检查探索资格 → 使用父报告的代码、参数与数据版本构造 holdout → 在事务中复查已有任务并创建报告及 Job → 事务提交后初始化日志、唤醒队列。完成的 holdout 在揭示前不暴露结果、指标和任务日志；`revealFactorHoldout` 要求报告属于当前用户且已完成。发布仍要求证据与当前因子的源码/运行时相符，后续编辑不能让旧报告自动证明新代码。

**Agent 编辑：** 前端调用 Factor 的 `/:factorId/agent/turns` → `startFactorAgentTurn` 检查草稿归属、状态和运行中 turn → 创建 Factor profile 并交给通用 Agent 执行器 → 完成回调刷新因子元数据。只读问答由 `questions/conversations.ts` 接受稳定 factorKey、message 和可选 reportId；不接受客户端 history。Agent 工具调用分析任务入口是另一条调用链，保持现有工具校验与任务创建逻辑。

## 计算与持久化的边界

- `evaluations/start.ts` 冻结来源并创建正式报告与 Job；`evaluations/job.ts` 拥有完成、失败和恢复，`evaluations/read.ts` 拥有报告及 holdout 日志封存。holdout 继续使用自己的事务，不合并进普通提交。
- `execution/run.ts` 不接收 reportId、不写报告/Job/天气状态。输入包含 factor、冻结来源、配置、locale、日志及可选结果回调，直接返回各评估器原有结果。Python/TS 运行时求因子值，评估器形成统计结果。
- `execution/cross-sectional/` 中，`data.ts` 准备日历/报价/PIT 财务及行业数据，`series.ts` 求因子值及覆盖审计，`policy.ts` 定义既有方法政策，`evaluate.ts` 负责中性化/IC/分层等统计，`inference.ts` 负责稳健推断，`evaluator.ts` 适配研究配置。
- `correlations/compute.ts` 只复用横截面 `data.ts` 和 `series.ts`，结果由相关性 Job 写入缓存。天气复用共享 Worker，`weather:*` 仅为消息标识，仍只更新 pin 与观察点。

## 私有因子问答

`POST /questions` 在一个事务内检查来源及报告归属，创建/复用用户与稳定因子标识对应的 AgentConversation，并保存本轮 AgentTurn、用户消息及 contextSnapshot，随后启动通用 runner。首次 HTTP 响应就包含已提交的消息与 turnId。身份支持预设、代码模板、自定义和组合；不根据显示名称归并。

`GET /:factorId/questions` 返回该用户的历史、activeTurnId 和 nextBefore；默认最近 40 条，limit 最大 100，before 按 sequence 向前翻页。模型仅带最近 60 条历史及它们的来源标签，当前轮完整上下文单独进入 profile。上下文保存已授权定义、SHA-256、选中报告摘要/内容指纹及可用代码快照；UTF-8 超过 64 KiB 明确拒绝，不截断。问题上限 2,000 字符。

`questionFactorKey` 不关联 Factor 外键，来源或报告删除不级联删除已保存的私有问答；来源不可再读时不允许继续提问。新增的私有内容绝不进入 SQL 白名单。失败/取消/中断只保留状态，不伪造成功回复。草稿 authoring 仍使用原 Factor conversation 和 messages 镜像；只读问答不写这些字段。旧请求只带 factorName/history 时明确要求刷新，API/Web 需要协调发布。

## Review 与验证定位

- **权限和私有上下文：** 定义和报告查询继续按资源归属检查；公开已发布因子允许读取/复制，外部用户不能取得原作者的 messages、Research handoff 或来源执行信息。
- **事务：** 外部公开 Panel 组合的组件副本与组合一起提交；holdout 报告与 Job 一起提交。队列唤醒仍在事务之后，本轮没有扩大其他操作的事务或并发保护。
- **历史与保密：** 草稿删除保留历史报告；holdout 揭示前，列表、详情和 Job 日志三处均维持封存规则。
- **运行路径：** `evaluations/job.ts` 和 `weather/refresh.ts` 共用 `execution/worker.boot.mjs` → `worker.ts`；`correlations/job.ts` 使用 `correlations/worker.boot.mjs` → `worker.ts`。生产分别使用相应目录中的 `worker.js`。计算入口返回原有结果，Worker 通过结果回调在释放运行时之前发送完成消息，最后断开数据库连接。
- **天气刷新：** 列表查询仍会触发 pending/running pin 的后台刷新；固定时冻结代码/语言/运行时，忙碌时禁止取消固定。这里保持既有刷新实现，没有改成通用 Job。

新增 [routes/index.integration.test.ts](routes/index.integration.test.ts) 使用临时 SQLite 和 Hono 内存请求，覆盖上述权限、复制回滚、封存/揭示、holdout 事务、Agent 与天气操作；外部 Agent、队列和天气计算通过测试替身隔离。既有评估器、runtime、observations、publication、spec 测试随业务文件迁移，提交与轮询测试分别归 `evaluations/start.test.ts`、`evaluations/read.test.ts`；配置、评估身份、指纹测试分别归 `execution/spec.test.ts`、`evaluations/identity.test.ts`、`sources/fingerprint.test.ts`。

Commit 7 已通过人工 review、静态检查、全量 API 测试（196 个文件、1051 项）和 API 编译。额外 Worker 检查覆盖源码与编译入口、真实 TS/Python 计算、相关性缓存与 Job 提交、失败收尾和重启恢复；具体结果见 [开发记录](../../../../docs/design/backend-architecture-refactor.md#77-commit-7-实现与验证记录2026-09-08014899ba)。


## HTTP 报告与任务契约

分析提交使用 `POST /analyses`，来源由 body 的 `factor` 指定，支持预置、模板、自定义及组合。报告列表与详情使用 `/analysis-reports`、`/analysis-reports/:reportId`；holdout 申请和揭示仍是报告下的 `/holdout`、`/reveal` 动作。分页、封存、冻结代码、资格与重复申请规则保持。

普通分析任务使用 `/analysis-jobs/:jobId`，相关性任务使用 `/correlation-jobs/:jobId`，都保留 `since` 增量日志。[jobs/read.ts](jobs/read.ts) 按 userId 和独立 kind 查询：相关性要求 `factor-correlation` 且无分析报告关联；分析要求 `factor-analysis` 且用户拥有对应报告。历史记录经部署转换后走同一查询，不再检查 payload.task。关联 holdout 的分析任务继续由 `evaluations/read.ts` 在揭示前隐藏日志，不能通过相关性入口绕过。

相关性结果仍是按用户/因子集合/频率/区间寻址的缓存，没有独立 reportId。`GET /correlations` 与 `GET /correlation-jobs/active` 使用 query 的 `keys`（逗号分隔）、`freq`、`start`、`end`；活动查询包含 queued/running，返回 `{ jobId } | null`。`POST /correlations` 使用 JSON body，`keys` 为字符串数组、`refresh` 为布尔值（默认 false），其余默认值为 month / 20150101 / 20261231。保留规范化、权限、缓存优先、强制刷新与活动任务复用行为，返回 `{ jobId }` 或 `{ done: true, report }`。

## 路由职责整理（2026-09-10）

提交：`refactor(factor): clarify resource routes and route ownership`。

完成范围：七个路由文件、37 个 HTTP 接口、显式 analysis-reports 路径、相关性专用任务查询与 JSON 提交、任务隔离和历史任务兼容；同步 Web client、Factor store、仓内 E2E 调用及架构约定。没有 Prisma schema、数据迁移、SDK、分析算法或发布准入变更；天气恢复刷新机制保持。旧路径不提供别名，API/Web 需同步更新。用户页面操作和指标未改变，公开帮助、SDK 参考与双语 UI 文案不需要更新。

人工代码审查已通过。静态检查通过：格式、改动文件 ESLint、全仓 `pnpm typecheck`（包含生成契约一致性与后端边界检查，640 个文件、0 违规）及 `git diff --check`。

审查后验证通过：8 个测试文件、81 项测试（含 32 项路由集成测试，以及 publication、composition、reports、weather refresh、analysis-job），API/Web 构建，以及 factor-report-history、factor-composite、factor-weather 和新增 factor-correlation 四组 E2E。Web 构建仅有既有大 chunk 提示。

相关性 E2E 验证真实 JSON 提交、任务轮询、缓存命中，并用一次受控活动查询响应模拟任务完成后的重连；天气 E2E 沿用既有 HTTP fixtures，业务权限与刷新由路由集成测试覆盖。验证期间只修正相关性测试的标签切换、因子键搜索和多层 canvas 定位，未修改已审查的产品代码。验收截图已检查；独立数据库快照、临时 API/Web 服务及连接已清理。

## 内部职责整理（2026-09-16）

正式评估、相关性、天气分别拥有生命周期与产物，共享计算和纯来源按上面的目录归属。
人工 review 已通过；48 个文件、283 项相关测试最终通过，API 干净构建及源码/编译真实 Worker 验证通过。
固定行情下的 17 组结果与 `fd0ab69f` 原实现精确一致，覆盖双语言评估、序列、哈希、相关性和天气观察点。
验证中仅修正新测试的期数 fixture，没有改动已审查产品代码。完整验证条件与限制见
[内部结构整理记录](../../../../docs/design/core-business-internal-structure.md)。
