# 宏观发布、版本与风险轴

[china-macro.ts](china-macro.ts) 的 `syncChinaMacroData` 供宏观 CLI 和 Maintenance 调用，取系列值及发布日历，`prepareMacroObservations` 生成 releaseDate/availableDate，按抓取日保存 vintage；目录、发布日历和变更观察分批提交，不是整个宏观源的总事务。`macroVintageKind` 保留实时捕获与最新值回填的区别。

[us-headline-cpi.ts](us-headline-cpi.ts) 的 `syncUsHeadlineCpiData` 和 `BlsPublicDataClient` 处理美国 CPI；BLS、OECD/FRED 等响应解析及来源回退在同文件维护，不能仅因系列含义相近就改变 source 或可得性证据。

[as-of.ts](as-of.ts) 的 `loadMacroObservationsAsOf`、`loadMacroVintagesThrough` 是 Research／Factor 等消费者的读取入口，`selectMacroObservationsAsOf` 是纯选择。始终要求 availableDate ≤ decisionDate；as_available 还要求 vintageDate 不晚于决策日，latest_vintage 允许后获版本，但受 dataCutoff 限制并披露 futureVintageRows/latestValueBackfillRows。历史回填不能标成严格 PIT。

[regime-score.ts](regime-score.ts) 的 `loadMacroRegimeScoreHistory`／`buildMacroRegimeScoreHistory` 生成宏观状态；[risk-axes.ts](risk-axes.ts) 的 `loadMacroRiskAxisHistory`／`buildMacroRiskAxisHistory` 提供风险轴，load 查库、build 处理已加载输入。[risk-axis-quality.ts](risk-axis-quality.ts) 的 `inspectMacroRiskAxes`／`summarizeMacroRiskAxisQuality` 做基础覆盖摘要；模型历史准入仍归 [Strategy risk](../../strategy/risk/README.md)。

改版本选择看 [as-of.test.ts](as-of.test.ts)，同步看 [china-macro.test.ts](china-macro.test.ts)、[us-headline-cpi.test.ts](us-headline-cpi.test.ts)，状态／风险计算看 [regime-score.test.ts](regime-score.test.ts)、[risk-axes.test.ts](risk-axes.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[audit.ts](audit.ts) 检查宏观发布时间证据、历史版本口径和可得日期；不把抓取到的最新值回填成历史已知事实。
