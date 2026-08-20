# 阅读稳健截面推断

股票横截面 Factor 报告除 Rank IC、分组收益和费后多空外，还提供 Newey–West 均值推断和固定控制集的 Fama–MacBeth 回归。它们回答“这段历史中的平均关系有多不确定”和“控制常见风格后是否仍有增量关系”，不是收益保证。

## Newey–West 均值推断

逐期 Rank IC 或多空收益通常存在时间相关，不能把每个月当成完全独立。报告用 Newey–West 标准误计算：

$$
t_{NW}=\frac{\bar{x}}{SE_{NW}(\bar{x})}
$$

95% 置信区间为：

$$
\bar{x}\pm1.96\,SE_{NW}(\bar{x})
$$

其中 $x_t$ 是每个成仓期的 Rank IC 或多空收益。页面会给出均值、Newey–West 标准误、t 值、置信区间、期数和自动选择的滞后阶数。

阅读顺序：

1. 先看均值方向是否符合事前假设。
2. 再看置信区间是否跨过 0；跨过 0 表示数据仍容许没有平均关系。
3. 查看期数和滞后，不要只看 t 值。
4. 在等权／市值权切换下分别看费前和费后多空；切换只显示已有结果，不会重跑。

![Rank IC 与多空收益的 Newey–West 推断](/docs/images/help/zh/factors/robust-inference-01.png)

## Fama–MacBeth 固定控制回归

每个有效成仓日，报告估计：

$$
r_{i,t+1}=\alpha_t+\beta_t f_{i,t}+\gamma_t' z_{i,t}+\varepsilon_{i,t+1}
$$

$f_{i,t}$ 是候选因子，$z_{i,t}$ 是固定的规模、价值、动量和质量控制。第二步对各期候选系数 $\beta_t$ 的均值做 Newey–West 推断。

页面重点看：

- 候选系数均值与方向；
- Newey–West t 值和 95% 置信区间；
- 成功回归期数、每期平均完整样本数；
- 固定控制集、标准化方式和缺失原因；
- 是否提示 `collinear_exposure` 等共线问题。

控制缺失只影响辅助回归的完整样本，不会改写主报告的 IC、分组或多空结果。系统不会为了让候选显著而删除控制项。

![Fama–MacBeth 固定控制推断](/docs/images/help/zh/factors/robust-inference-02.png)

## 怎样组合判断

- 主报告方向、分组单调性、费后收益和稳健推断相互一致，证据更完整。
- 原始 Rank IC 较强但控制后系数接近 0，可能主要重复规模、价值、动量或质量暴露。
- t 值较大但期数很少、覆盖不稳或成本后消失，不能只凭显著性通过候选。
- 这些统计不替代 Holdout，也不能证明因果关系。

## 常见问题

### 为什么普通 t 值和 Newey–West t 值不同

Newey–West 允许逐期结果存在异方差和有限自相关；当普通方法低估不确定性时，稳健 t 值通常更小。

### 页面没有稳健推断

旧的冻结报告不会补算新统计。使用当前协议重新运行一份新报告；样本期数或每期完整观测不足时，Fama–MacBeth 也会明确显示不可用原因。

## 相关内容

- [查看第一份因子分析结果](/docs/help/factors/results-overview)
- [Rank IC 和 ICIR](/docs/help/factors/rank-ic-icir)
- [正式保留段结果](/docs/help/factors/holdout-results)

