# 共享因子评估计算

正式评估使用这里的计算与 Worker；报告和 Job 的写入归 [evaluations](../evaluations/README.md)。这里可以通过 loader 读取市场数据，不是纯函数目录。

## 入口与文件

[evaluate.ts](evaluate.ts) 的 `runFactorEvaluation` 是 Worker 调用的具名计算入口。输入是 factor 标识、冻结 source、spec、locale、日志及可选 onResult；返回横截面、时间序列、Panel 或宏观评估结果，不接收 reportId 或 Job，也不写业务终态。

| 实现 | 职责 |
| --- | --- |
| [worker.ts](worker.ts)、[worker.boot.mjs](worker.boot.mjs) | 接收 workerData，转发日志／结果／错误，最后断开本线程 Prisma；源码 boot 与编译入口见运行清单 |
| [spec.ts](spec.ts) | `normalizeFactorAnalysisSpec` / `normalizeFactorResearchSpec` 及默认配置，供提交、读取、模板等直接消费 |
| [cross-sectional](cross-sectional/README.md) | 横截面评估、方法政策、统计与稳健推断；共享取数和因子序列归 [observations/cross-sectional](../observations/cross-sectional/README.md) |
| [time-series-evaluator.ts](time-series-evaluator.ts)、[panel-evaluator.ts](panel-evaluator.ts)、[macro-regime-evaluator.ts](macro-regime-evaluator.ts) | 对相应观察数据形成评估结果；数值与频率规则留在各评估器 |
| [evaluation-scope.ts](evaluation-scope.ts) | PIT 指数成分、范围过滤及全局排序规则 |

runFactorEvaluation 按 researchSpec 分派来源类型，组合 [observations](../observations/README.md) 和 [sandbox](../sandbox/README.md)。资产因子经 FactorSandbox.start 创建，execute 批量计算，finally close 释放实例。onResult 保留在释放前调用的顺序；Worker 的 `reportId` 用于关联分析报告。

更改 Worker 时检查正式评估如何接收结果、判断退出和保存终态。线程／资源路径以 [运行入口清单](../../../../../docs/backend-runtime-entries.md) 为主要维护位置。

修改分派看 [evaluate.test.ts](evaluate.test.ts)；配置看 [spec.test.ts](spec.test.ts)；范围看 [evaluation-scope.test.ts](evaluation-scope.test.ts)；算法看 [time-series-evaluator.test.ts](time-series-evaluator.test.ts)、[panel-evaluator.test.ts](panel-evaluator.test.ts)、[macro-regime-evaluator.test.ts](macro-regime-evaluator.test.ts) 与横截面测试。

[返回 Factor 总览](../README.md)
