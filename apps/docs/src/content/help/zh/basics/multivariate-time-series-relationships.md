# 怎样阅读多变量时间序列研究

两个变量的关系有时会混在第三个变量里。例如黄金收益和实际利率变化看起来相关，可能同时受到通胀环境影响。多变量时间序列研究把一个结果变量和多个解释维度放进同一份预先指定的模型：

$$
y_t=\alpha+\beta_f x_{f,t-k_f}+\sum_{j=1}^{q}\gamma_j c_{j,t-k_j}+\varepsilon_t
$$

这里 `y` 是结果变量，`x_f` 是本次唯一的核心解释变量，`c_j` 是控制变量。每个变量可以有自己的滞后期数。

## 为什么只能有一个核心变量

系统会计算所有变量的系数，但正式结论只回答一个预先指定的问题，例如：

> 控制 CPI 后，实际利率变化是否仍与黄金月收益负相关？

实际利率是核心变量，CPI 是控制变量。若要正式回答“控制实际利率后 CPI 是否与黄金相关”，应在查看结果前把 CPI 改为核心变量并作为另一份研究运行。这样可以防止系统跑完后只挑最显著的变量讲故事。

控制变量也必须依据研究逻辑预先指定，不应根据本次显著性自动增删。加入更多变量不一定更好：样本会减少，系数也可能因共线性变得不稳定。

## 原始系数、标准化系数和偏 R²

- **原始系数**保留单位。实际利率变化一个百分点对应黄金收益平均变化多少，需要读它。
- **标准化系数**把量纲调整到标准差单位，适合比较不同变量在样本中的相对尺度；它不会把关系变成因果。
- **偏 R²**表示其他变量已经进入模型后，单独加入某变量额外解释的剩余变异比例：

$$
R^2_{partial,j}=\frac{SSE_{-j}-SSE_{full}}{SSE_{-j}}
$$

偏 R² 很小但区间不含 0，表示统计上可区分于零，但增量解释力可能仍很有限。完整模型的调整 R² 会对变量数量做惩罚，比只看 R² 更适合比较不同维度的模型。

工作台把偏 R² 小于 1% 标为“可忽略”、1% 至 9% 标为“较小”、9% 至 25% 标为“中等”、不低于 25% 标为“较大”。这是用于一致展示的实现口径，不是适用于所有学科的自然定律，必须结合问题成本和单位判断。

## “控制其他变量后的关系”图是什么

这张图先分别从结果变量和核心变量中剔除控制变量可以线性解释的部分，再比较两组残差。它依据 Frisch–Waugh–Lovell 定理，与完整回归中的核心变量系数相同。

因此它可直观看到：在控制变量相同的条件下，核心变量剩余变化和结果变量剩余变化如何关联。它仍然只控制已放进模型的线性部分，不能排除遗漏变量和反向关系。

## VIF 和变量相关矩阵

解释变量彼此高度相关时，模型很难区分“究竟是哪一个变量起作用”。方差膨胀因子为：

$$
VIF_j=\frac{1}{1-R_j^2}
$$

其中 `R_j²` 来自“用其余解释变量解释第 j 个变量”的回归。VIF 接近 1 表示共线性弱；达到 5 会触发工作台警告。高 VIF 不意味着必须机械删除变量，而是说明系数和符号可能对样本区间敏感，应回到研究逻辑判断变量是否重复表达同一概念。

相关矩阵展示解释变量之间的两两 Pearson 相关。它能指出明显重复维度，但不能替代 VIF，因为多个变量的组合也可能产生共线性。

## HAC 区间、残差和滚动系数

工作台对全部系数使用 Newey–West/HAC 稳健标准误。它调整异方差和有限阶序列相关造成的区间偏差，但不改变 OLS 系数，也不能修复错误的变量、共同趋势或结构突变。

残差一阶自相关较高时，说明模型可能遗漏动态结构。滚动核心系数用固定窗口重复估计核心变量的偏回归系数，用于检查方向是否只在某段时期成立。窗口过短会导致多变量估计噪声很大。

## Python 教学示意

下面代码说明同类计算；页面里的生产结果仍由冻结的协议、数据口径和运行指纹决定：

```python
import pandas as pd
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor

aligned = data[["gold_return", "real_yield_change", "cpi_yoy"]].dropna()
X = sm.add_constant(aligned[["real_yield_change", "cpi_yoy"]])
fit = sm.OLS(aligned["gold_return"], X).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": hac_lag},
)

coefficient_table = fit.summary2().tables[1]
vif = pd.Series(
    [variance_inflation_factor(X.values, i) for i in range(1, X.shape[1])],
    index=X.columns[1:],
)
```

## 结论边界

- “控制 CPI 后”只代表模型控制了这条具体 CPI 序列及其指定变换，不代表控制了所有通胀预期。
- 同期多变量回归不能证明预测关系；预测要求解释变量在结果变量之前可得。
- 控制已观察变量会减少部分混杂，但不会自动产生因果结论。
- 同一批数据上不断替换核心变量、控制变量、滞后和区间，会产生多重尝试偏差。
- 若宏观历史值使用后来的修订数据，研究可以描述修订后的历史关系，却不能冒充当时真实可得的信息集。

## 延伸阅读

- [statsmodels：OLS](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.OLS.html)
- [statsmodels：HAC 稳健协方差](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html)
- [statsmodels：方差膨胀因子](https://www.statsmodels.org/stable/generated/statsmodels.stats.outliers_influence.variance_inflation_factor.html)
- [怎样阅读双变量时间序列关系研究](/docs/help/basics/time-series-relationships)
