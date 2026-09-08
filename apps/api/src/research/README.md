# Research 后端阅读入口

Research 是带 Markdown / Python Cell 的研究文档。HTTP 路由和 Agent 工具调用下面的具体业务入口；这些子目录没有各自独立的产品页面，也不通过一个导出全部实现的总 service 协作。

| 要找的业务 | 入口 | 责任 |
| --- | --- | --- |
| 文档列表、创建、归档、恢复 | `documents/document-operations.ts` | 文档与会话归属、模板初始化；归档后关闭对应 Python 会话 |
| 读取文档 | `documents/read.ts` | 归属检查、Cell / 消息 / 审阅 / 尝试视图；保留旧会话首次读取时补建文档的行为 |
| 添加、编辑、删除 Cell | `documents/cell-operations.ts` | 修订号冲突、排序、编辑事务、调用依赖失效规则 |
| 分析变量依赖 | `dependencies/analyze.ts` | 通过 Python AST 分析源代码、持久化 definitions/references、协调阻塞状态 |
| 下游失效与删除阻塞 | `dependencies/invalidation.ts` | stale、deleted-upstream issues 及解除阻塞；不运行 Cell |
| 哪些 Cell 应运行、先后顺序 | `dependencies/run-plan.ts` | 纯依赖图计算、重复定义与环检测，输出运行计划 |
| 执行一个 Cell / 全文 / 受影响分支 | `execution/run-cell.ts`、`run-document.ts`、`run-affected.ts` | 执行编排、结果保存、冻结完整执行 |
| 中断、重置、互斥 | `execution/control.ts`、`run-state.ts` | 一份进程内文档运行状态；中断等待执行收尾后返回 |
| Python 会话 | `execution/python-session.ts` | 获取/复用/回收会话、串行通信、分析、执行、reset、interrupt |
| Python 发来的数据请求 | `sdk/dispatch.ts` | 校验请求、调用数据/结果查询、发送对应 response；只需要 session 的 send 能力 |
| 执行证据与产物 | `evidence/execution-records.ts`、`artifacts.ts`、`fingerprints.ts` | 冻结快照、执行读取/固化、图片产物、内容哈希 |
| Agent 提案、审阅与撤销 | `proposals/cell-changes.ts` | 准备修改、应用、接受/拒绝/撤销；同步提案记录和原消息 |
| 接受提案后的尝试运行 | `proposals/attempts.ts` | 校验可运行状态、记录 attempt，再调用 `execution/run-attempt.ts` |
| 提案、尝试、澄清记录 | `proposals/change-records.ts`、`attempt-records.ts`、`clarification-records.ts` | 各自的持久化、查询与消息视图同步 |

## 主要调用链

```text
HTTP / Agent 工具
  → documents/cell-operations → dependencies/analyze + invalidation
  → execution/run-cell | run-document | run-affected
      → run-state（取得与释放同一文档锁）
      → python-session → sdk/dispatch → 数据或结果查询
      → evidence（完整执行、产物与哈希）

proposals/cell-changes（应用 → 人工接受）
  → proposals/attempts（用户明确要求运行）
      → execution/run-attempt → run-cell
      → proposals/attempt-records（尝试结果读取）
```

`documents/read.ts` 不导入运行编排或提案应用操作，只使用提案记录的查询/视图。执行入口通过 `proposals/review-state.ts` 的窄查询检查是否有未完成审阅，不导入 `cell-changes.ts` 或 `attempts.ts`。文档归档和依赖分析会使用 `execution/python-session.ts` 的会话能力；这是资源调用，不是反向调用 `run-*` 执行流程。依赖算法和证据记录不拥有 Python 会话。

## Review 时优先检查

- **编辑与执行并发**：单 Cell 回写使用 id/revision/source 条件。干净全文执行使用开始时的源代码快照；中途编辑不改变该快照，也不把旧结果覆盖到新修订。
- **文档锁与取消**：单 Cell、全文、受影响分支、提案尝试共用 `run-state.ts`；取消标记控制后续 Cell 是否启动，关闭活动 Python 会话，并等待执行记录与锁收尾。
- **失效与阻塞**：普通上游修改使已执行下游 stale；删除上游保留缺失定义来源并使依赖者 blocked。reset 不清除 blocked。
- **提案与正式证据不同**：接受提案不会自动运行。attempt 的 Cell 快照归属该次尝试；只有干净全文运行创建 `ResearchExecution`，成功后才能固化并交接。
- **SDK 错误边界**：非法参数在数据查询之前抛出，由会话层处理；合法请求的数据查询失败通过带同一 request id 的 error response 返回。业务数据口径与公开 Contract 继续由既有实现定义。

本轮不改变锁作用域、事务边界、业务算法、HTTP 或 SDK。单进程运行状态、归档关闭会话、reset 与执行的既有交互均保留，不增加分布式锁、队列重试或取消协议。

## 后续目录整理

本文件记录 Commit 5 的实际组织。`workbench.ts` 和 `workbench-runtime.ts` 已删除，无兼容转发入口。`workbench-sdk.ts`、数据查询、catalog、语言服务、FCFF 模板、handoff、curator 和 HTTP 的其余整理仍属于 Commit 6；当前引用直接指向现有实现。

## 验证状态

人工 review 后完成验证：全量 API 194 个文件、1032 项测试通过；包括新增的 9 个生命周期场景与 3 个 SDK dispatch 场景。首次验证发现测试 beforeEach 误返回 mock 的问题，修复后重新 review，再执行全量测试通过。

格式、lint、全仓类型与 SDK/runtime 一致性、API 编译、静态迁移/依赖检查通过。源码和编译产物分别通过真实 Python runner 验证 SDK 指数读取、编辑失效、干净执行快照、受影响分支重跑、reset 和取消；编译产物使用生产 Unix socket 连接分支，测试对端为真实 runner，不属于生产容器验收。

验证使用临时 SQLite 与确定性数据，不访问开发数据库或真实市场、LLM 服务。临时进程、socket 和数据库连接均已释放。没有 UI 变更，本轮未运行浏览器 E2E。
