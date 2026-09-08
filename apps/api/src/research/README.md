# Research 后端阅读入口

Research 是带 Markdown / Python Cell 的研究文档。HTTP 路由和 Agent 工具调用下面的具体业务入口；这些子目录没有各自独立的产品页面，也不通过一个导出全部实现的总 service 协作。

| 要找的业务 | 入口 | 责任 |
| --- | --- | --- |
| HTTP 路由 | `routes.ts` | 挂在 `/api/app/research`；参数校验、错误映射、JSON / 图片响应，不直接读写 Prisma |
| 文档列表、创建、归档、恢复 | `documents/document-operations.ts`、`archive-idle-document.ts` | 模板初始化、归属检查；HTTP 归档先检查运行状态，再归档并关闭会话 |
| 旧会话列表、重命名、删除 | `documents/conversation-operations.ts` | 保留 Research 旧会话接口、预览与归属规则，删除后关闭会话 |
| 读取文档 | `documents/read.ts` | 归属检查、Cell / 消息 / 审阅 / 尝试视图；保留旧会话首次读取时补建文档的行为 |
| 添加、编辑、删除 Cell | `documents/cell-operations.ts` | 修订号冲突、排序、编辑事务、调用依赖失效规则 |
| 分析变量依赖 | `dependencies/analyze.ts` | 通过 Python AST 分析源代码、持久化 definitions/references、协调阻塞状态 |
| 下游失效与删除阻塞 | `dependencies/invalidation.ts` | stale、deleted-upstream issues 及解除阻塞；不运行 Cell |
| 哪些 Cell 应运行、先后顺序 | `dependencies/run-plan.ts` | 纯依赖图计算、重复定义与环检测，输出运行计划 |
| 执行一个 Cell / 全文 / 受影响分支 | `execution/run-cell.ts`、`run-document.ts`、`run-affected.ts` | 执行编排、结果保存、冻结完整执行 |
| 中断、重置、互斥 | `execution/control.ts`、`run-state.ts` | 一份进程内文档运行状态；中断等待执行收尾后返回 |
| Python 会话 | `execution/python-session.ts` | 获取/复用/回收会话、串行通信、分析、执行、reset、interrupt |
| Python 发来的数据请求 | `sdk/validation.ts`、`dispatch.ts` | 校验请求、调用数据/结果查询、发送对应 response；只需要 session 的 send 能力 |
| 执行证据与产物 | `evidence/execution-records.ts`、`artifacts.ts`、`read-artifact.ts`、`fingerprints.ts` | 冻结快照、执行读取/固化、图片产物、内容哈希 |
| Agent 提案、审阅与撤销 | `proposals/cell-changes.ts` | 准备修改、应用、接受/拒绝/撤销；同步提案记录和原消息 |
| 接受提案后的尝试运行 | `proposals/attempts.ts` | 校验可运行状态、记录 attempt，再调用 `execution/run-attempt.ts` |
| 提案、尝试、澄清记录 | `proposals/change-records.ts`、`attempt-records.ts`、`clarification-records.ts` | 各自的持久化、查询与消息视图同步 |
| 数据与公开列映射 | `datasets/equity.ts`、`financial.ts`、`financial-values.ts`、`commodity.ts`、`market-reference.ts`、`supplemental.ts` | Research SDK 需要的数据切片、字段与口径；底层来源/同步仍归市场业务 |
| 序列、截面与股票池 | `datasets/series.ts`、`universe.ts`、`spec.ts`、`cross-market-data-contracts.ts` | 序列与股票池查询、参数及跨市场约束 |
| 报告作为研究数据 | `datasets/results/factor-report.ts`、`backtest-report.ts`、`scan-and-weather.ts` | 用户归属检查、报告结果映射 |
| 数据检索与语义目录 | `catalog/data-catalog.ts`、`capabilities.ts`、`concepts.ts`、`concept-bindings.ts`、`concept-binding-resolver.ts`、`source-decisions.ts`、`playbooks.ts` | 查找数据、概念与来源，提供研究方法说明 |
| Python 编辑器语言服务 | `language/pyright-service.ts`、`document.ts`、`stubs.ts` | Pyright 进程、文档映射，消费公开 Contract 生成类型信息 |
| 文档模板与 FCFF 案例 | `templates/document-templates.ts`、`templates/fcff/` | 模板选择、透明 Cell 源代码、分类证据与回放案例 |
| 冻结研究 → Factor / Strategy | `handoff/factor-drafts.ts`、`strategy-drafts.ts`、`factor-handoff.ts`、`strategy-handoff.ts`、`context.ts` | 草稿生成、准入校验与来源关联 |
| Research Agent 启动 | `agent-turn.ts`、`agent-context.ts` | 检查会话/澄清/尝试状态，构造上下文和工具，再交给共享 Agent 执行器 |
| 研究整理（Curator） | `curator/submit.ts`、`runs.ts`、`reference-search.ts`，根级 `curator-job.ts` | 提交与查询、证据整理/反馈；具名 Job 定义完成、失败与恢复 |

Research 的 HTTP 入口和测试直接放在模块根目录，当前不单设 `http/`。参数校验和错误映射留在 `routes.ts`；业务操作由各具名入口承担。

## 主要调用链

```text
HTTP / Agent 工具
  → documents/cell-operations → dependencies/analyze + invalidation
  → execution/run-cell | run-document | run-affected
      → run-state（取得与释放同一文档锁）
      → python-session → sdk/dispatch → sdk/validation + datasets（含 results）
      → evidence（完整执行、产物与哈希）

proposals/cell-changes（应用 → 人工接受）
  → proposals/attempts（用户明确要求运行）
      → execution/run-attempt → run-cell
      → proposals/attempt-records（尝试结果读取）

HTTP /agent → agent-turn → agent-context + proposals（澄清/尝试上下文）
  → agent/profiles + agent/tools → agent/turn-run（共享对话执行与事件）
HTTP /curator/runs → curator/submit → 创建 CuratorRun + Job 的同一事务
  → 日志初始化、唤醒队列 → curator-job → curator/runs
HTTP 数据检索 / Agent catalog 工具 → catalog → datasets / 市场业务
HTTP /language → language/pyright-service → document + stubs
HTTP 草稿交接 → handoff → 已冻结 evidence + Factor / Strategy
```

`documents/read.ts` 不导入运行编排或提案应用操作，只使用提案记录的查询/视图。执行入口通过 `proposals/review-state.ts` 的窄查询检查是否有未完成审阅，不导入 `cell-changes.ts` 或 `attempts.ts`。文档归档和依赖分析会使用 `execution/python-session.ts` 的会话能力；这是资源调用，不是反向调用 `run-*` 执行流程。依赖算法和证据记录不拥有 Python 会话。

## Review 时优先检查

- **编辑与执行并发**：单 Cell 回写使用 id/revision/source 条件。干净全文执行使用开始时的源代码快照；中途编辑不改变该快照，也不把旧结果覆盖到新修订。
- **文档锁与取消**：单 Cell、全文、受影响分支、提案尝试共用 `run-state.ts`；取消标记控制后续 Cell 是否启动，关闭活动 Python 会话，并等待执行记录与锁收尾。
- **失效与阻塞**：普通上游修改使已执行下游 stale；删除上游保留缺失定义来源并使依赖者 blocked。reset 不清除 blocked。
- **提案与正式证据不同**：接受提案不会自动运行。attempt 的 Cell 快照归属该次尝试；只有干净全文运行创建 `ResearchExecution`，成功后才能固化并交接。
- **SDK 错误边界**：非法参数在数据查询之前抛出，由会话层处理；合法请求的数据查询失败通过带同一 request id 的 error response 返回。业务数据口径与公开 Contract 继续由既有实现定义。

本轮不改变锁作用域、事务边界、业务算法、HTTP 或 SDK。单进程运行状态、归档关闭会话、reset 与执行的既有交互均保留，不增加分布式锁、队列重试或取消协议。

## 历史迁移与路径

历史 Screen → Research 实现和测试位于 `apps/api/scripts/migrations/screen-to-research.ts` / `.test.ts`。原 `scripts/migrate-screen-to-research.ts` CLI 保留，参数、dry-run 和 finalize 行为不变；运行期业务不导入迁移实现。

旧 Research 平铺入口已移除，不保留兼容转发或总 barrel。数据模块去掉重复的 `-dataset` 后缀；catalog 的能力清单为 `capabilities.ts`；FCFF 文件位于 `templates/fcff` 后不再重复 `equity-fcff-` 前缀。Pyright 仍从 API 的依赖解析包路径；Curator 仓库根目录仍按 API 工作目录解析。迁移后的 E2E 脚本源文件导入保留 `.ts`。

## Commit 6 review 重点与验证

- Agent 启动是 Research 业务入口，通用 LLM 循环、SSE 和持久化仍在 Agent。继续先校验归属/运行状态，再处理澄清、读取上下文、关联 explanationTurnId 并入队；未把这些操作合并成新事务。
- Curator 提交保留活动任务复用、最后一次成功 cursor、Run + Job 原事务及提交后的日志/唤醒顺序。查重与创建之间的既有并发窗口未改变。
- HTTP 归档先检查归属，再检查 Cell / Agent 运行状态；底层 `archiveResearchDocument` 仍可被原调用方使用。旧会话删除保留原规则，不新增运行中保护。
- 图片读取先校验归属，HTTP 随后处理 ETag / 304 和安全响应头；不能在归属检查前复用缓存。

新增 `routes.integration.test.ts` 的 10 个隔离 SQLite 场景，覆盖上述权限、Agent 上下文/澄清/尝试、事务回滚与 HTTP 响应边界。只替换 Agent 执行、队列唤醒和 Python 关闭等外部资源；路由、业务入口及 Prisma 读写使用真实实现。

人工 review 后验证通过：全量 API 195 个文件、1042 项测试全部通过，包含上述 10 个新增场景；API 干净编译通过。源码与编译产物均通过真实 Python SDK 查询、文档执行/冻结、下游重跑、reset、取消及 Pyright 补全验证。编译产物覆盖生产 Unix socket 连接分支，对端使用本地真实 runner。

格式、lint、全仓 typecheck/契约一致性及迁移/路径/依赖/路由静态检查通过。首轮沙箱中的 socket EPERM 与 Python 超时在允许本地 socket/子进程的环境下重跑全部通过，未修改代码或放宽超时。临时进程、socket 和数据库连接已清理，没有开发数据库写入、真实市场/LLM 调用或浏览器 E2E。提交信息为 `整理 Research 数据能力与业务入口`；完整记录见架构计划 §7.6。
