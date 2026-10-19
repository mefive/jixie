# Agent 代码修改审阅

## 产品契约

Research、Factor 和 Strategy 的生成结果均是修改建议。生成完成不改变当前代码；后端先保存待审修改，前端在对应助手消息中显示卡片。用户点击查看，只读 diff 弹窗才打开；关闭保持待审。只有明确接受，后端才更新业务内容并记录接受，分析和回测仍需另行发起。

待审修改不是用户已接受的因子／策略草稿。保存前后源码、来源消息和接受状态用于审阅及刷新恢复，不新增接受或撤回聊天消息。Research 仍允许拒绝尚未应用的提案；新流程没有先应用后撤回的审阅状态。

## 实施范围与批准记录

2026-10-19 已批准三类工作台、后端持久化、共享契约、生成迁移、双语帮助及相关测试的一个完整变更。

约定提交信息：`feat(agent): require explicit acceptance of generated code changes`。

2026-10-19 人工代码审阅通过，获准运行行为验证，并在全部通过后按约定信息提交。

## 后端边界

| 位置 | 职责 |
| --- | --- |
| Agent core 与业务 profile | 提取完整代码并使用既有编译／运行时检查；只读问答不产生源码提案 |
| Factor／Strategy agent/turn | 捕获本人宿主保存状态身份与生成时的编辑器源码，传给后台轮次 |
| Agent turns/records | 在保存助手消息及 turn 终态的同一事务中保存代码提案，再通知完成 |
| Agent conversations/code-proposals | 提案身份、归属读取、接受状态和来源消息同步；不写 Factor／Strategy 代码 |
| Factor agent/code-proposals | 接受时检查本人草稿、保存基准、编辑器基准和气象固定约束，再原子更新代码及提案 |
| Strategy agent/code-proposals | 接受时检查本人策略与双基准，保留最新其他配置，保存代码及语言，清理旧结果缓存；保留因子引用导致私有的规则 |
| Research proposals/cell-changes | 现有显式 apply 即接受；在更新 Cell 的事务中标记 accepted，不创建开放审阅 |

代码身份仅包含会影响代码含义的保存状态：Factor 源码、语言、runtimeVersion 和 analysisKind；Strategy 源码、语言和 runtimeVersion。消息更新和显示名变化不会误报源码冲突。Strategy 在生成后修改的资金、区间等其他配置不被接受动作覆盖。

生成时编辑器可含尚未提交的 Strategy 源码，因此编辑器基准与数据库基准分别留存。前端接受前检查当前源码及语言，后端接受时再次检查请求所比较的源码和数据库身份。发生冲突返回 409，当前源码和待审记录保持原状；本次不做自动合并。

Factor／Strategy 的 SSE `done` 包含 `code_change` 消息产物。兼容字段 code 返回生成前代码，changed 为 false，避免旧客户端按完成事件自动写回建议。内部同步代码生成器和研究交接保持既有明确创建语义。

后续对话会单独附上最近待审建议（至多 48000 字符，超出显式标记截断），作为未接受的参考；当前源码仍是权威，不把待审建议冒充已应用内容。

因子名称及说明不再因尚未接受的生成结果自动刷新；现有显式元数据刷新入口保留。

## 存储与接口

`AgentCodeChangeProposal` 保存本人宿主身份、来源 turn／message、语言、保存基准身份、编辑器基准源码、建议源码、pending／accepted 状态及时间。每个源码生成轮次最多一条。来源消息和 turn 的外键负责关联与清理；此表含用户源码，不进入只读市场 SQL 白名单。

迁移 `20261019010000_agent_code_change_proposals` 仅新增该表及索引／外键，不重写历史消息或 Research 提案。SQL 由 Prisma schema diff 静态生成；未修改生成 SQL，未应用到开发／生产库。

| 方法与路径 | 用途 |
| --- | --- |
| GET /api/app/factors/:factorId/code-change-proposals/:proposalId | 本人因子提案读取 |
| POST /api/app/factors/:factorId/code-change-proposals/:proposalId/accept | 接受因子修改，Body 为 beforeCode |
| GET /api/app/strategies/:strategyId/code-change-proposals/:proposalId | 本人策略提案读取 |
| POST /api/app/strategies/:strategyId/code-change-proposals/:proposalId/accept | 接受策略修改，Body 为 beforeCode |
| POST /api/app/research/cell-change-proposals/:proposalId/apply | 沿用既有显式接受接口，更新 Cell 并记录 accepted |

接受请求只能引用服务端已校验的候选，不接受调用者注入 afterCode。重复接受返回同一条接受记录，不重复写代码、不重复追加消息。实体详情与下一轮消息历史优先读取持久化 AgentMessage，无会话的旧对象读取原镜像，并从独立提案记录补齐权威状态，避免历史消息镜像将 accepted 显示回 pending。

新提案不再提供 Research POST /cell-change-proposals/:proposalId/review。已有 review/accept 和 review/revert 仅处理升级前已应用的开放审阅；旧记录仍保持原始来源及处置历史，不自动接受或恢复。

## 前端行为

Factor／Strategy 使用共享消息卡片和只读 Monaco diff。请求均经业务 API 模块与 LoaderModel；弹窗开关留在组件内。接收 done 只更新消息，不改编辑器、不触发自动保存。接受成功后使用后端保存的源码更新编辑器；请求期间若用户继续编辑或切换对象，不覆盖新的本地内容。

Research 使用现有多 Cell diff modal，在其中提供“接受修改”；不再收到结果后自动应用或进入行内编辑式审阅。关闭 diff 不写数据；既有旧版开放审阅界面仅负责历史处置。接受导致的依赖 stale／blocked 继续沿用现有业务规则。

## 验证计划

| 验证 | 覆盖 |
| --- | --- |
| 静态检查 | 变更文件 Prettier／ESLint、全仓 typecheck、后端依赖边界、SDK／runtime 生成物一致性、Prisma schema、迁移生成一致性、E2E 脚本语法和 diff 空白 |
| Agent 回归 | 独立保存先于 done、生成不改变宿主、刷新读取、双基准冲突、跨用户／跨对象拒绝、请求不能替换候选、重复接受不新增消息、纯问答无提案 |
| 业务回归 | Factor 发布后拒绝修改，Strategy 其他参数保留和旧缓存失效，Research 接受时才写 Cell、重复接受、历史审阅接受／恢复及执行约束 |
| 浏览器 | agent-code-review 隔离数据库、真实 HTTP；三类页面不自动弹窗，查看／关闭不改内容，刷新仍待审，明确接受后持久化并保留状态 |
| 构建与资源 | shared/API/Web/Docs 构建；隔离库应用迁移；验收截图检查；关闭临时服务、确认端口及数据库连接释放 |

浏览器使用确定性生成物，不评价 LLM 输出质量；模型提取与校验顺序由 Agent 集成回归覆盖。

## 当前验证记录

2026-10-19 静态检查通过：

- `pnpm typecheck`：shared、API、Web、Docs、sandboxd 通过；后端边界 896 个文件、0 违规；SDK／runtime 生成物一致。
- 52 个变更源码／样式文件已格式化；适用源码 ESLint 通过，0 警告。
- Prisma schema 校验通过；重新生成 schema diff 与提交候选 migration.sql 逐字一致。
- 变更 E2E 脚本语法、11 份文档的相对链接及空白、提交信息格式和 `git diff --check` 通过。

人工代码审阅通过后的验证结果：

- 8 个单元／集成测试文件共 189 项通过：Agent core、新提案真实 SQLite 集成、Agent 路由、Factor／Strategy 路由、Research 路由及生命周期、共享请求契约。
- 全仓构建通过（shared、API、Web、Docs、sandboxd）；Vite 保留现有大 chunk 提示。
- 最终全仓 typecheck 通过；后端边界检查器 36 项自测通过，896 个文件扫描 0 违规；E2E 注册与运行器 8 项自测通过。
- `pnpm e2e agent-code-review` 使用新建隔离 SQLite 库完整应用迁移，真实 HTTP 与 Chromium 验收三类页面：不自动打开 diff、查看和关闭不写源码、刷新恢复待审、接受后落库、刷新保留已接受状态；Factor／Strategy 编辑器显示接受后的源码，Research 不自动执行。
- 三类 diff 及接受后的 6 张截图保存在 `apps/web/acceptance/agent-code-review-*.png`，已逐张检查。浏览器没有未处理页面错误；测试服务器正常退出，端口释放且 Prisma 断开后清除隔离数据库。
- 最终暂存区检查保留 Prisma 生成 SQL 自带的文件末尾空行（不手工修改生成迁移）；其余 diff 空白检查通过。

验证中仅修正测试夹具：显式创建 SQLite 文件、完整清理无用户外键的宿主数据、更新 Factor 入队预期、使用合法宿主 ID、补齐研究窗口依赖、使用 Research 文档深链接进行刷新，并等待编辑器加载后截图。没有修改已审阅的产品代码。未对开发／生产库执行迁移。

验证通过后按约定自动提交；原有未跟踪的 API 全景审阅文档不纳入本次提交。
