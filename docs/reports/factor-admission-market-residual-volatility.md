# 市场残差波动率因子准入台账

> 状态：探索、冗余门和一次性正式保留段均通过；2026-08-12 准入预置因子菜单。

## 候选定位

- 候选研究键：`candidate_market_residual_vol20`（研究期内使用的自定义因子键）
- 正式预置 slug：`resid_vol20`
- 正式菜单名：市场残差波动率（20日）
- 主题：低波动 / 彩票偏好；是现有总波动率因子的候选补充，不默认具有独立信息
- 预期方向：负；个股不能被宽基市场解释的短期波动越高，未来收益越低
- 文献先验：Ang、Hodrick、Xing、Zhang 用过去一个月日收益的本地 Fama–French 模型残差标准差定义
  IVOL，并发现高 IVOL 股票后续收益较低；A 股研究对方向和估计方法存在分歧，因此只能把文献当先验，
  不能直接准入

## 冻结定义

使用最近 21 个个股交易日的后复权收盘价和同期中证全指（000985.CSI）收盘价，形成 20 个逐段对齐
的日收益。估计带截距单指数模型：

```text
stock_return = alpha + beta * market_return + residual
factor_value = population_std(residual)
```

这是一项透明、可复现的**单指数市场残差波动率**，不是完整 Fama–French 三因子 IVOL。项目当前没有
PIT 的日频 SMB/HML 因子收益；为了一个候选临时构建整套因子收益模型会超出 3.5 的最小范围，也会与
3.6b 的固定控制集建设混在一起。基准日缺失不前填；窗口少于 21 个观测、前序个股收盘价非正、
基准价格非正或缺失、市场收益方差为零或相邻个股交易日间隔超过 30 个自然日时返回 `null`。窗口最低
市场交易日覆盖率为 80%。

冻结代码如下；探索、相关性和 holdout 必须使用同一份代码快照：

```ts
export default defineFactor({
  name: '市场残差波动率(20日)',
  window: 21,
  minCoverage: 0.8,
  compute(bar, ctx) {
    const stockCloses = ctx.history(21);
    const marketCloses = ctx.history(21, 'marketClose');
    const dates = ctx.history(21, 'date');
    if (
      stockCloses.length < 21 ||
      marketCloses.length < 21 ||
      marketCloses.some((value) => value == null)
    ) {
      return null;
    }
    const day = (value: string) =>
      Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6)) / 86400000;
    const stockReturns: number[] = [];
    const marketReturns: number[] = [];
    for (let index = 1; index < stockCloses.length; index++) {
      const previousStock = stockCloses[index - 1];
      const previousMarket = marketCloses[index - 1];
      const currentMarket = marketCloses[index];
      if (
        previousStock <= 0 ||
        previousMarket == null ||
        previousMarket <= 0 ||
        currentMarket == null ||
        currentMarket <= 0 ||
        day(dates[index]) - day(dates[index - 1]) > 30
      ) {
        return null;
      }
      stockReturns.push(stockCloses[index] / previousStock - 1);
      marketReturns.push(currentMarket / previousMarket - 1);
    }
    const stockMean = stockReturns.reduce((sum, value) => sum + value, 0) / stockReturns.length;
    const marketMean = marketReturns.reduce((sum, value) => sum + value, 0) / marketReturns.length;
    let marketVarianceSum = 0;
    let covarianceSum = 0;
    for (let index = 0; index < stockReturns.length; index++) {
      const centeredMarket = marketReturns[index] - marketMean;
      marketVarianceSum += centeredMarket ** 2;
      covarianceSum += centeredMarket * (stockReturns[index] - stockMean);
    }
    if (marketVarianceSum <= 0) {
      return null;
    }
    const beta = covarianceSum / marketVarianceSum;
    const alpha = stockMean - beta * marketMean;
    const residuals = stockReturns.map(
      (value, index) => value - alpha - beta * marketReturns[index],
    );
    const residualMean = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
    const residualVariance =
      residuals.reduce((sum, value) => sum + (value - residualMean) ** 2, 0) /
      residuals.length;
    return Math.sqrt(residualVariance);
  },
});
```

- 冻结代码 SHA-256：`86c8eaf2436551c4b83da1b472d600e71081d9b3108fe864289371c02322fb7a`
- 探索报告和正式预置代码保持上述完整哈希一致，不是根据结果重写的近似版本

## 冻结研究规则

- 探索区间：2020-01-01 至服务器给出的 `exploreEnd`（当前为 2025-01-27）
- 频率：月频
- 股票池与数据纪律：沿用当前正式 V3/V4 口径；上市满 365 日、剔除历史风险警示和待退市、流动性
  后 25%、窗口最低覆盖率 80%、暴露和未来收益沿用报告冻结的异常值规则
- 主报告：市值+行业中性化
- 主判据：`rank_ic_mean < -0.01`
- 冗余门：探索期与 `vol120` 的平均截面 Spearman 相关性必须 `< 0.90`；达到或超过即视为现有低波
  因子的换皮，不消耗正式 holdout
- 辅助证据：IC 正值比例应低于 50%，高因子值减低因子值的费后多空年化应为负，窗口覆盖不得出现
  系统性缺口。辅助证据用于最终判断，不事后替换主判据
- 正式保留段：只有探索主判据和冗余门同时通过才启动；沿用同一代码、参数、方向和主判据，只揭示一次

## 探索与冗余证据

探索报告 `01KZT1XKRHJ6M3XH3Y5QA8NE05` 使用 2020-01-01 至 2025-01-27、月频、市值+行业
中性化口径，共 60 个有效期：

| Rank IC 均值 | 年化 ICIR | IC>0 比例 | Top 组换手 | 费前多空年化 | 费后多空年化 |
|---:|---:|---:|---:|---:|---:|
| -0.08379 | -2.8104 | 18.33% | 71.92% | -21.20% | -25.14% |

主判据要求 `rank_ic_mean < -0.01`，实际显著通过。窗口平均覆盖率为 99.55%，最低覆盖率 80%；
290,422 个候选观测中有 2,134 个因覆盖不足被剔除。

探索期冗余检验在 61 个截面上比较候选与 `vol120`，平均 Spearman 相关为 0.6353，低于预注册的
0.90 淘汰线；候选与市值的平均相关为 -0.0371。因此它属于低波主题，但不是现有 120 日总波动率或
规模因子的换皮。

## 正式 Holdout 证据

正式报告 `01KZT2PC7R52EH8ST73F6ERW79` 使用父报告冻结的同一代码、参数、方向和判据，区间为
2025-02-05 至 2026-07-30。报告完成后先保持封存，再于 2026-08-12 依据用户授予的 3.5 研究开发
权限揭示一次：

| 有效期数 | Rank IC 均值 | 年化 ICIR | IC>0 比例 | Top 组换手 | 费前多空年化 | 费后多空年化 |
|---:|---:|---:|---:|---:|---:|---:|
| 17 | -0.09844 | -2.6802 | 17.65% | 72.18% | -24.36% | -28.13% |

正式 Rank IC 远低于 -0.01 门槛，方向、IC 稳定性和费后分层均与探索期一致。窗口平均覆盖率为
99.75%，97,911 个候选观测中有 436 个因覆盖不足被剔除。高换手意味着该因子更适合作为研究菜单和
组合输入，不应把上述多空数字直接理解为无需交易约束的可部署策略。

## 准入决定

**准入。** 以 `resid_vol20` 加入预置因子菜单，名称保持“市场残差波动率(20日)”，避免误称完整
Fama–French 特异波动率。预期方向为负，正式代码必须保持冻结哈希。准入只完成 3.5 的研究因子菜单，
不自动创建策略、信号或交易。

## 资料

- Ang, Hodrick, Xing, Zhang, *High Idiosyncratic Volatility and Low Returns: International and
  Further U.S. Evidence*（2006 working paper；过去一个月日收益、本地 Fama–French 残差波动率）
- 熊熊、孟永强、李然、沈德华，《特质波动率与股票收益——基于 Fama-French 五因子模型的研究》
  （2017，DOI `10.12341/jssms13212`；A 股负向证据）
- 黄锦波、王天娇、曾燕，《数据抽样频率、股票高估与特质波动率异象》
  （2026，DOI `10.12011/SETP2024-2859`；A 股日频显著、月频不显著，说明定义敏感）
