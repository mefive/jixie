# 未使用 HTTP 入口清理（2026-09-24）

状态：人工代码审核通过；全部计划验证通过，已完成清理。

计划提交：`refactor(api)!: remove unused HTTP endpoints`

## 审计依据与范围

从 server 挂载与各模块 routes 出发，核对全部 140 个业务／认证／维护路由声明（另有 server 的根路径和健康检查），追踪 Web API 封装到真实业务调用，并检索 Agent、CLI、部署及 E2E 脚本。代码引用与内部调用是本次判断依据，不代表已获取生产访问日志或排除仓库外客户端。

批准清理以下 8 条入口及删除后失去用途的依赖。路由声明从 140 减至 132，无新增路由；健康检查、认证、维护、Factor、现行页面入口保持。

| 退役接口（省略 `/api/app`） | 清理与保留 |
| --- | --- |
| `PATCH /strategies/:strategyId` | 删除 updateStrategy、客户端封装及专用请求 schema/types；commitStrategyConfig 保留配置保存并删除 messages 参数；回测事务保存配置、Agent 保存消息 |
| `GET /agent/conversations/:conversationId/messages` | 删除路由、独占查询实现及分页请求契约；实体历史读取、会话/消息存储、turn 详情及 SSE 保留 |
| `GET /market/state` | 删除 loader、旧快照专用计算、风格配对清单及响应类型；保留市场指标同步、Research 的完整状态点序列、天气计算和风险驱动数据 |
| `GET /library/strategies/:strategyId` | 删除公开详情函数与独占 SharingError；公开目录、策略复制及 Strategy 错误保留 |
| `POST /research/documents/:documentId/dependency-analysis` | 删除 HTTP 与前端封装；提案尝试仍调用 analyzeResearchDocument，全文运行仍使用 analyzeAndPersist |
| `POST /research/embedded-analyses` | 删除 HTTP 与专用前端请求类型；Agent 的 createEmbeddedAnalysis 和输入校验 schema 保留 |
| `GET /research/embedded-analyses/:analysisId/versions` | 删除版本列表函数；详情、版本派生、执行、运行历史与归属检查保留 |
| `GET /signals/runs/:runId` | 删除 HTTP 与前端封装；getSignalRun 保留供成交更新响应，列表与 Job 查询保留；部署 E2E 改用部署运行列表 |

这是 HTTP 契约的破坏性收缩，旧路径返回 404，不设置转发或兼容壳。没有数据库、历史数据、Prisma migration、SDK 或部署组件依赖变更。现有页面流程与公开帮助交互不变，不需要新增双语文案。

旧设计为过渡期或潜在未来客户端保留的策略更新、会话分页等能力，以此记录为最新决定。历史设计和验收记录保留并标注退役，不把历史已通过验证记成本次结果。

## 实现与审核重点

- 路由只删除已批准入口，仍被内部调用的业务函数保留。
- `market/state/compute.ts` 删除旧快照聚合、行业热度排名及风格配对计算，天气计算与 Research 状态序列不变；原市场点测试转为直接覆盖保留的 buildMarketStatePoints。
- 相关接口测试改为验证退役入口 404；Research 内部授权和依赖分析继续通过实际业务函数验证，嵌入式创建通过 Agent 共用 schema 与函数准备数据。
- 部署 E2E 用回测提交保存后续配置，继续检查已冻结部署不变；按 submitted.runId 从部署运行列表查回执行结果。
- 清理全部闲置前端封装；原策略 PATCH 类型断言改为约束回测提交不能接受不完整配置。

## 静态检查

- `pnpm typecheck`：通过，含后端边界静态扫描、sandbox 生成契约一致性及 shared/API/docs/sandboxd/Web 类型检查。
- 受影响 TS/MJS 文件 ESLint：通过。
- 受影响 TS/MJS 文件 Prettier：通过。
- `git diff --check`：通过。
- 路由声明静态比较：精确删除上述 8 条，没有新增或其他删除。

## 人工审核通过后执行

先构建 shared 以更新运行时解析，执行以下 API 文件的定向测试：

- `src/strategy/definitions/config.test.ts`、`src/strategy/routes/backtest.test.ts`、`src/strategy/routes/index.integration.test.ts`
- `src/agent/routes.integration.test.ts`、`src/agent/tools/run-embedded-analysis.test.ts`、`src/factor/questions/conversations.integration.test.ts`
- `src/market/state/compute.test.ts`、`src/market/routes/index.test.ts`、`src/research/datasets/supplemental.test.ts`
- `src/research/routes/index.integration.test.ts`、`src/research/embedded/lifecycle.integration.test.ts`、`src/research/proposals/attempts.test.ts`
- `src/sharing/routes.integration.test.ts`、`src/signals/routes/index.integration.test.ts`、`tests/business-errors.test.ts`、`tests/web-request-contracts.test.ts`

然后在可丢弃数据库和临时 API/Web 服务上运行 `report-deployments` E2E，检查并交付截图，关闭临时服务和连接。E2E 需要相应行情、交易日及收益率等运行数据；不得在日常开发库上通过环境标记绕过隔离要求。

全部验证通过后更新此记录，按既定 message 提交，不推送。若验证要求变更产品代码，重新提交人工审核后再执行行为验证。

## 实际验证结果

- Shared、API、Web 构建通过；Web 构建保留既有大 chunk／混合静态动态导入提示，不影响通过。
- 16 个定向测试文件共 220 项通过。首轮 214 项通过，Web 请求契约测试有 6 项因仍将通用 client.ts 当作业务总入口而失败；仅修正测试 bundler 输入，从 strategy/factor/research/research-embedded 加载实际函数，7 项原有契约断言全部重跑通过。没有修改产品代码或降低断言。
- 测试修正后 API 类型检查、该文件 ESLint／Prettier 与 diff 检查通过。
- `E2E_BASE=http://127.0.0.1:43292 E2E_ISOLATED_DB=1 pnpm e2e report-deployments` 通过：真实回测、两个报告分别部署、后续回测保存配置不改变既有部署、信号生成与列表查询、暂停／重新部署及历史保留均通过；浏览器无 pageerror。
- E2E 使用新建临时 SQLite、合成行情／交易日和本地命名模型 fixture；实际 API、Worker、引擎与 Web 参与运行，不访问开发数据库，也不调用外部模型。它验证软件流程，不代表真实市场研究结果。
- 已检查中文、英文与移动布局截图：`apps/web/acceptance/report-deployments-{zh,en,mobile}.png`（验收产物不提交）。
- 临时 API／Web／模型 fixture 已停止，43291／43292／43293 监听和临时数据库连接已释放；可丢弃数据库已清理。
