# 横截面评估与共享序列

这里从股票截面／历史数据求因子序列，再形成统计报告。正式报告生命周期在 [evaluations](../../evaluations/README.md)，上层分派在 [execution](../README.md)。

| 文件 / 入口 | 消费者与责任 |
| --- | --- |
| [evaluator.ts](evaluator.ts) `factorEvaluatorFor`、`CrossSectionalEvaluator.evaluate` | run 的横截面适配；将研究配置传给 `analyzeFactor`，不是四类评估器的通用注册表 |
| [evaluate.ts](evaluate.ts) `analyzeFactor` | 组合数据准备、因子序列、范围／中性化、IC、分层和报告统计；返回计算结果，不写 FactorReport |
| [data.ts](data.ts) `getRebalanceDates`、`loadSnapshots`、`loadFinaIndex` | evaluate 与相关性计算共享的数据库加载；`finaAsOf`、`industryOn` 在历史时点选值 |
| [series.ts](series.ts) `computeFactorSeries` | evaluate 与 correlations/compute 直接使用；根据来源和历史数据运行因子，返回序列及覆盖审计，并收尾运行资源 |
| [policy.ts](policy.ts) `analysisPolicy`、`applyOutlierPolicy` | 旧版本与当前协议的政策选择和离群处理 |
| [inference.ts](inference.ts) `buildCrossSectionalRobustInference` | 稳健推断及 Fama–MacBeth 等分析，消费已准备数据，不拥有任务状态 |

相关性只复用 data/series，不调用完整 `analyzeFactor`，因此不会附带正式报告或整套统计后处理。新增共享计算也应从真实输入和消费者确定入口，不能让相关性绕到报告提交。

改 PIT／行业／范围先读 data、[evaluation-scope.ts](../evaluation-scope.ts)；改公式执行和覆盖看 [series.test.ts](series.test.ts)；改方法政策看 [policy.test.ts](policy.test.ts)；改推断看 [inference.test.ts](inference.test.ts)；适配关系看 [evaluator.test.ts](evaluator.test.ts)。方法背景见 [横截面推断设计](../../../../../../docs/design/factor-cross-sectional-inference.md)。

[返回 Factor 总览](../../README.md)
