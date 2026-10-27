# 市值中性化

中性化用于检查因子结果是否主要重复规模差异。当前支持“无”和“市值”；行业数据、行业中性化和行业内排序已移除。

## 它计算什么

每个调仓日分别拟合带截距的一元回归：

$$
F_{i,t}=\alpha_t+\beta_t\ln(MV_{i,t})+\varepsilon_{i,t}
$$

- \(F_{i,t}\) 是原始因子值。
- \(MV_{i,t}\) 是当日总市值，必须为正。
- \(\alpha_t+\beta_t\ln(MV_{i,t})\) 是市值解释的部分。
- \(\varepsilon_{i,t}\) 是用于后续排序、分组与 Rank IC 的残差。

例如原始因子值为 \(0.08\)，市值解释的部分为 \(0.06\)，剩余值是：

$$
0.08-0.06=0.02
$$

规模中性化不保证盈利，也不控制全部共同风险。它只是改变了所检验的问题。

## 如何运行

1. 在“因子研究”中选择股票横截面因子，打开“更多设置”。
2. 将“中性化”设为“市值”；或选择“无”研究原始因子值。
3. 明确全 A 股或历史指数成分范围，保持比较中的日期、样本、异常值和成本设置一致。
4. 运行分析，核对报告的中性化参数、Rank IC、分组收益和缺失样本。

当前协议在正式股票池和样本过滤后估计残差；缺少正市值的样本不能用于规模中性化。结果可能加强或减弱，不应只保留表现最好的一份。

## 历史界面存档

下列图片记录过去含行业设置的界面与原始结果，数值未重算。行业选项现已退役，不能按图重复操作；旧行业参数会明确拒绝，不会自动转换成市值中性化。已保存报告数据不改写。

![历史中文界面示例：因子分析中选择市值加行业中性化并重新运行](/docs/images/help/zh/factors/factor-neutralization-setting-01.png)

![历史中文界面示例：市值加行业中性化后的盈利收益率报告](/docs/images/help/zh/factors/factor-neutralization-result-01.png)

![历史中文界面示例：保留报告中的无中性化和市值加行业报告](/docs/images/help/zh/factors/factor-neutralization-history-01.png)

## 相关内容

- [设置分析范围和样本处理](/docs/help/factors/analysis-settings)
- [Rank IC、ICIR 和 IC 衰减](/docs/help/factors/rank-ic-icir)
- [十分位分组收益](/docs/help/factors/decile-returns)
