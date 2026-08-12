# 股票横截面稳健统计

> 状态：已实现（2026-08-12）  
> 对应：`FactorAnalysisSpecV6` / `FactorReport.robustInference`

## 目标与边界

股票横截面报告在原有 Rank IC、十分位收益、费后多空和 Holdout 之外，补充两类证据：

1. 对逐期 Rank IC 和多空收益均值给出 Newey–West 稳健标准误、t 值与 95% 置信区间；
2. 逐期做固定控制集的 Fama–MacBeth 截面回归，再对候选因子系数序列做 Newey–West 推断。

这些结果是辅助证据，不修改已经冻结的主要判据，也不替代 Rank IC、分层图、费后结果或 Holdout。
没有基准因子收益序列也不妨碍本项成立；时序 alpha、GRS、GMM 不在当前路线图内。

## 冻结协议

V6 继承 V5 的历史时点股票池、全市场或指数范围、全局或行业内排序和诊断切片，并增加：

```text
inference.version = 1
standardError = newey_west
lag = automatic
confidenceLevel = 0.95
famaMacbeth.controlSet = cn_equity_style_v1
famaMacbeth.standardization = population_zscore
famaMacbeth.minimumPeriods = 12
famaMacbeth.minimumObservationsPerPeriod = 100
famaMacbeth.momentumLookbackTradingDays = 252
famaMacbeth.momentumSkipTradingDays = 21
```

V6 同时允许冻结可选的 V1 复合因子定义，因此新的单因子和股票复合因子共用一个当前协议；V1–V5
历史报告继续按原协议读取，不回填新统计量。

## Newey–West 均值推断

对按成仓日期排序的逐期序列计算 HAC 长期方差。自动滞后为
`floor(4 × (T / 100)^(2/9))`，并限制在 `0..T-1`。置信区间使用渐近正态 95% 临界值。

报告覆盖：

- Rank IC 均值；
- 等权 / 市值权的费前多空收益均值；
- 等权 / 市值权的费后多空收益均值。

页面的等权 / 市值权切换只切换已经计算好的多空推断，不重新运行研究。

## 固定控制集 Fama–MacBeth

在每个有效成仓日，用与主报告一致的候选股票和独立缩尾后的下一期收益估计：

```text
forward_return = intercept + candidate + size + value + momentum + quality + error
```

`cn_equity_style_v1` 定义如下：

| 控制 | 定义 | 时点规则 |
|---|---|---|
| size | `ln(totalMv)` | 成仓日 `DailyBasic` |
| value | `1 / PB`，仅 PB > 0 | 成仓日 `DailyBasic` |
| momentum | `adjClose[t-21] / adjClose[t-252] - 1` | 上交所开市日精确对齐，不前填 |
| quality | ROE | 最新 `annDate <= 成仓日` 的财务报告 |

候选暴露使用主报告经过异常值处理、股票池过滤、中性化和排序范围处理后的最终值。候选与四个控制逐期做
总体 z-score，回归含截距。控制缺失只从辅助回归的 complete-case 样本中剔除，不改变主报告的 IC、分层或
多空收益。每期至少 100 个完整观测，至少 12 个成功回归期；第二步对候选系数序列做相同的自动滞后
Newey–West 推断。

控制项不能由用户勾选。如果候选因子与固定控制完全或近似共线，保留完整控制集并明确报告
`collinear_exposure`，不为得到显著系数而删除控制。

## 验收

- 单元测试覆盖自动滞后、95% 区间、带自相关序列的朴素 t 值虚高、通用 HAC 回归、矩阵共线、固定控制
  一致性、规模换皮因子增量系数接近零，以及 12 期门槛。
- API 全量测试：595 通过、1 跳过。
- 真实本地数据：EP，月频，2023-01-01 至 2025-06-30，共 29 期；Fama–MacBeth 29/29 期成功，
  每期平均 2811 只股票。Rank IC 的 NW t=1.60，固定控制后的候选系数 NW t=0.68。
- 浏览器 E2E 校验 V6 请求、不可变报告、四组推断、固定控制元数据和中英文 UI；截图：
  `apps/web/acceptance/8a-factor-robust-inference.png`、
  `apps/web/acceptance/8b-factor-robust-inference-report.png`。
