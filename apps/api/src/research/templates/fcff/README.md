# FCFF 模板、分类证据与案例

[valuation-template.ts](valuation-template.ts) 的 `equityFcffValuationTemplate` 由上层 templateDefinition 选择，组合透明的 Markdown / Python Cell 源码，包含参数、财务数据选择、历史检查、经营假设、估值情景、敏感度和复核。函数生成文档内容，不执行估值或写数据库。

[replay-cases.ts](replay-cases.ts) 的 `EQUITY_FCFF_REPLAY_CASES` 与 `equityFcffParameterSource` 维护回放案例及参数源；[classification-evidence.ts](classification-evidence.ts) 的 `equityFcffClassificationSource` 为案例附上分类依据；[classification-template.ts](classification-template.ts) 组织调整／对账源码；[evidence-template.ts](evidence-template.ts) 组织证据展示源码。这些是可审阅、可修改的研究假设，不是系统对所有公司的固定投资结论。

财务数据及可得性由 [datasets/financial](../../datasets/README.md) 和 Market fundamentals 定义，FCFF 数学计算由 Python SDK 对应实现承担。改选期或分类时保留证据来源、适用期和与报表的对账；不能只修改最终展示数值来掩盖缺失数据。

阅读 [valuation-template.test.ts](valuation-template.test.ts)、[evidence-template.test.ts](evidence-template.test.ts)、[replay-cases.test.ts](replay-cases.test.ts) 可定位各类源码约束。回到 [模板选择](../README.md)。

[返回 Research 总览](../../README.md)
