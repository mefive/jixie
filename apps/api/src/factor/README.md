# Factor 后端阅读地图

Factor 负责因子从定义、分析到发布与持续观察的完整业务。Research 可以生成因子草稿或读取报告，Strategy 按现有发布规则消费因子；Agent 提供编辑与问答能力，因子的归属、状态和准入仍由 Factor 决定。

## 从产品操作找入口

| 要理解或修改的行为 | HTTP 入口 | 业务入口 |
| --- | --- | --- |
| 因子目录、自定义因子详情 | [definition-routes.ts](definition-routes.ts) | [definitions/catalog.ts](definitions/catalog.ts)、[definitions/read.ts](definitions/read.ts) |
| 创建、编辑、删除、复制草稿 | 同上 | [definitions/drafts.ts](definitions/drafts.ts)；输入定义在 [definitions/inputs.ts](definitions/inputs.ts) |
| 发布、归档、公开范围 | [definition-routes.ts](definition-routes.ts)、[composite-routes.ts](composite-routes.ts) | [publication/factor.ts](publication/factor.ts)、[publication/panel-composite.ts](publication/panel-composite.ts)、[publication/visibility.ts](publication/visibility.ts) |
| 创建、编辑、复制因子组合 | [composite-routes.ts](composite-routes.ts) | [composition/operations.ts](composition/operations.ts) |
| Agent 编辑、预置因子问答 | [agent-routes.ts](agent-routes.ts) | [agent-turn.ts](agent-turn.ts) |
| 元数据刷新 | [definition-routes.ts](definition-routes.ts) | [definitions/metadata-operations.ts](definitions/metadata-operations.ts) |
| 提交分析 | [analysis-routes.ts](analysis-routes.ts) | [analysis/submit.ts](analysis/submit.ts) → [analysis-job.ts](analysis-job.ts) |
| 历史报告、研究窗口、统计与任务进度 | 同上 | [reports/read.ts](reports/read.ts)；投影与封存处理在 [reports/views.ts](reports/views.ts) |
| 申请、揭示 holdout | 同上 | [reports/holdout.ts](reports/holdout.ts)；资格检查在 [reports/holdout-policy.ts](reports/holdout-policy.ts) |
| 相关性缓存、提交与进度查询 | [correlation-routes.ts](correlation-routes.ts) | [analysis/correlation-operations.ts](analysis/correlation-operations.ts) → [correlation-job.ts](correlation-job.ts) |
| 因子天气固定、刷新与取消固定 | [weather-routes.ts](weather-routes.ts) | [weather/pins.ts](weather/pins.ts) → [weather/refresh.ts](weather/refresh.ts) |

根级 [routes.ts](routes.ts) 直接组合六组业务路由并具名导出 `factorRoute`，统一挂载 `/api/app/factors`。自定义定义位于集合根与 `/:factorId`，目录位于 `/catalog`，组合位于 `/composites`，天气位于 `/weather`；修改定义与可见性使用 PATCH。HTTP 只处理输入校验、身份与 locale 传入、响应和错误映射；业务入口不接收 Hono Context。参数 schema 随业务入口归属，HTTP 复用业务字段规则；所属对象 ID 由路径传入。完整契约见 [路由设计](../../../../docs/design/api-route-naming.md)。

`operation-errors.ts` 表达操作拒绝的类别、信息及原因详情，`route-errors.ts` 转成现有 HTTP 错误，并复用单因子/组合的发布异常映射。发布模块保留已有 `FactorPublicationError` 及错误语义。

## 目录职责

| 目录 | 拥有什么 |
| --- | --- |
| `definitions` | 草稿、读取、复制 key 分配、预置因子、字段和元数据；`templates` 保留时间序列、Panel、宏观状态的不同模板 |
| `observations` | 各类观察数据准备与数据截止日；资产、PIT、历史可得性口径随实现归属 |
| `analysis` | 提交与来源解析、横截面/时间序列/Panel/宏观评估器、相关性计算、Worker；不把不同统计方法合并成通用算法 |
| `reports` | 报告 spec、历史结果投影、研究统计、holdout 规则和申请/揭示操作 |
| `publication` | 发布、归档、可见性；核对证据报告、源码哈希与当前状态 |
| `composition` | 组合定义的读写/复制、横截面组合算法、Panel 组合来源解析 |
| `runtime` | 公共代码提示词、定义验证；`typescript` 为编译和 isolate 内 SDK，`python` 为协议、校验和执行适配 |
| `weather` | 固定快照的用户操作、刷新状态与月度计算 |

根级 `analysis-job.ts`、`correlation-job.ts` 定义任务生命周期，`factor-job.ts` 按现有 payload 的 task 分派。它们由根级 bootstrap 注册到通用 Job 执行器；任务完成/失败/重启恢复沿用同一契约，不散落到目录约定的 complete/recover 文件。

## 三条主要调用链

**普通分析：** `analysis-routes.ts` → `submitFactorAnalysis` 检查方法/假设、来源、数据截止日及父报告归属 → `startFactorAnalysis` 冻结输入并创建报告与 Job → 队列调用 `factor-job.ts` → `analysis-job.ts` 启动 Worker → evaluator 加载 observations 并使用 runtime 计算 → 主线程在 Worker 正常结束后提交结果与 Job 终态。HTTP 返回任务标识，前端随后读取进度和报告。

**Holdout 与发布：** `submitFactorHoldout` 检查探索资格 → 使用父报告的代码、参数与数据版本构造 holdout → 在事务中复查已有任务并创建报告及 Job → 事务提交后初始化日志、唤醒队列。完成的 holdout 在揭示前不暴露结果、指标和任务日志；`revealFactorHoldout` 要求报告属于当前用户且已完成。发布仍要求证据与当前因子的源码/运行时相符，后续编辑不能让旧报告自动证明新代码。

**Agent 编辑：** 前端调用 Factor 的 `/:factorId/agent/turns` → `startFactorAgentTurn` 检查草稿归属、状态和运行中 turn → 创建 Factor profile 并交给通用 Agent 执行器 → 完成回调刷新因子元数据。`/questions` 保留独立的预置因子问答，以请求提供的 history 运行；不会新建一个 Factor 宿主。Agent 工具调用分析任务入口是另一条调用链，保持现有工具校验与任务创建逻辑。

## Review 与验证定位

- **权限和私有上下文：** 定义和报告查询继续按资源归属检查；公开已发布因子允许读取/复制，外部用户不能取得原作者的 messages、Research handoff 或来源执行信息。
- **事务：** 外部公开 Panel 组合的组件副本与组合一起提交；holdout 报告与 Job 一起提交。队列唤醒仍在事务之后，本轮没有扩大其他操作的事务或并发保护。
- **历史与保密：** 草稿删除保留历史报告；holdout 揭示前，列表、详情和 Job 日志三处均维持封存规则。
- **运行路径：** `analysis-job.ts` 与 `correlation-job.ts` 的开发路径指向 `analysis/*.boot.mjs`，注册 tsx 后加载 `.ts` Worker；编译运行直接指向同目录的 `.js` Worker。
- **天气刷新：** 列表查询仍会触发 pending/running pin 的后台刷新；固定时冻结代码/语言/运行时，忙碌时禁止取消固定。这里保持既有刷新实现，没有改成通用 Job。

新增 [routes.integration.test.ts](routes.integration.test.ts) 使用临时 SQLite 和 Hono 内存请求，覆盖上述权限、复制回滚、封存/揭示、holdout 事务、Agent 与天气操作；外部 Agent、队列和天气计算通过测试替身隔离。既有评估器、runtime、observations、publication、spec 测试随业务文件迁移，`analysis-job.test.ts` 保留在任务入口旁。

Commit 7 已通过人工 review、静态检查、全量 API 测试（196 个文件、1051 项）和 API 编译。额外 Worker 检查覆盖源码与编译入口、真实 TS/Python 计算、相关性缓存与 Job 提交、失败收尾和重启恢复；具体结果见 [开发记录](../../../../docs/design/backend-architecture-refactor.md#77-commit-7-实现与验证记录2026-09-08014899ba)。


## HTTP 报告与任务契约

分析提交使用 `POST /analyses`，来源由 body 的 `factor` 指定，支持预置、模板、自定义及组合。报告列表与详情使用 `/analysis-reports`、`/analysis-reports/:reportId`；holdout 申请和揭示仍是报告下的 `/holdout`、`/reveal` 动作。分页、封存、冻结代码、资格与重复申请规则保持。

普通分析任务使用 `/analysis-jobs/:jobId`，相关性任务使用 `/correlation-jobs/:jobId`，都保留 `since` 增量日志。[analysis/job-queries.ts](analysis/job-queries.ts) 检查 userId、kind 和任务类型：相关性要求 `payload.task = correlation` 且无分析报告关联；分析要求用户拥有对应报告，并允许历史 payload 缺少 task。关联 holdout 的分析任务继续由 `reports/read.ts` 在揭示前隐藏日志，不能通过相关性入口绕过。

相关性结果仍是按用户/因子集合/频率/区间寻址的缓存，没有独立 reportId。`GET /correlations` 与 `GET /correlation-jobs/active` 使用 query 的 `keys`（逗号分隔）、`freq`、`start`、`end`；活动查询包含 queued/running，返回 `{ jobId } | null`。`POST /correlations` 使用 JSON body，`keys` 为字符串数组、`refresh` 为布尔值（默认 false），其余默认值为 month / 20150101 / 20261231。保留规范化、权限、缓存优先、强制刷新与活动任务复用行为，返回 `{ jobId }` 或 `{ done: true, report }`。

## 路由职责整理（2026-09-10）

提交：`refactor(factor): clarify resource routes and route ownership`。

完成范围：七个路由文件、37 个 HTTP 接口、显式 analysis-reports 路径、相关性专用任务查询与 JSON 提交、任务隔离和历史任务兼容；同步 Web client、Factor store、仓内 E2E 调用及架构约定。没有 Prisma schema、数据迁移、SDK、分析算法或发布准入变更；天气恢复刷新机制保持。旧路径不提供别名，API/Web 需同步更新。用户页面操作和指标未改变，公开帮助、SDK 参考与双语 UI 文案不需要更新。

人工代码审查已通过。静态检查通过：格式、改动文件 ESLint、全仓 `pnpm typecheck`（包含生成契约一致性与后端边界检查，640 个文件、0 违规）及 `git diff --check`。

审查后验证通过：8 个测试文件、81 项测试（含 32 项路由集成测试，以及 publication、composition、reports、weather refresh、analysis-job），API/Web 构建，以及 factor-report-history、factor-composite、factor-weather 和新增 factor-correlation 四组 E2E。Web 构建仅有既有大 chunk 提示。

相关性 E2E 验证真实 JSON 提交、任务轮询、缓存命中，并用一次受控活动查询响应模拟任务完成后的重连；天气 E2E 沿用既有 HTTP fixtures，业务权限与刷新由路由集成测试覆盖。验证期间只修正相关性测试的标签切换、因子键搜索和多层 canvas 定位，未修改已审查的产品代码。验收截图已检查；独立数据库快照、临时 API/Web 服务及连接已清理。
