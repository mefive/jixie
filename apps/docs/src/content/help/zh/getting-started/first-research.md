# 第一次完成量化研究

研究工作台把问题、公式、Python 计算、表格和图表放在同一份响应式文档中。你可以自己写 Python，也可以让
Research Agent 帮你选择数据、生成代码和解释真实输出；不需要编写 SQL 或 TypeScript。

## 开始研究

1. 打开顶部“研究”。
2. 在输入框写下要验证的问题并提交。研究工作台会创建文档，并把问题交给 Research Agent。
3. 在 Markdown Cell 检查和补充问题、事前假设、公式、变量定义和限制。
4. 在 Python Cell 使用 `data.series()` 读取单个对象的时间序列，或使用 `data.cross_section()` / `data.panel()`
   读取 PIT 股票截面和月末 Panel；计算可以使用 pandas、NumPy、SciPy 和 statsmodels。
5. 使用 `charts.*` 生成 jixie 原生交互图，或使用 Matplotlib 生成静态图。
6. 运行当前 Cell、受影响分支，或在干净环境完整运行全文。完整运行会保存不可变 `ResearchExecution`，可在
   文档运行历史中回看和显式封存为研究版本。

Cell 源码由文档级自动保存保护；状态会显示未保存、保存中或已保存。修改上游源码后，依赖它的下游结果会变成
stale，不会在后台自动执行昂贵计算。

## 与 Research Agent 协作

Agent 可以补充统计方法和公式、查询准确的 Research SDK、修改 Markdown/Python Cell，并基于真实输出解释结果。
它提出的变更会进入 Cell 内联审核：旧行保持只读，Agent 新增或修改的内容可以继续编辑。Accept 以用户最终编辑的
版本为准，Undo 可以恢复审核前内容；提案本身不会运行 Cell。

Agent 不能把未运行的代码说成已经计算，也不能用文字替代代码和输出。缺少精确对象、数据、SDK 或方法时，它必须
说明能力缺口，不能静默换成相似数据。

## 将研究送往正式验证

如果成功封存的版本包含一个明确、由平台数据能力支持的时点信号，可以从快照创建 Python Factor 草稿。LLM 先判断
研究能否转换，再由 Factor 编译器和 `py-v1` 运行时校验代码。Factor 保留来源快照、提炼摘要和待验证项，并可精确
回跳；研究中明确且受支持的股票池、日期、频率、过滤条件和事前方向会成为 FactorReport 建议参数。用户仍需确认
参数并显式运行报告，系统不会自动揭示 Holdout、发布 Factor 或把探索结论当成正式证据。

如果研究还明确了标的或股票池、信号方向、调仓或进出场条件和仓位规则，也可以生成 Python Strategy 草稿。草稿
默认使用 `py-v1`，不会自动运行回测；需要在 Strategy Lab 检查代码、区间、资金和成本后显式运行。只有预测关系而
没有组合与交易规则的研究会被要求先进入 Factor。

## 研究一个股票池

也可以直接描述横截面条件，例如“找最新可得时点 PE TTM 小于 20、按总市值降序的 A 股”。UniverseSpec 会保存：

- 数据时点和历史指数成分时点；
- 上市天数、停牌和风险警示处理；
- 指标版本、单位、缺失值、过滤和排序；
- 数据 revision 与各资格阶段的样本数。

点击结果表中的对象可以打开统一对象详情页。重新运行会使用同一份 Spec 和当前可得数据；若上游数据修订，revision
会明确变化。

> 统计关系和条件匹配都不是买卖建议。先确认变量定义、时间方向、样本范围、稳健性和可执行限制。

[打开研究工作台](/research)

## 继续学习

- [建立研究文档和 Cell](/docs/help/research/document-cells)
- [使用研究数据目录](/docs/help/research/data-catalog)
- [与 Research Agent 协作](/docs/help/research/agent-collaboration)
- [将研究交给 Factor 或 Strategy](/docs/help/research/handoff)
