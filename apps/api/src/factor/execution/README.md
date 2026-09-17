# 共享因子评估计算

正式评估和天气复用这里的计算与 Worker；报告、Job、pin 和观察点的写入分别归 [evaluations](../evaluations/README.md)、[weather](../weather/README.md)。这里可以通过 loader 读取市场数据，不是纯函数目录。

## 入口与文件

[run.ts](run.ts) 的 `runFactorEvaluation` 是 Worker 调用的具名计算入口。输入是 factor 标识、冻结 source、spec、locale、日志及可选 onResult；返回横截面、时间序列、Panel 或宏观评估结果，不接收 reportId 或 Job，也不写业务终态。

| 实现 | 职责 |
| --- | --- |
| [worker.ts](worker.ts)、[worker.boot.mjs](worker.boot.mjs) | 接收 workerData，转发日志／结果／错误，最后断开本线程 Prisma；源码 boot 与编译入口见运行清单 |
| [spec.ts](spec.ts) | `normalizeFactorAnalysisSpec` / `normalizeFactorResearchSpec` 及默认配置，供提交、读取、模板等直接消费 |
| [cross-sectional](cross-sectional/README.md) | 横截面的数据、因子序列、方法政策、统计与稳健推断；data/series 同时供相关性使用 |
| [time-series-evaluator.ts](time-series-evaluator.ts)、[panel-evaluator.ts](panel-evaluator.ts)、[macro-regime-evaluator.ts](macro-regime-evaluator.ts) | 对相应观察数据形成评估结果；数值与频率规则留在各评估器 |
| [evaluation-scope.ts](evaluation-scope.ts) | PIT 指数成分、范围过滤及行业内排序规则 |

run 按 researchSpec 分派来源类型，组合 [observations](../observations/README.md) 和 [runtime](../runtime/README.md)。资产因子计算在 try/finally 中释放编译对象。onResult 保留在释放前调用的顺序；Worker 的 `reportId` 只是消息关联标识，天气可使用 `weather:*`，不要求存在同名数据库报告。

更改公共 Worker 时同时检查两个宿主如何接收结果、判断退出和保存终态；不要把天气改造成正式 Job。线程／资源路径以 [运行入口清单](../../../../../docs/backend-runtime-entries.md) 为主要维护位置。

修改分派看 [run.test.ts](run.test.ts)；配置看 [spec.test.ts](spec.test.ts)；范围看 [evaluation-scope.test.ts](evaluation-scope.test.ts)；算法看 [time-series-evaluator.test.ts](time-series-evaluator.test.ts)、[panel-evaluator.test.ts](panel-evaluator.test.ts)、[macro-regime-evaluator.test.ts](macro-regime-evaluator.test.ts) 与横截面测试。

[返回 Factor 总览](../README.md)
