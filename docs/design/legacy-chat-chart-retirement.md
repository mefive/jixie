# 旧聊天图表执行链整体退役

状态：范围、准确提交信息及人工代码 review 已获用户确认，必要验证全部通过。
提交信息：`chore(agent): retire legacy chat chart execution`。

## 交付行为

旧聊天图表不再重查或运行 JS 变换。打开已有 Strategy / Factor / Research 消息时，
原 `chart` part 在读取边界投影为 `RetiredChartPart`：只包含 `type: retired_chart` 和最多 120 字符的标题。
前端显示原标题及中英停用提示，提示用户在 Research 中重新分析；没有请求、加载态、canvas 或重绘按钮。
不做数据库迁移、批量清理或重新计算，不将当前数据伪造成旧图表点位。

新计算继续使用嵌入式 Research Python 的持久化运行和输出；现有 Research 图表、正式因子评估和策略回测保持。
只读 SQL 工具与 Worker、SQL 白名单和 `math/stats.ts` 继续服务当前业务。

## 完整删除范围

- Web ChatChart 组件／样式及 agentSql / agentComputeChart 请求函数。
- Agent `POST /sql-queries` 和 `POST /chart-computations`，chart 路由、查询／结果规格及专用错误／文案。
- analyze-sandbox、图表 replay、loadIsolatedModule / callJson、统计库源码注入、旧 isolate 初始化／日志设施。
- Shared ChartSpec、SqlChartSpec、ComputeChartSpec、SQL 图表响应、chart 请求契约及根导出。
- Agent 工具结果／核心结果中的 AgentChart、chart/charts 字段及消息生成分支。
- 专用旧执行测试、computed-chart E2E 及统一命令登记。

读取旧消息只保留明确的退役识别，不保留可执行规格或执行兼容层。消息归一化不读取 `chart` 内容，
不修改传入原对象；Strategy / Factor / Research 的读取投影与前端均使用同一 shared 归一化函数。
新请求只允许严格的标题型退役提示，旧可执行 chart part 和额外 SQL/code 字段不再属于请求契约。
现有写入仍沿用自身生命周期；本轮没有主动改写存量记录。

## 共用能力的归属

[compile.ts](../../apps/api/src/infra/runtime/typescript/compile.ts) 只保留 toCommonJs，
Factor / Strategy prepare 与因子检查继续复用；源码转换的错误类别与签名不变，不创建 isolate 或执行源码。
TS 执行依旧使用 TypeScriptTransport，因此 isolated-vm 依赖保留。

ResearchChartKindV1 与 ResearchChartSeriesV1 直接归 shared/research，保留原 kind、column、label、type、yAxis 字段。
Research Python SDK 方法、生成声明和输出 JSON 没有变更；不新增包、第三方依赖或 workspace。
既有部署清单的 shared 前缀覆盖跨端影响，无跨包构建依赖变化。

## 验证与交付门禁

审查前仅运行全仓 typecheck、生成物一致性、后端边界扫描、lint、format、引用／文档链接和 diff 静态检查。

准备的行为验证包含：

- 旧 SQL／计算／不完整消息归一化、标题边界、输入不变及归一化幂等；新请求拒绝执行规格。
- 两个退休接口返回 404，并且不触发只读 SQL；既有 Agent、对话持久化、Research、SQL 与数值业务回归。
- Factor / Strategy 的源码转换和源码／编译入口；shared / API / Web / Docs 构建与部署计划自测。
- 隔离库与受控模型的中英嵌入分析 E2E：Python 计算、Research 留存及 Strategy 输出继续可用；
  打开／刷新旧聊天只显示三条标题和停用提示，监听旧重算接口请求计数始终为零。
- 逐张查看中英 `legacy-chat-chart-retired-{zh,en}.png` 并直接展示；结束时关闭临时服务、浏览器和数据库。

### 静态检查结果

- `pnpm typecheck` 通过：shared / API / Web / Docs / sandboxd 全部通过，SDK 生成物一致。
- 后端边界扫描 883 个文件、3283 条运行时边、859 条类型边，0 违规。
- 本轮全部 TS / TSX / MJS 的 ESLint 和全部格式化文件的 Prettier 检查通过。
- 修改的 E2E 与命令登记脚本 `node --check` 通过；删除执行器、请求函数与旧契约的源码引用检查通过。
- 本轮 Markdown 的 152 个相对文件链接有效；`git diff --check` 通过。

### 审查后验证结果（2026-10-09）

- 相关 API 回归 37 个文件、418 项通过：消息退役、新请求拒绝执行规格、旧接口 404、Agent、业务读取、
  嵌入分析、Research SDK 图表、SQL 校验、数学库、Factor/Strategy 编译与运行。
- 真实 Factor/Strategy/Signals/Scan Worker 的源码和编译入口各 14 项通过；编译 Factor 三种计算类型的入口及 SDK 3 项通过。
- 保留的真实 SQL Worker 源码与编译入口 2 项通过：返回合成行情、存量数据不变、子进程退出并关闭数据库连接。
- 后端边界检查器、部署影响计划、E2E 命令目录及调度清理自测 54 项通过。
  首次目录自测发现已有 futures-signals 验证脚本漏登记；仅补齐验证命令登记及隔离运行前提，复查通过。
- Shared / API / Web / Docs 构建全部通过。清理本地 dist 中对应已删除源码的 16 个旧生成文件后，编译入口复查通过。
  Web / Docs 仍有既有的大 chunk 提示，构建成功。
- 公开帮助检查通过：每种语言 100 篇文章、865 个内部链接、193 张引用图片、29 项学习证据。
- 中英 `embedded-analysis` 浏览器流程通过：真实 Python 表格／图像、派生版本、Research 留存、Strategy 分析；
  打开及刷新旧对话显示三条退役提示，旧重算请求计数为零，无 canvas、浏览器错误或外部请求。
- 本轮 8 张中英截图均已逐张检查；最终交付直接展示 `legacy-chat-chart-retired-zh.png` 与 `legacy-chat-chart-retired-en.png`。
  临时 API／受控模型端口在退出后拒绝连接，浏览器、Python、数据库及 fixture 子进程全部关闭。

Python 验证使用本地 3.13.3 环境；Matplotlib 缓存放在临时可写目录，避免首次字体扫描影响验证。
E2E 使用隔离迁移 SQLite、合成报告与受控模型，不调用外部模型或行情服务，不改写开发数据库。

审查和行为验证已完成，按预定提交信息自动提交，不 push。
