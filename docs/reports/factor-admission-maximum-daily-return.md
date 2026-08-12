# 月内最大单日收益（MAX）因子准入台账

> 状态：已强准入（2026-08-12）。探索、去冗余和一次性正式 holdout 均通过；已加入预置菜单
> `maxret21`。预测方向稳定，但换手和交易成本高。

## 候选定位

- 候选研究键：`candidate_max_return21`
- 候选菜单名：月内最大单日收益（21 日）
- 主题：彩票偏好 / 极端正收益；与波动率族相关但经济定义不同
- 定义：最近 21 个日收益中的最大值；日收益由后复权收盘价计算，窗口不完整或相邻交易日历日间隔
  超过 30 天时返回 `null`
- 预期方向：负；极端正收益越大、彩票特征越强，未来一个月收益越低
- 文献先验：Bali、Cakici、Whitelaw（2011）提出 MAX 异象；Gao、Han、Xiong（2021）以及
  Bi、Gui、Zhu（2022）分别在中国股票样本中报告负向 MAX 效应。A 股涨跌停会截断观测到的极端
  收益，因此必须由本地样本而非文献结论决定是否准入

## 冻结代码

```ts
export default defineFactor({
  name: '月内最大单日收益(21日)',
  window: 22,
  compute(bar, ctx) {
    const closes = ctx.history(22);
    const dates = ctx.history(22, 'date');
    if (closes.length < 22 || dates.length < 22) {
      return null;
    }
    let maximumReturn = -Infinity;
    const day = (value: string) =>
      Date.UTC(+value.slice(0, 4), +value.slice(4, 6) - 1, +value.slice(6)) / 86400000;
    for (let index = 1; index < closes.length; index++) {
      const previous = closes[index - 1];
      if (previous <= 0 || day(dates[index]) - day(dates[index - 1]) > 30) {
        return null;
      }
      maximumReturn = Math.max(maximumReturn, closes[index] / previous - 1);
    }
    return maximumReturn;
  },
});
```

## 冻结研究规则

- 探索区间：2020-01-01 至 2025-01-27；月频
- 主报告：全 A 股正式 V3 口径，市值+行业中性化
- 主判据：`rank_ic_mean < -0.01`
- 冗余门：探索期分别与 `vol`、`vol120`、`resid_vol20` 的平均截面 Spearman 绝对值都必须
  `< 0.90`；任一达到或超过 0.90 即视为现有波动率因子的换皮，不消耗正式 holdout
- 辅助证据：IC 正值比例应低于 50%，高因子值减低因子值的费后多空年化应为负
- 正式保留段：仅当探索主判据和冗余门同时通过时启动；沿用相同代码、参数、方向和主判据，只揭示一次

## 资料

- Bali, Cakici, Whitelaw, *Maxing Out: Stocks as Lotteries and the Cross-Section of Expected
  Returns*（2011，DOI `10.1016/j.jfineco.2010.08.014`）
- Gao, Han, Xiong, *Loss from the Chasing of MAX Stocks: Evidence from China*（2021，DOI
  `10.1016/j.najef.2021.101475`）
- Bi, Gui, Zhu, *Large Transactions and the MAX Effect: Evidence from China*（2022，DOI
  `10.1016/j.pacfin.2022.101852`）

## 实际运行与结论

- 候选因子 ID：`01KZT9TZW3ZSMY2ASHA0PVKYPN`
- 探索报告：`01KZT9TZWAVDMBTN3XJPVWJAVF`
- 正式 holdout 报告：`01KZTBHFGY1MEYX7Z21AR91XBN`（仅揭示一次，2026-08-12）
- 冻结代码哈希：`a4fe26e0a155b3f172bf6a24a787cfb6b620deeac22eb1a11111ca0cfb84bf3f`
- 探索结果（60 期）：中性化 Rank IC `-0.06875`、年化 ICIR `-2.7966`、IC 正值比例 `20.00%`、
  top decile 换手 `77.30%`；高减低因子值费前年化 `-13.03%`、费后 `-17.71%`
- 冗余检查（61 个形成日平均截面 Spearman）：与 `vol` 为 `0.86131`、与 `vol120` 为
  `0.54252`、与 `resid_vol20` 为 `0.82508`，均低于 `0.90` 淘汰线；与市值为 `-0.00128`
- 正式 holdout（17 期，2025-02-05 至 2026-07-30）：中性化 Rank IC `-0.08712`、年化
  ICIR `-2.6905`、IC 正值比例 `17.65%`、换手 `73.33%`；费前年化 `-19.32%`、费后 `-23.50%`

探索和正式 holdout 的负向排序都明显通过冻结门槛，且未达到与现有波动率族的冗余淘汰线，故强准入。
它与短周期波动率仍有较高但非换皮级的相关性，并且月度换手约 73%～77%；菜单与策略使用中必须明确
“预测强、成本高”，不能把裸 IC 直接等同为易交易收益。
