# Rank IC、ICIR 和 IC 衰减

Rank IC 检查因子排名与之后收益排名之间的关系。它不要求因子值和收益按固定比例变化，因此比直接比较数值更适合横截面因子研究。

## Rank IC 的公式

在每个调仓期 \(t\)，系统计算：

$$
IC_t
=
\operatorname{Corr}_{Spearman}
\left(
\operatorname{Rank}(F_{i,t}),
\operatorname{Rank}(r_{i,t\rightarrow t+1})
\right)
$$

- \(F_{i,t}\) 是股票 \(i\) 在调仓期 \(t\) 的因子值。
- \(r_{i,t\rightarrow t+1}\) 是这只股票下一期的收益。
- \(\operatorname{Rank}\) 表示把数值转换为从低到高的排名。
- Spearman 相关系数的范围是 −1 至 1。

Rank IC 为正，表示因子排名越高的股票，之后收益排名通常也越高；为负表示方向相反。

## 一个五只股票的例子

假设五只股票的因子排名是：

$$
(1,2,3,4,5)
$$

之后收益排名是：

$$
(1,3,2,4,5)
$$

两组排名只有第 2、3 名互换。没有并列排名时，Spearman 系数也可以写为：

$$
\rho
=
1-\frac{6\sum_{i=1}^{n}d_i^2}{n(n^2-1)}
$$

这里 \(d_i\) 是两种排名的差。例子中：

$$
\sum d_i^2=0^2+(-1)^2+1^2+0^2+0^2=2
$$

所以：

$$
\rho=1-\frac{6\times2}{5\times(5^2-1)}=0.9
$$

这表示本期排名关系很强，但一个调仓期不能代表长期稳定性。

## Rank IC 均值

报告中的“Rank IC 均值”是所有有效调仓期 IC 的平均：

$$
\overline{IC}
=
\frac{1}{T}\sum_{t=1}^{T}IC_t
$$

- \(T\) 是有效调仓期数。
- \(\overline{IC}\) 的正负表示总体方向。
- 绝对值越大，历史排序关系越明显。

不同因子、市场和频率的数值分布不同，不应使用一个固定阈值判断所有因子。

## ICIR

ICIR 把 IC 均值与 IC 自身的波动放在一起：

$$
ICIR
=
\frac{\overline{IC}}{\sigma(IC)}
$$

页面显示年化 ICIR：

$$
ICIR_{annual}
=
\frac{\overline{IC}}{\sigma(IC)}\sqrt{M}
$$

- \(\sigma(IC)\) 是各期 IC 的标准差。
- 月频的 \(M=12\)。
- 周频的 \(M=52\)。

例如，月频 IC 均值为 0.03，标准差为 0.12：

$$
ICIR_{annual}
=
\frac{0.03}{0.12}\sqrt{12}
\approx0.87
$$

ICIR 较高表示历史方向相对稳定，不表示未来不会失效。IC 均值很小但波动也很小时，ICIR 仍可能较高，因此两项必须一起看。

## IC 大于 0 的占比

页面中的“IC>0 占比”为：

$$
\text{正向占比}
=
\frac{\#\{t:IC_t>0\}}{T}
$$

例如 120 个月中有 76 个月 IC 为正：

$$
\frac{76}{120}=63.33\%
$$

它只计算方向，不考虑每个月 IC 的大小。

## 页面怎样显示

下图中的标记分别是：

1. Rank IC 均值。
2. 年化 ICIR。
3. IC 大于 0 的月份占比。
4. 最高因子组的月换手。

![因子报告中的Rank IC均值ICIR正向占比和换手](/docs/images/help/zh/factors/factor-rank-ic-01.png)

第一次阅读时：

1. 先看 Rank IC 正负，确认方向。
2. 再看绝对值，判断历史排序关系强弱。
3. 查看 ICIR 和 IC>0 占比，判断关系是否只来自少数月份。
4. 结合分组图确认 D1 至 D10 是否存在相同方向。

## IC 衰减

IC 衰减把“下一期”换成不同的前瞻交易日：

$$
IC(h)
=
\operatorname{Corr}_{Spearman}
\left(
\operatorname{Rank}(F_{i,t}),
\operatorname{Rank}(r_{i,t\rightarrow t+h})
\right)
$$

\(h\) 是 1、5、10、20 或 60 个交易日。

下图中的标记分别是：

1. “IC 衰减·因子的持有周期”。
2. 不同前瞻交易日的 Rank IC 均值。
3. 页面根据峰值位置给出的持有周期提示。

![因子报告中的不同前瞻期限Rank IC](/docs/images/help/zh/factors/factor-ic-decay-01.png)

- 短端较高、之后下降，表示因子关系主要出现在较短期限。
- 越往后越高，表示历史关系形成较慢。
- 曲线没有清晰方向，表示持有周期结论不稳定。

IC 衰减用于理解时间尺度，不是根据最高点机械选择持有天数。反复尝试多个期限后只保留最高点，也会造成过度拟合。

## 相关内容

- [分组收益和前瞻收益](/help/factors/decile-returns)
- [换手、交易成本和费后收益](/help/factors/turnover-costs)
- [查看第一份因子分析结果](/help/factors/results-overview)
