# 观察数据与可得截止日

本能力把 Market 数据变成评估器需要的观察序列。评估提交先确定可用截止日，[analysis](../analysis/README.md) 再加载并计算；这里不拥有报告／Job 状态。

[contract.ts](contract.ts) 拥有时间序列、Panel 和股票风格控制暴露的数据结构，评估器与组合能力只消费这些类型。横截面窗口覆盖率的默认值保持 0，由同一常量供观察序列和历史分析政策使用；版本化政策的其他阈值仍归 analysis。观察能力不反向导入评估器或统计推断。

[cross-sectional](cross-sectional/README.md) 负责股票截面、PIT 财务、行业与风格控制数据，以及 FactorSandbox 生成的因子序列，供评估和相关性直接复用。

| 实现与具名入口 | 主要用途 |
| --- | --- |
| [asset-factor-data-cutoff.ts](asset-factor-data-cutoff.ts) `resolveAssetFactorDataCutoff`、`resolveEtfCommonLatest` | submit 依据 spec、因子数据需求寻找资产共同截止日；查库，缺失返回不可用结果 |
| [etf-trend-observations.ts](etf-trend-observations.ts) `loadEtfTimeSeriesObservations` / `buildEtfTimeSeriesObservations` | 时间序列输入；loader 获取行情及利率等数据，builder 使用runtime 实例形成观察 |
| [panel-observations.ts](panel-observations.ts) `loadPanelEtfObservations` / `buildPanelEtfObservations` | 对齐 Panel 的资产、日历和决策日期，保留资产分类、预热和缺失约束 |
| [macro-regime-data-cutoff.ts](macro-regime-data-cutoff.ts)、[macro-regime-observations.ts](macro-regime-observations.ts) | `resolveMacroRegimeDataCutoff` / `loadMacroRegimeObservations`；宏观 vintage、决策目标与评估数据 |

loader 与 build 的区别不能简单等同于异步／纯函数：资产 builder 还会调用传入的runtime 实例。截止日、availableDate、预热缺值、跨资产日历及后续收益对齐必须一起核对，不能用当前最新数据填补历史缺口。因子实例的 start 与最终 close 由上层执行编排负责。

修改 ETF／利率口径看 [etf-trend-observations.test.ts](etf-trend-observations.test.ts)、[asset-factor-data-cutoff.test.ts](asset-factor-data-cutoff.test.ts)；Panel 看 [panel-observations.test.ts](panel-observations.test.ts)；宏观看 [宏观观察测试](macro-regime-observations.test.ts)。数据来源规则分别链接 [Market rates](../../market/rates/README.md)、[macro](../../market/macro/README.md)。

[返回 Factor 总览](../README.md)
