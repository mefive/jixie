# Agent 研究闭环

> 2026-07-31 制定，对应 `ROADMAP.md` 中期 B。目标是让策略 / 因子 Agent 在同一轮对话里执行候选研究、读取紧凑结果并据此修改代码，同时保留现有沙箱、归属校验和研究纪律。

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
