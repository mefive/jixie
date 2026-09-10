# Agent 研究闭环

> 2026-07-31 制定，对应原 `ROADMAP.md` 中期 B，当前归入已完成基础 C。2026-09-10 调整策略执行边界，快速回测部分已退役；Factor 探索分析保持原有流程。当前决策以下节为准，原设计保留用于追溯。

## 当前决策：策略回测回到工作台（2026-09-10）

Strategy 工作台的主流程是生成/修改代码 → 用户核对代码和运行参数 → 显式回测 → 查看报告与继续修改。
对话内快速回测会等待完整交易模拟和风险计算，却只把紧凑指标交给模型；候选代码可能与最终交付不同，用户
仍需再次运行。这条路径增加等待与重复计算，也把同一次研究的代码和结果拆在对话轨迹与工作台两处。

因此删除 `runQuickBacktest` 工具、`agent/tools/quick-backtest/` 实现与专用 Worker，不提供替代的隐藏回测入口：

- Strategy Agent 依据 SDK、当前代码和数据上下文编写/解释策略，保留标的、数据覆盖、编译和既有受限运行时校验；校验通过不等于回测通过。
- 完整交易模拟、任务进度和报告继续走用户在工作台显式发起的回测入口；Agent 不用 SQL 或通用分析工具重写撮合引擎。
- Research 保留可见 Markdown / Python Cell 的统计探索。明确且受支持的交易规则，通过成功封存的 ResearchExecution 生成 Strategy 草稿，再由用户回测。描述性研究不强制转成策略，也不补造缺失的交易规则。
- Factor profile 的 `runFactorAnalysis` 等探索分析能力不受此次调整影响；HTTP、SDK、数据库、历史对话与历史工具轨迹均保持。

实现涉及 Strategy profile 及其对话/Research 草稿调用方、Research 提示词、工具白名单回归测试和双语帮助。
移除专用帮助文章及导航入口，现有“继续修改策略并重新运行”和“研究交接”说明统一承担操作指引。

### 本次开发与验证记录

- 提交信息：`refactor(agent): 移除策略对话快速回测`。
- 范围与产品代码均经用户确认，按预告提交信息完成交付；行为验证未发现需要修改产品实现的问题。
- 静态检查通过：变更文件 ESLint/Prettier、全仓 `pnpm typecheck`（Shared/API/Web/Docs/sandboxd、Research runtime/SDK 与 Factor SDK 一致性）、架构边界 0 violations、`git diff --check`、Docs E2E 脚本语法检查。静态核对 198 个帮助 Markdown 导入与修改文章中的 12 条链接，产品源码/脚本/部署配置没有旧工具实现引用。
- 行为验证通过：7 个文件、59 项测试，覆盖 `agent/core`、Strategy/Research profile、Strategy HTTP 与正式回测入口、Research Strategy handoff/drafts。Factor profile 的探索工具注册与 Python 产物校验也由 core 用例验证。使用模型替身，涉及写库的测试使用独立数据库，没有真实 LLM 调用或开发数据库写入。
- `pnpm --filter api build`、`pnpm --filter docs build` 均通过；Docs 仅输出既有的大 chunk 体积提示。
- 帮助验收通过：构建文档站的中英文修改指南/研究交接共 4 个页面状态、新职责说明、旧链接缺席及旧地址的现有兜底跳转均正常，无页面异常或业务 API 请求。已目视检查 4 张截图；定向验证脚本、结果与截图位于 `/tmp/jixie-quick-backtest-retirement/`。本轮未运行依赖完整业务服务的全量 `apps/docs/e2e/help.mjs`；其中旧文章点击已改为新说明和旧链接缺席断言。
- 环境与收尾：首次静态预览监听及 Chromium 启动受沙箱限制，获得本地验收权限后重跑通过。临时预览服务和浏览器已关闭，4178 端口已释放；隔离数据库由测试 teardown 清理，测试进程均已退出。

## 2026-07-31 历史设计（快速回测部分已退役）

当时的目标是让策略 / 因子 Agent 在同一轮对话里执行候选研究、读取紧凑结果并据此修改代码，同时保留现有沙箱、归属校验和研究纪律。以下策略快速回测行为不再代表当前产品能力。

## 边界

- `runQuickBacktest` 只运行冻结的候选策略快照。它不提交 `Strategy.config`，不覆盖正式 `lastResult`，不部署，不生成信号或订单。
- `runFactorAnalysis` 只创建 `phase=explore` 的不可变报告。它必须先冻结研究卡、代码、样本和分析口径；不提供 holdout、reveal、finalize 或 deploy 工具。
- 两个工具都只存在于对应实体的 profile：策略 Agent 看不到因子运行工具，因子 Agent 看不到策略运行工具，Screen / Q&A 仍只有只读工具。
- 研究执行是受限副作用，不把通用写接口交给模型。工具仍通过实体 owner scope、zod 输入校验、worker 沙箱和既有数据口径。

## 长任务进入对话流

Agent turn 本身已经是服务端后台任务并通过 SSE 报告 `tool_start` / `tool_done`，因此 v1 采用“工具调用等待 worker / Job 终态，再把紧凑观察回灌模型”的形态：

1. 模型提交冻结候选与参数。
2. 工具启动隔离 worker；因子分析同时创建既有 durable Job + FactorReport。
3. SSE 保持工具运行态。页面刷新仍可重订阅当前 turn；用户取消 turn 时，纯试算 worker 被终止，已经创建的 durable 因子 Job 可独立完成。
4. 完成后只把指标摘要送回模型，完整大结果不进入上下文。工具参数和观察写入 `AgentTurn.trace`，供审计。
5. 模型根据观察输出解释和完整候选代码，仍经过既有编译修复。

策略快速回测不复用普通 `/backtest`，因为该入口会提交配置并覆盖正式结果；也不伪装成参数扫描报告。v1 的完整 NAV / 成交记录不进入对话，用户需要正式验收时仍在 Lab 运行并保存正式结果。

## 防止样本内过拟合

- prompt 明确要求同一轮通常最多比较两个实质不同候选，禁止机械穷举。
- 因子工具每次运行必须先声明 `mode`、假设、方向和主判据；研究卡与候选代码在指标产生前冻结。
- Agent 只能看 explore 窗口。holdout 是否启动、何时揭示仍由用户在因子页显式完成。
- Agent 不因单次好结果宣称可上线；最终答复必须区分“候选试算”与“正式回测 / holdout 验证”。

## 失败与恢复

- 参数、代码、数据或 worker 错误作为失败 observation 回灌，模型可以修正一次；不会破坏当前可工作的代码。
- turn 取消通过 `AbortSignal` 传到工具。快速回测立即终止 worker；因子 Job 若已落库则继续作为独立报告，避免留下半写状态。
- API 进程重启仍按既有约定把 Agent turn 标记为 interrupted。durable 因子报告可在因子页恢复；快速回测是可安全重跑的临时研究，不声称跨进程续跑。
