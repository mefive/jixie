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
6. 运行当前 Cell、受影响分支，或在干净环境完整运行全文。查看文档中的当前输出，修改后重新运行。

Cell 源码由文档级自动保存保护；状态会显示“待保存”“保存中…”或“已保存”。修改上游源码后，依赖它的下游结果会变成
stale，不会在后台自动执行昂贵计算。

## 选择数据和起点

点击“数据目录”可以选择对象、日期、频率和字段，并插入 SDK 调用，无需先记住方法名。研究公司财报时，先看[自主分析财报数据](/docs/help/research/financial-data)；FCFF 是首页可选模板，不是所有财务研究的必经步骤。

如果已经在 Factor 或 Strategy 对话中建立[嵌入式分析](/docs/help/research/embedded-analysis)，可在任务结束后“继续到 Research”。副本复制当前代码和参数，运行时重新取数。

左侧“当前”和“已归档”列表用于管理研究，搜索框匹配标题或最近内容。归档、恢复和永久删除的区别见[研究文档与运行记录](/docs/help/research/records)。

## 读取已有 FactorReport

从 Factor 当前报告或保留报告链接复制报告 ID 后，可以在 Python Cell 只读加载其结果。普通旧报告会在重跑时清理，已发布版本绑定的报告继续保留：

```python
factor_report = results.factor_report("报告 ID")
rank_ic_mean = factor_report["report"]["ic_mean"]
```

返回的报告与参数字段使用 snake_case。该方法不会修改或重新运行报告；只能读取本人的已完成报告。

## 与 Research Agent 协作

Agent 可以补充统计方法和公式、查询准确的 Research SDK、修改 Markdown/Python Cell，并基于真实输出解释结果。
它提出的变更会单独保存为待审提案。点击消息卡片查看只读 diff，明确接受后才修改 Cell；关闭弹窗保持待审。
当前内容已变化时不能覆盖。接受不会自动运行 Cell。

Agent 不能把未运行的代码说成已经计算，也不能用文字替代代码和输出。缺少精确对象、数据、SDK 或方法时，它必须
说明能力缺口，不能静默换成相似数据。

存在有明确差异的可执行代理时，Agent 会先要求确认研究口径。选择前普通输入和 Cell 提案会暂停；确认记录会在刷新
后保留，但它不会让代理自动变成原对象的等价物。

## 将研究送往正式验证

在 Factor 或 Strategy 工作台手动创建草稿、整理算法并审查代码，然后明确发起分析或回测。Research 不再提供封存和自动生成草稿。

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
- [回答研究口径确认](/docs/help/research/clarifications)
- [读取美国国债收益率曲线](/docs/help/research/yield-curves)
- [理解 Factor 保留报告](/docs/help/factors/report-history)
- [将研究交给 Factor 或 Strategy](/docs/help/research/handoff)
