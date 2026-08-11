# 运行跨资产 Panel 研究

Panel 横截面研究在每个共同月末比较多只 ETF 的信号排名，再观察之后收益排名。它用于检查跨资产选择关系，不是已经执行的资产配置策略。

## 运行 Panel 因子

1. 打开“因子研究”。
2. 在“Panel 横截面因子”中选择预设 Factor，或新建同类 Factor。
3. 核对固定研究资产池、持有期和研究区间。
4. 点击“运行分析”，填写研究卡。
5. 等待 Panel 报告完成。

资产池覆盖境内权益、海外权益、不同久期国债、黄金和商品 ETF。各 ETF 只从上市且历史窗口充足后进入观察，系统不会为晚上市资产回填虚假历史。

![Panel 研究的固定资产池和参数](/docs/images/help/zh/factors/panel-research-01.png)

## 阅读 Panel 排序证据

每个月末的 Rank IC 为：

$$
IC_t=\operatorname{Corr}_{Spearman}\left(\operatorname{Rank}(F_{i,t}),\operatorname{Rank}(r_{i,t\rightarrow t+h})\right)
$$

报告同时显示平均 Rank IC、年化 ICIR、Rank IC 正值率、等权基准、成本后多空年化和平均单边换手。

- **等权基准**回答不使用信号时，资产池整体怎样表现。
- **多空诊断**按最高和最低各 25% 构造研究组合，并扣除单边 10bp 成本。
- **实际策略**通常是受现金和持仓约束的 ETF 多头组合，两者不能直接比较。

## 类别内和类别间证据

资产数量不均衡时，固收或商品类别可能有更多 ETF。报告因此另列：

- 类别内 Rank IC：只在同类 ETF 内比较选择能力。
- 类别间 Rank IC：先把每类压成一个等权代表，再比较类别。
- 类别间费后多空：先选类别，再在类别内部配置 ETF。

这些诊断不改写 Factor 原始分数，也不改变正式 Holdout 的主判据。

![Panel 报告中的排序、类别分解和上市覆盖](/docs/images/help/zh/factors/panel-research-02.png)

## 查看资产覆盖

在“资产覆盖与上市历史”中核对每只 ETF 的观察数、首个有效月末和最后有效月末。报告顶部的最少、中位数和最多覆盖用于判断每个月实际有多少资产参加排名。

## 创建 Panel 合成

需要合成多个 Panel Factor 时：

1. 点击“新建多因子合成”。
2. 研究方式选择“Panel 横截面”。
3. 选择 2–5 个同类成分、方向和 Rank 或 Z-score 标准化。
4. 使用固定等权运行探索和 Holdout。
5. 发布前确认每个成分本身已经发布。

Panel 合成发布后可以进入策略 Lab。回测结果会单独显示实际配置归因，不能把 Panel 报告的多空收益当作回测净值。

## 相关内容

- [创建多因子合成](/docs/help/factors/create-composite)
- [阅读多因子报告](/docs/help/factors/read-composite-report)
- [发布 Factor 并用于策略](/docs/help/factors/publish-factor)
- [查看多资产配置归因](/docs/help/backtesting/allocation-attribution)
