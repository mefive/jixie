# 因子代码模板

模板提供可解析的受控源码、目录展示与资产政策；它们不是数据库草稿，也不自行提交分析。上层目录见 [定义说明](../README.md)。

| 文件 | 消费入口与职责 |
| --- | --- |
| [time-series.ts](time-series.ts) | `TIME_SERIES_TEMPLATES` 提供初始代码，`timeSeriesTemplateCatalog` 提供展示元数据；时间序列模板不维护证券白名单，作者可输入有本地价格的 ETF 代码 |
| [panel.ts](panel.ts) | `PANEL_TEMPLATES` 提供初始代码，`panelTemplateCatalog` 提供展示元数据；执行来源从已保存 Factor 行读取 |

股票、时间序列和 Panel 模板源码只供 seed 初始化缺失版本；读取、分析、问答和嵌入上下文使用保存的源码；宏观和利率模板已退役。这些入口接收稳定 key 或 locale，返回目录元数据；未知 key 的处理以对应解析入口为准，不启动 Worker 或落库。源码、字段和资产政策共同组成模板可用范围，不能只改展示名称或放宽通用草稿校验来开放受控输入。

评估提交由 [evaluations](../../evaluations/README.md) 解析模板并决定截止日；[observations](../../observations/README.md) 准备真实输入。[seed.ts](../seed.ts) 需要的模板定义也来自这里，种子写入职责仍在上层。

修改某类模板先读同名实现及 [time-series.test.ts](time-series.test.ts)、[panel.test.ts](panel.test.ts)，再检查其观察数据测试；不能仅验证模板字符串存在。

[返回 Factor 总览](../../README.md)
