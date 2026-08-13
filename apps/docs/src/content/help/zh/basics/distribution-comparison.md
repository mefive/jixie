# 怎样阅读两组分布比较

两组分布比较用来回答“A 组和 B 组的某个指标是否有系统差异”。例如，同一截面上沪深 300 与中证 500 成分股的市净率是否不同。它描述当前样本的分布差异，不自动证明因果，也不等于未来收益预测。

## 先核对可比性

阅读检验结果前，先核对：

1. **同一截面**：两组必须解析到同一个数据日，不能把不同时点的估值放在一起。
2. **同一指标口径**：指标定义、单位和版本必须一致。
3. **可比的样本资格**：上市天数、停牌、风险警示和缺失值规则要对两组一致执行。
4. **不截断总体**：比较整个分布时不应先做“只取前 20 名”之类的限制。
5. **预设方向**：在看结果前决定研究 A 更高、A 更低还是双侧差异。

## 均值差和 Welch 区间

主要估计量是两组样本均值之差：

$$
\widehat{\Delta}=\bar{x}_A-\bar{x}_B
$$

Welch 方法不强迫两组具有相同方差。均值差的标准误为：

$$
SE(\widehat{\Delta})=\sqrt{\frac{s_A^2}{n_A}+\frac{s_B^2}{n_B}}
$$

95% 区间表示在当前抽样与模型假设下的估计不确定性。区间包含 0 时，样本没有给出清晰的均值差证据；区间不含 0 也不表示差异一定足够大或具有投资意义。

## 为什么同时看排名检验和效应量

- **Mann–Whitney** 根据两组数值的相对排名评估分布位置差异，不要求正态分布。它不只是“中位数检验”；当两组分布形状不同时，含义会更广。
- **Cohen's d** 用合并标准差表示均值差的标准化大小，方便判断差异是可忽略、较小、中等还是较大。
- **Cliff's delta** 表示从 A 组随机取一个值大于 B 组值的概率优势，减去反向概率优势；范围是 −1 到 1。

样本很大时，很小的差异也可能有很小的 p 值。因此平台不会只根据“显著/不显著”下结论，还会同时检查效应量和方向。

## 极端值敏感性

估值比率等指标常有长尾。平台会把两组各自上下尾的极端值压到指定分位数，然后重新计算缩尾均值差。如果原始均值差和缩尾均值差变号，结论对极端值敏感，不应被强解读。

## Python 教学复现

```python
import numpy as np
from scipy import stats

mean_difference = group_a.mean() - group_b.mean()
welch = stats.ttest_ind(group_a, group_b, equal_var=False)
mann_whitney = stats.mannwhitneyu(group_a, group_b, alternative="two-sided")

def winsorized_mean(values, tail=0.05):
    lower, upper = np.quantile(values, [tail, 1 - tail])
    return np.clip(values, lower, upper).mean()

sensitivity = winsorized_mean(group_a) - winsorized_mean(group_b)
```

## 结论边界

- 截面差异不证明“属于某指数”导致了指标差异。规模、行业、盈利、成长和样本选择都可能混杂结果。
- 只比较一个最新截面会受当时市场状态影响；时间稳定性需要额外的多截面研究。
- 多次更换指标、分组或日期后只展示最好结果，会产生多重尝试偏差。
- 比较结果不包含未来收益、换手、成本或容量，不能直接转写为因子结论。

## 延伸阅读

- [SciPy：独立样本 t 检验](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.ttest_ind.html)
- [SciPy：Mann–Whitney U 检验](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.mannwhitneyu.html)
- [怎样阅读时间序列关系研究](/docs/help/basics/time-series-relationships)
