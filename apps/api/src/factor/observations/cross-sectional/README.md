# 横截面观察数据与因子序列

[data.ts](data.ts) 读取调仓日期、复权截面、PIT 财务、行业及风格控制数据；finaAsOf 和 industryOn 保留历史时点选择规则。

[series.ts](series.ts) 的 computeFactorSeries 根据已有截面与历史数据创建 FactorSandbox，生成各日期的因子值及覆盖审计，finally 关闭会话。窗口覆盖默认值来自 [观察契约](../contract.ts)，不依赖分析政策模块。

[评估算法](../../analysis/cross-sectional/README.md) 直接复用这些能力；这里不创建报告或 Job。修改数据口径仍须遵循因子方法论与 PIT 约束，目录迁移不改变原计算规则。

[返回观察数据](../README.md)
