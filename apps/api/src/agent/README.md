# Agent 后端阅读地图

Agent 为 Research、Factor 和 Strategy 提供模型/工具循环、后台对话、流式事件和持久化记录。业务模块负责检查当前实体能否开始对话、准备上下文和选择 profile；Agent 使用 profile 提供的工具与校验器执行，不自行决定业务准入规则。

## 从产品操作找入口

- 发起对话：`research/agent-turn.ts`、`factor/agent-turn.ts`、`strategy/agent-turn.ts` → 各自的 profile → [turns/run.ts](turns/run.ts) 的 `enqueueAgentTurn`。预置因子问答可以使用不持久化的临时 turn。
- 查看历史消息：[conversation-routes.ts](conversation-routes.ts) → [conversations/read.ts](conversations/read.ts)，按用户归属查询、按 sequence 翻页。
- 订阅/恢复连接/取消：`turn-routes.ts` → [turns/bus.ts](turns/bus.ts)；首帧为 snapshot，随后是增量与终态。断开订阅只解除订阅，取消接口才中止模型调用。
- 查看执行详情：`turn-routes.ts` → [turns/read.ts](turns/read.ts)，读取持久化状态和轨迹，检查对话所有者。
- 重绘回复中的图表：`POST /sql-queries`、`POST /chart-computations` → SQL/图表工具，与 Agent 工具共用校验和执行能力。

根级 `routes.ts` 直接组合 conversation / turn / chart 三组路由，具名导出 `agentRoute`，由 server 挂到 `/api/app/agent`。HTTP 路由保留响应与 SSE 传输；查询函数负责资源归属和投影。Agent turn 不进入通用 Job 队列，仍使用进程内注册表和独立的 AgentTurn 记录。

Strategy profile 只提供数据查询/分析工具和代码产物校验；生成代码后由用户在策略工作台显式发起回测。Research profile 保留语义查询与文档提案，统计计算在可见 Cell 中执行；完整交易规则通过封存研究生成 Strategy 草稿，不在对话背后回测。Factor profile 的探索分析工具保持独立边界。

## 目录职责

| 位置 | 职责 |
| --- | --- |
| [core.ts](core.ts) | 模型/工具循环、工具白名单、产物校验与修复；只接收 profile 和模型接口，不导入业务 profile |
| `profiles/` | Research、Factor、Strategy 和问答的提示词、可用工具与产物校验 |
| [turns/run.ts](turns/run.ts) | 后台执行顺序、模型 hooks、消息收尾及事件发布 |
| [turns/bus.ts](turns/bus.ts) | 同步注册、订阅快照、增量、取消、终态 TTL；进程重启后内存状态丢失 |
| [turns/records.ts](turns/records.ts) | 创建 turn 与用户消息、事务提交回复/Research 产物/终态、启动时标记 interrupted |
| [turns/trace.ts](turns/trace.ts) | 按序积累模型/工具/校验轨迹，串行保存 checkpoint，提供 flush |
| [conversations/manage.ts](conversations/manage.ts) | 查找/创建实体关联的对话，首次导入既有历史；Research 只复用有效对话 |
| [conversations/entity-messages.ts](conversations/entity-messages.ts) | 读取实体历史及保留 Strategy/Factor 的 messages 镜像；已发布因子的镜像不可写 |
| [conversations/schema.ts](conversations/schema.ts) | parts 消息入参校验；图表规格引用 charts/spec，保持公开消息契约 |
| `tools/charts/` | SQL 图表、计算图表、规格与列校验；不负责 Research 的图表产物 |
| `tools/sql/` | SQL 白名单、查询限额/超时、只读 Worker 和 Node SQLite 类型声明 |
| `tools/` 其余具名文件 | 已有数据查询、研究提案、因子分析等工具；工具注册仍由 `tools/index.ts` 组织 |

## 读懂一次持久化 turn

1. 业务检查权限/忙碌状态，调用 `enqueueAgentTurn` 同步注册 bus，再启动后台执行。
2. 读取历史，查找或创建 conversation；事务中创建 running turn 和用户消息；随后更新 Strategy/Factor 的 messages 镜像。
3. 调用 core，发布增量与工具事件，trace recorder 串行写入 checkpoint。
4. 成功时先写实体回复镜像、flush 轨迹，再在事务中保存 assistant 消息、Research 提案/澄清及 turn 终态。
5. 上述持久化完成后发布 `done`，最后触发异步 `afterTurn`（例如因子元数据刷新）。失败或取消不保存 assistant 回复，记录对应终态并发布事件。

**这些步骤并非一个总事务。** 创建 conversation、开始 turn、实体镜像和完成 turn 保留原边界，不为目录整理扩大事务。Research 提案/澄清、所属消息与完成状态仍在同一个完成事务中。`bootstrap.ts` 调用 `markRunningAgentTurnsInterrupted` 恢复数据库中的运行记录；它不会重放模型调用或重建内存事件。

## Worker 与验证

SQL Worker 使用 Node `DatabaseSync` 的只读连接；主线程负责超时和重建。相对 `DATABASE_URL` 必须继续相对 `apps/api/prisma` 解析，迁移目录时已同步这一资源路径。SQL Worker 保留源码 `.boot.mjs` 与编译 `.js` 入口。

2026-09-10 已删除快速回测工具、专用 Worker 和对应测试，旧工具名会被通用工具白名单拒绝；不迁移或删除历史对话轨迹。决策与本次验证记录见 [Agent 研究闭环](../../../../docs/design/agent-research-loop.md)。以下 Commit 10 记录反映退役前的迁移验收。

Commit 10 迁移时保留 core、profile、bus、Research 产物持久化、SQL、图表和快速回测测试。新增 [routes.integration.test.ts](routes.integration.test.ts) 的 7 个隔离 SQLite + Hono 场景覆盖历史分页/归属、SSE 重连/取消、真实 runner 的用户消息→模型→回复→done 顺序、失败/重启恢复、完成事务回滚与图表响应映射。只替换模型和 SQL/计算图表调用，其他链路使用实际实现；不会访问外部模型或开发数据库。

Commit 10 已通过人工 review、201 个文件/1083 项全量 API 测试、Shared/API 构建及 Web 类型检查；源码/编译的真实 SQL、计算图表和快速回测 Worker 验证通过，结果一致且线程/数据库连接已释放。完整记录见 [开发计划](../../../../docs/design/backend-architecture-refactor.md#710-commit-10-实现记录2026-09-09)。

SQL 调用方超时门槛为 10 秒；正在执行原生 SQLite 查询时，Worker terminate 可能延迟到原生调用返回，不能把接口超时理解为 CPU/线程已立即回收。本次保留既有行为，验证中已确认受控慢查询的原线程最终退出，后续查询能重建线程。


## HTTP 路由整理（2026-09-11）

七个接口分别归 `conversation-routes.ts`、`turn-routes.ts`、`chart-routes.ts`。详情使用 `GET /turns/:turnId`，活动查询使用 `GET /turns/active?entity=`，先注册保留路径再注册通用 ID。活动查询仍返回 `{ turnId }`，无活动时 turnId 为 null；SSE 路径、快照/重连/取消、错误帧与非 GET 兜底保持原语义。

删除未使用的 `GET /conversations` 和 `listConversations`；保留会话存储、归属检查和消息分页。SQL/图表使用 `/sql-queries` 和 `/chart-computations`，继续直接返回 `{ rows }`，不增加 Job 或查询持久化。白名单、限额、Worker、JSON BigInt 转换和错误映射保留。

静态检查与待执行验证见 [统一路由记录](../../../../docs/design/api-route-naming.md#剩余模块路由整理2026-09-11)。人工代码审查后，相关 116 项测试、API/Web 构建和六组浏览器验收全部通过。临时服务、端口和数据库连接已释放，测试数据库已清理；完整结果见统一路由记录。
