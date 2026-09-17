# 冻结因子血缘与利率准入

Strategy 负责准备可执行因子；这里负责 Signals 对报告、部署和单次运行快照的核对，以及这些冻结依赖需要哪些利率数据。

[lineage.ts](lineage.ts) 的 `factorDependenciesFromJson` 解析持久化 JSON：null 保留为 null，数组逐项校验。`assertFactorDependencies` 比较规范化依赖（因子身份、名称、类型、源码哈希、批准报告与输入等），排序后比较，兼容缺省语言／运行版本。expected 为 null 时跳过比较，是旧快照兼容行为；部署入口对“报告无依赖但现有准备有因子”另加拒绝，见 [deployments](../deployments/README.md)。

[rates.ts](rates.ts) 的 `governmentYieldTermsFromDependencies` 从冻结 inputs 提取 rates.cgb.yield 期限，去重排序，不支持的期限拒绝。`governmentYieldCurveCoverageReady` 要求每个期限都有不晚于交易日的 availableDate，且不超过 14 个日历日。`governmentYieldCurveReady` 为入队查库，无相关依赖时直接通过；Market 的 availability 读取只返回存在的数据，缺失期限由这里判定失败。每日同步也消费同一份期限提取结果。

[summary.ts](summary.ts) 的 `summarizeFactorInputs` 由 signal Worker 调用，把捕获的因子输入与信号／持仓使用情况整理成运行展示摘要；不重新计算因子或改变冻结血缘。

改兼容比较看 [lineage.test.ts](lineage.test.ts)，改期限和窗口看 [rates.test.ts](rates.test.ts)，改展示摘要看 [summary.test.ts](summary.test.ts)。数据身份及可得日实现分别见 [Market registry](../../market/registry/README.md)、[rates](../../market/rates/README.md)。

[返回 Signals 总览](../README.md)
