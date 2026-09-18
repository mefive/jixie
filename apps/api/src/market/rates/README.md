# 收益率曲线同步与可得性读取

曲线共享身份和中国国债期限来自 [registry/yield-curves.ts](../registry/yield-curves.ts)，本目录拥有供应商解析、可得日和持久化。

[china-treasury-curve.ts](china-treasury-curve.ts) 的 `MinistryOfFinanceCurveClient` 获取财政部响应，`parseChinaTreasuryCurveResponse` 校验并映射期限点，`assignCurveAvailableDates` 选择严格晚于观测日的下一 SSE 开市日。`syncChinaTreasuryYieldCurve` 供 CLI、Maintenance、Signals 调用，按年分段获取，非空候选按切片事务替换；空响应保留已有数据，不当作历史撤回。

[chinabond-credit-curves.ts](chinabond-credit-curves.ts) 的 `ChinaBondPublicCurveClient`／`parseChinaBondCurveWorkbook` 处理公开工作簿，`syncChinaBondCreditCurves` 同步其定义的信用曲线；身份和单位遵循该来源定义。美债名义／实际曲线虽也写收益率表，联合 FX 同步归 [cross-market](../cross-market/README.md)。

[government-yield-availability.ts](government-yield-availability.ts) 的 `loadGovernmentYieldAvailability(requiredTerms, tradeDate)` 只查询每个期限 availableDate ≤ tradeDate 的最新记录，返回已有项的日期事实；缺项不伪造 null 行或触发同步。Signals 自己提取冻结依赖，判断 14 个日历日新鲜度和无利率依赖时直接通过，见 [Signals factor-inputs](../../signals/factor-inputs/README.md)。

改来源、期限或日期映射看 [china-treasury-curve.test.ts](china-treasury-curve.test.ts)、[chinabond-credit-curves.test.ts](chinabond-credit-curves.test.ts)；只读可得性看 [government-yield-availability.integration.test.ts](government-yield-availability.integration.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[audit.ts](audit.ts) 检查信用曲线的逐序列覆盖、可得日期、数值与审计截止日覆盖；调用方提供审计范围。
