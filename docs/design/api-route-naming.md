# `/api/app` 资源路由设计

2026-09-10 用户确认。本文是当前 HTTP 路径契约，替代此前以单数表示动作、复数表示 CRUD 的约定；历史迁移记录保留在 Git 与 [后端重构记录](backend-architecture-refactor.md)。

## 约定与组装

- 同一业务资源统一前缀：策略 `/strategies`，因子 `/factors`。从路径直接识别资源、对象和操作，不靠单复数区分功能。
- GET 读取、POST 创建资源或触发操作、PATCH 局部修改、DELETE 删除。发布、归档、复制、holdout 和 reveal 保留明确动作，避免伪装成普通字段更新。
- 对象归属 ID 放在路径。回测/扫描不再通过 `?strategyId=` 选择所属策略，策略/因子 Agent 和因子元数据刷新不再要求 body 的 `id`。HTTP 层以路径 ID 构造业务输入，额外 body/query ID 不能覆盖它。
- 查询条件、分页与增量日志仍在 query；分析参数、代码、消息等仍在 body。响应结构、业务状态、鉴权和持久化语义保持。
- 模块根级 `routes.ts` 是唯一对外路由入口，具名导出模块总路由。Strategy/Factor 使用 `resource-routes.ts` 组合，处理器仍分散在按职责命名的文件里。实现文件直接导入子路由，避免反向引用入口。
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
| POST / GET | `/strategies/:strategyId/backtests` | 提交回测 / 历史回测报告列表 |
| GET | `/strategies/:strategyId/backtests/running` | 查找运行中的回测任务 |
| GET | `/strategies/backtest-reports/:reportId` | 读取持久化回测报告 |
| GET | `/strategies/backtest-jobs/:jobId` | 查询任务状态及日志，保留 `since` |
| POST / GET | `/strategies/:strategyId/scans` | 提交扫描 / 历史扫描报告列表 |
| GET | `/strategies/:strategyId/scans/running` | 查找运行中的扫描任务 |
| GET | `/strategies/scan-reports/:reportId` | 读取扫描报告 |
| GET | `/strategies/scan-reports/:reportId/job` | 查询报告关联的扫描任务，保留 `since` |
| POST | `/strategies/name-suggestions` | 为代码建议名称，不要求已保存策略 |
| POST | `/strategies/scan-parameters/inspect` | 检查代码可扫描参数，不要求已保存策略 |

回测与扫描提交保留原有 config/spec body。报告是持久化研究结果，job 是执行状态与日志；两个 ID 不混用。扫描沿用按 reportId 查询关联 job 的业务契约。

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
| GET | `/factors/reports` | 按 `factor` 来源筛选报告，保留分页参数 |
| GET | `/factors/reports/:reportId` | 读取报告 |
| POST | `/factors/reports/:reportId/holdout` | 发起留出集验证 |
| POST | `/factors/reports/:reportId/reveal` | 揭示留出集报告 |
| GET | `/factors/analysis-jobs/:jobId` | 查询分析任务，保留 `since` |
| GET / POST | `/factors/correlations` | 查询 / 提交相关性分析 |
| GET | `/factors/correlations/running` | 查找运行中的相关性任务 |
| GET | `/factors/research/window` | 研究窗口与留出集规则 |
| GET | `/factors/research/summary` | 研究概况，保留可选 `factor` 查询 |
| GET | `/factors/weather` | 因子天气 |
| POST | `/factors/weather/pins` | 固定因子 |
| POST | `/factors/weather/pins/:pinId/refresh` | 刷新固定项 |
| DELETE | `/factors/weather/pins/:pinId` | 取消固定 |

分析来源可能是预置、模板、自定义或组合，继续由 body 的 `factor` 指定，不强行挂到自定义因子 ID 下。相关性分析涉及多个因子，继续通过 query 的 `keys`、`freq`、`start`、`end` 以及提交时可选 `refresh` 表达输入。天气固定项使用 pinId，与其引用的 factorId 区分。

## 迁移对照

| 旧路径/方法 | 新路径/方法 |
| --- | --- |
| `POST /strategies/:id`、`POST /strategies/:id/visibility` | 对应路径改用 PATCH |
| `POST /strategy/agent` | `POST /strategies/:strategyId/agent/turns`，ID 从 body 移到路径 |
| `POST /strategy/name` | `POST /strategies/name-suggestions` |
| `POST /strategy/backtest?strategyId=...` | `POST /strategies/:strategyId/backtests` |
| `GET /strategy/backtest/reports?strategyId=...` | `GET /strategies/:strategyId/backtests` |
| `GET /strategy/backtest/running?strategyId=...` | `GET /strategies/:strategyId/backtests/running` |
| `GET /strategy/backtest/reports/:reportId` | `GET /strategies/backtest-reports/:reportId` |
| `GET /strategy/backtest/:jobId` | `GET /strategies/backtest-jobs/:jobId` |
| `POST /strategy/scans/parameters` | `POST /strategies/scan-parameters/inspect` |
| `GET / POST /strategy/scans?strategyId=...` | `GET / POST /strategies/:strategyId/scans` |
| `GET /strategy/scans/running?strategyId=...` | `GET /strategies/:strategyId/scans/running` |
| `GET /strategy/scans/:reportId[/job]` | `GET /strategies/scan-reports/:reportId[/job]` |
| `/factors/custom[/... ]` | `/factors[/... ]`，修改定义和可见性改 PATCH |
| `POST /factors/composites/:id[/visibility]` | 对应路径改用 PATCH |
| `POST /factor/agent`、`POST /factor/metadata` | `/factors/:factorId/agent/turns`、`/factors/:factorId/metadata/refresh`，ID 从 body 移到路径 |
| `POST /factor/qa` | `POST /factors/questions` |
| `POST /factor/analysis/run` | `POST /factors/analyses` |
| `GET /factor/analysis/job/:jobId` | `GET /factors/analysis-jobs/:jobId` |
| `/factor/reports...`、`/factor/research...` | 对应 `/factors/reports...`、`/factors/research...` |
| `GET /factor/correlation`、`POST /factor/correlation/run` | `GET / POST /factors/correlations` |
| `GET /factor/correlation/running` | `GET /factors/correlations/running` |
| `/factor-weather...` | `/factors/weather...` |

这次同步迁移后端、Web client、测试及 E2E，不提供旧路径别名。已有打开的旧前端需要刷新；外部或本地自建 HTTP 调用方需要按上表更新。发布时 API 与 Web 应一起更新。

Auth、Maintenance、Agent、Market、Research、Signals、Library 的 HTTP 路径，以及前端页面、共享类型、Prisma schema、SDK 和研究方法不在此次迁移范围。公开帮助没有新增用户操作或能力，无需变更中英 UI 文案。

## 验证

代码 review 前只运行格式、lint、类型与后端边界静态检查。Review 后执行策略/因子路由集成测试、回测路由与多用户权限测试、API/Web 构建，以及回测报告历史和因子天气 E2E。重点覆盖集合路径与动态 ID 匹配、PATCH 约定、路径 ID 不被 body/query 覆盖、报告归属及封存保护、前端请求与轮询迁移。
