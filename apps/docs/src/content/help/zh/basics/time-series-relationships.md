# 怎样阅读时间序列关系研究

时间序列关系研究比较两个按时间排列的变量。例如“十年期国债收益率的月度变化，是否与沪深 300 月收益同向”，
或“黄金和股票的相关性是否随时间改变”。它描述历史样本中的关系，不自动证明因果，也不自动构成预测信号。

## 先核对变量和时间

阅读数字以前，先核对五件事：

1. **变量**：比较的是价格水平、收益率、差分还是同比；单位是否一致。
2. **频率**：日频和月频不能直接混算。月频数据按同一个日历月对齐，不要求两个市场最后一个交易日相同。
3. **不完整期间**：默认排除未结束的当前月；只有明确研究“月初至今”时才应包含。
4. **滞后**：`predictorLag = 0` 是同期关系；正滞后表示解释变量先出现、结果变量后出现。
5. **样本**：内连接只保留两个变量都有值的期间。样本数、首末日期和缺失量必须与问题相符。

## Pearson 和 Spearman 回答什么

Pearson 相关系数衡量线性关系：

$$
r_{xy}=\frac{\sum_{t=1}^{T}(x_t-\bar{x})(y_t-\bar{y})}
{\sqrt{\sum_{t=1}^{T}(x_t-\bar{x})^2}\sqrt{\sum_{t=1}^{T}(y_t-\bar{y})^2}}
$$

它的范围是 −1 到 1。正值表示同向，负值表示反向，绝对值越大表示样本中的线性关系越明显。接近 0 只表示
没有明显线性关系，不能排除曲线关系或分状态关系。

Spearman 先把数值换成排名，再计算排名的相关性。它更关心“一个变量变大时，另一个是否通常也变大”，对
极端数值没有 Pearson 那么敏感。两者差异很大时，应检查离群点、非线性和不同市场状态。

## 回归斜率、区间和 R²

简单回归写成：

$$
y_t=\alpha+\beta x_{t-k}+\varepsilon_t
$$

- `β` 是斜率：`x` 增加一个单位时，样本中 `y` 的平均变化；解释必须带上变量单位。
- `α` 是截距：`x` 为零时模型给出的条件平均值，不一定有经济含义。
- 95% 置信区间表示在当前模型假设下估计的不确定性。区间不含 0 是统计证据，不等于投资价值。
- R² 表示这条线解释了多少样本内波动。高 R² 可能只是两个资产共同暴露于同一个市场因子。

金融序列常有异方差和时间相关。工作台使用 Newey–West/HAC 标准误调整斜率的不确定性；这会改变标准误、
t 值和区间，不会改变 OLS 斜率本身。HAC 也不能修复遗漏变量、共同趋势、结构突变或错误的时间方向。

## 为什么还要看滚动图

全样本相关可能掩盖不同阶段。滚动相关和滚动斜率用固定窗口反复估计，可以看到关系是否换符号、是否只在某段
时期出现，以及结论是否被少数月份驱动。窗口越短越灵敏，但估计噪声也越大；窗口越长越平滑，也越可能掩盖
结构变化。

## Python 教学复现

下面代码说明同一类计算，生产结果仍以页面冻结的协议、数据口径和参数为准：

```python
import pandas as pd
import statsmodels.api as sm

aligned = pd.concat([predictor, outcome], axis=1, join="inner").dropna()
x = sm.add_constant(aligned["predictor"])
fit = sm.OLS(aligned["outcome"], x).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": hac_lag},
)
pearson = aligned["predictor"].corr(aligned["outcome"], method="pearson")
spearman = aligned["predictor"].corr(aligned["outcome"], method="spearman")
```

## 结论边界

- 同期相关不能写成“X 预测 Y”；预测问题必须让 X 在时间上先于未来 Y。
- 相关和显著回归都不能单独证明因果。
- 统计显著不等于费后可交易，也不等于未来会保持。
- 看过多个区间、窗口、滞后或变量后，只展示最好结果会产生多重尝试偏差。
- 水平值共同上升可能产生伪相关；必要时应研究差分、收益率、趋势或协整，而不是直接相信高相关。

## 延伸阅读

- [SciPy：Pearson 与 Spearman 统计函数](https://docs.scipy.org/doc/scipy/reference/stats.html)
- [statsmodels：HAC 稳健协方差](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [ETF 时间序列因子研究](/docs/help/factors/time-series-research)
