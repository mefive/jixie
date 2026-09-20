# 私有业务结果作为研究数据

这些 loader 由 sdk/dispatch 调用，输入 documentId 和目标结果 ID，返回显式的 Research snake_case 数据。它们独立查询冻结结果，不调用 Factor / Strategy HTTP wire，不创建 Job、不刷新报告。

| 文件 / 入口 | 授权与结果契约 |
| --- | --- |
| [factor-report.ts](factor-report.ts) `loadResearchFactorReportResult` | 从有效 Research 文档解析用户，要求本人完成且有 payload 的因子报告；拒绝未解封 holdout，保留旧报告 spec 回退；payload 上限 4 MiB |
| [backtest-report.ts](backtest-report.ts) `loadResearchBacktestReportResult` | 本人完成回测报告；从报告冻结配置生成 hash 和字段，上限 8 MiB，不读取 Strategy 当前配置或 lastResult 替代 |
| [scan-and-weather.ts](scan-and-weather.ts) `loadResearchStrategyScanReportResult`、`loadResearchFactorWeatherResult` | 同样按文档所有者检查目标结果，显式投影扫描／天气字段 |

普通会话需要 research surface 且未归档；嵌入分析用其内部文档身份访问同一授权逻辑。成功取得的嵌入输入由 [embedded](../../embedded/README.md) 留存；后续 retained 重放读原响应，不再次运行这些 loader。

改报告兼容和私有边界看 [factor-report.test.ts](factor-report.test.ts)、[backtest-report.test.ts](backtest-report.test.ts)、[scan-and-weather.test.ts](scan-and-weather.test.ts)，同时检查 [SDK 运行映射](../../runtime/host/README.md)。回到 [datasets 总体说明](../README.md)。

[返回 Research 总览](../../README.md)
