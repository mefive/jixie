# 股债配置与风险归因：贡献、相关性与压力情景

> 学习路径 · 预计 120～150 分钟 · 建议先完成一次 Panel 因子分析和一次多资产回测。

这项练习回答一个容易被净值曲线掩盖的问题：**股债轮动的收益和风险分别来自哪里，它降低回撤以后，是否真的比
股票基线更好？** 你会创建一个不含黄金和商品的股债 Panel Factor，把它用于沪深 300 ETF、5 年国债 ETF 和
10 年国债 ETF 的月度轮动，再用股票基线、静态股债和零成本轮动拆分资产配置、择时和成本。最后依次核对收益
贡献、风险贡献、相关性、利率环境、市场风险和压力情景。

这不是一份配置建议。案例故意保留一个“最大回撤明显改善、收益却没有胜出”的真实结果，用来练习如何拒绝只挑
好看的风险指标。

## 已实际跑通的固定案例

2026-08-25，我们用全新账户通过真实产品 API、任务队列、Python 沙箱和浏览器界面运行了 Panel 报告、发布、
四组回测和完整风险归因，并生成本页截图。验收结束后，策略已删除，临时发布的 Factor 已归档。

| 项目 | 固定设置 |
| --- | --- |
| Factor | `stock_bond_momentum_120`，120 日复权价格动量 |
| Factor 资产域 | `equity` 与 `fixed_income`；明确排除 `commodity` |
| Panel 研究池 | 9 只境内股票 ETF、3 只海外股票 ETF、3 只国债 ETF；没有黄金或商品 ETF |
| 策略交易池 | `510300.SH`、`511010.SH`、`511260.SH` |
| 调仓规则 | 每月按 Factor 分数选择前两只，等权持有 |
| 基线 | `510300.SH` 95% 买入持有 |
| 静态诊断对照 | 24.50% 沪深 300、34.19% 五年国债、34.19% 十年国债、7.12% 现金；月度再平衡 |
| 零成本诊断对照 | 完全相同的动量规则；佣金、最低佣金、税费、滑点和冲击全部置零 |
| 区间 | 2018-01-01 至 2026-07-30；Factor 探索段截至 2025-01-27 |
| 成本 | 100 万元初始资金；2bp 滑点；冲击系数 0.1 |

### Panel 报告的真实结果

探索报告有 83 个有效月、976 条有效观测。平均 Rank IC 为 **0.0181**，年化 ICIR 为 0.13，Rank IC 正值率为
54.22%。但等权多空年化为 -7.44%，成本后多空年化为 **-8.25%**，平均单边换手为 36.35%。

![只包含股票与固收资产域的 Panel Factor 真实报告](/docs/images/help/zh/learning/stock-bond-panel-factor-result.png)

平均 Rank IC 略高于事前 `> 0` 的最低方向标准，不等于经济价值合格。多空收益为负，而且成本使结果进一步恶化。
本练习临时发布它，是为了冻结代码、报告和资产分类并验收归因链路；不是因为它已成为生产 Factor。

### 四组诊断对照的真实结果

| 方案 | 累计收益 | 年化收益 | 最大回撤 | Sharpe | 年换手 | 成交 | 费用 | 滑点损耗 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 沪深 300 ETF 95% 买入持有 | 28.84% | 3.12% | -40.72% | 0.258 | 0.05× | 1 | 237.50 元 | 360.96 元 |
| 静态股债诊断对照 | **36.35%** | **3.83%** | **-6.00%** | **0.828** | 0.13× | 201 | 1,247.22 元 | 2,701.70 元 |
| 股债动量零成本对照 | 12.41% | 1.43% | -12.00% | 0.242 | 1.89× | 147 | 0 元 | 0 元 |
| 股债动量月度轮动 | 3.10% | 0.37% | -13.27% | 0.088 | 1.89× | 155 | 8,032.40 元 | 76,609.55 元 |

![沪深 300 ETF 买入持有基线的真实结果](/docs/images/help/zh/learning/stock-bond-baseline-result.png)

![静态股债诊断对照的真实结果](/docs/images/help/zh/learning/stock-bond-static-allocation-result.png)

![股债动量零成本对照的真实结果](/docs/images/help/zh/learning/stock-bond-zero-cost-allocation-result.png)

![股债动量轮动的真实费后结果](/docs/images/help/zh/learning/stock-bond-allocation-result.png)

这四组对照把三类解释线索分开了：

1. **资产配置效果**：静态股债把最大回撤降到 -6.00%，同时累计收益 36.35% 高于股票基线的 28.84%。本样本的
   防守效果不需要动量择时也存在。
2. **择时效果**：动量轮动即使完全不计成本，也只有 12.41% 累计收益和 0.242 Sharpe，分别落后静态股债 23.94 个
   百分点和 0.586。动量规则是主要负贡献，不是回撤改善的来源。
3. **成本效果**：真实成本又把动量累计收益从 12.41% 降到 3.10%，观察差为 9.31 个百分点；回撤与 Sharpe 也继续恶化。

静态权重参考了已观察到的动态策略平均暴露，因此只是一个**样本内诊断对照**，不是新的可投资基准。零成本组同样不可实现，只给出策略在
该执行模型下的假设上界。两组对照都不得被重命名为样本外验证。

固定裁决是：**股债混合有历史防守效果，但动量择时明显拖累结果，成本再次放大劣势；不应作为生产候选。**

### 归因与风险诊断的真实结果

组合损益 30,998 元与归因损益完全对账，残差约为零。资产类别结果为：

| 资产类别 | 平均权重 | 收益贡献 | 风险贡献 | 净盈亏 |
| --- | ---: | ---: | ---: | ---: |
| 固定收益 | 68.38% | +9.72% | 6.89% | +97,200 元 |
| 中国权益 | 24.50% | -6.62% | 93.11% | -66,202 元 |
| 海外权益 | 0.00% | 0.00% | 0.00% | 0 元 |

![真实组合收益与风险贡献对账](/docs/images/help/zh/learning/stock-bond-attribution-result.png)

平均权重不是风险贡献。中国权益平均权重只有 24.50%，却贡献了 93.11% 的组合风险；固定收益平均权重更高，风险
贡献只有 6.89%。这正是不能只看“60/40”或平均仓位标签的原因。

截至 2026-07-30，中国权益与固定收益的最新 60 日相关性为 **0.1520**。相关性页面同时保留 60 日与 120 日
窗口和月末滚动路径，不能把一个低相关时点外推成永久关系。

![股债资产类别相关性的真实滚动结果](/docs/images/help/zh/learning/stock-bond-correlation-result.png)

最新利率环境为“利率下行／曲线陡峭”。在历史上被分到该状态的 879 个交易日里，固定收益资产类别年化均值为
6.26%，中国权益为 1.42%。这是条件复盘，不是下一期收益预测。

![股债资产类别在不同利率环境中的真实条件表现](/docs/images/help/zh/learning/stock-bond-rate-regime-result.png)

市场风险诊断使用 252／252 个日度观察，估计组合年化波动 9.93%，市场因子解释度 91.66%；中国权益解释了
99.14% 的方差贡献占比。标准风险模型仍会显示黄金和商品驱动，即使本案例没有持有黄金、没有商品 ETF，也没有
把它们放入 Panel 研究池。这里的“黄金／商品”是回归解释变量，不是仓位或交易标的。

![组合市场风险暴露的真实诊断](/docs/images/help/zh/learning/stock-bond-market-risk-result.png)

在线性压力估计中，A 股下跌 10% 对当前暴露的估计影响为 -4.48%，国债收益率上行 50bp 为 -1.24%，跨资产
Risk-off 为 -3.18%；历史复现中，2022 全球通胀冲击为 -11.60%，是三段历史情景中最差的一段。

![当前暴露下的真实压力情景结果](/docs/images/help/zh/learning/stock-bond-scenarios-result.png)

## 学完以后

你应该能够：

1. 区分 Panel 研究池、策略交易池和风险模型驱动；
2. 创建只适用于股票与固收 ETF 的 Panel Factor，并核对冻结报告；
3. 用股票、静态股债、动态零成本和动态真实成本拆分资产配置、择时和成本；
4. 识别样本内诊断对照与样本外基准的边界；
5. 从资产和资产类别两层对账收益、费用与风险贡献；
6. 正确解读滚动相关、利率环境、市场／宏观风险和压力情景；
7. 在回撤改善但收益、Sharpe 和成本不合格时给出否定结论。

## 第一步：先分清三种资产范围

| 范围 | 本案例内容 | 用途 |
| --- | --- | --- |
| Factor 资产域 | `equity`、`fixed_income` | 约束定义可以对哪些大类输出分数 |
| 冻结 Panel 研究池 | 12 只股票 ETF、3 只国债 ETF | 生成横向排序证据和可追溯资产分类 |
| 策略交易池 | 沪深 300、5 年国债、10 年国债 ETF | 决定策略实际可交易的三只资产 |

普通静态多资产策略可以回测，但没有一份已批准 Panel 报告时，系统没有权威的资产分类来源，因此不会生成完整
配置归因。本练习发布 Panel Factor，是为了让回测继承冻结的资产分类和代码 lineage。

## 第二步：创建纯股债 Panel Factor

在“因子研究”点击“新建 → Panel 横截面因子”，设置 key `stock_bond_momentum_120`，使用以下 Python 定义：

```python
from jixie import Factor, AssetFactorContext

factor = Factor.panel(
    name="股债120日动量",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income"],
    window=121,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 120)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
```

不要加入 `commodity`。保存或重新打开后，页面应恢复股票与固收资产域，不应自动加入黄金或商品 ETF。

运行月频 Panel 报告前，写下正向 Rank IC 假设、机制局限和主要标准 `panel_rank_ic_mean > 0`。报告完成后同时读
Rank IC、ICIR、正值率、多空收益和换手。看到本案例的 -8.25% 成本后多空收益时，不能只引用 0.0181 Rank IC。

## 第三步：发布只冻结 lineage，不授予“有效”标签

发布按钮只在报告完成、代码未修改、研究参数与冻结报告一致时可用。发布后策略通过 key 引用完全相同的定义，回测
会记录 Factor ID、代码 hash、输入字段和批准报告。

本练习允许临时发布，是为了学习完整的配置归因能力。它不等于投资委员会批准，也不能覆盖负的费后多空收益。
完成练习后归档 Factor。

## 第四步：建立股票与静态股债对照

先运行沪深 300 ETF 95% 买入持有：

```ts
const equity = '510300.SH';

export default defineStrategy({
  name: '学习案例：沪深300 ETF 买入持有基线',
  watch: [equity],
  onBar(ctx) {
    if (ctx.price(equity) != null && ctx.shares(equity) === 0) {
      ctx.orderTargetPercent(equity, 0.95);
    }
  },
});
```

再运行月度再平衡的静态股债诊断对照：

```ts
const equity = '510300.SH';
const bond5y = '511010.SH';
const bond10y = '511260.SH';
let lastMonth = '';

export default defineStrategy({
  name: '学习案例：静态股债诊断对照',
  watch: [equity, bond5y, bond10y],
  onBar(ctx) {
    const month = ctx.period('monthly');
    if (month === lastMonth) return;
    lastMonth = month;
    ctx.orderTargetPercent(equity, 0.245);
    ctx.orderTargetPercent(bond5y, 0.3419);
    ctx.orderTargetPercent(bond10y, 0.3419);
  },
});
```

这组权重加总为 92.88%，余下 7.12% 保留现金。它参考了动态策略的样本内平均暴露，只用于回答“不做择时时，类似的股债混合
会怎样”，不是独立的样本外基准。

股票基线、静态股债和费后轮动必须使用相同的 2018-01-01 至 2026-07-30、100 万元和真实成本参数。否则回撤与收益不可直接比较。

## 第五步：运行月度股债轮动

```ts
const equity = '510300.SH';
const bond5y = '511010.SH';
const bond10y = '511260.SH';
const assets = [equity, bond5y, bond10y];
let lastMonth = '';

export default defineStrategy({
  name: '学习案例：股债120日动量月度轮动',
  watch: assets,
  factors: ['stock_bond_momentum_120'],
  onBar(ctx) {
    const month = ctx.period('monthly');
    if (month === lastMonth) return;
    lastMonth = month;
    const picks = assets
      .map(code => ({ code, score: ctx.factor('stock_bond_momentum_120', code) }))
      .filter(item => item.score != null)
      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      .slice(0, 2)
      .map(item => item.code);
    if (picks.length === 2) ctx.equalWeight(picks);
    else ctx.setHoldings({});
  },
});
```

运行后核对因子依赖、155 笔成交、103 次调仓、费用与滑点。不要把低换手标签当成低成本证明，真实滑点约占初始
资金 7.66%。

## 第六步：用零成本组隔离执行损耗

保持动量代码、数据、日期和初始资金不变，只在回测请求中把全部成本字段置零：

```json
{
  "commission": 0,
  "minCommission": 0,
  "stampDuty": 0,
  "transferFee": 0,
  "slippageBps": 0,
  "impactCoef": 0
}
```

这是自动验收使用的诊断配置，不是可部署的交易假设。实跑中，零成本组为 147 笔成交，费用与滑点都严格为零。它的累计收益
12.41% 仍明显低于静态股债的 36.35%，因此不能把费后落后全部归因于成本。两组动量回测的成交笔数不必相同：成本会改变可买数量和
后续资金路径。

## 第七步：按顺序阅读配置归因

1. **资产类别**：先确认组合损益与归因损益对账，再比较平均权重、收益贡献和风险贡献。
2. **具体资产**：确认只有三只策略资产产生非零仓位；研究池中其他 ETF 应为零仓位。
3. **相关性**：比较 60／120 日窗口和滚动路径，不只摘最新值。
4. **利率环境**：把状态表现写成历史条件描述，不写成预测。
5. **风险研究**：分开日度市场风险与月度宏观敏感度，并核对数据 lineage。
6. **压力情景**：明确结果是当前暴露的线性估计，不包含再平衡、流动性冲击或非线性价格路径。

风险贡献使用成分收益与组合收益的协方差分摊；它可能远高于平均权重，也可能出现负贡献。收益贡献和风险贡献回答
不同问题，不能相互替代。

## 第八步：写出最终裁决

```text
研究结论：不支持进入生产候选。

证据：Panel Rank IC 为 0.0181，但成本后多空年化 -8.25%。静态股债累计收益 36.35%、
最大回撤 -6.00%、Sharpe 0.828；相同动量规则即使完全零成本，也只有 12.41% 收益和
0.242 Sharpe，说明择时是主要负贡献。真实成本又把收益降到 3.10%、Sharpe 降到 0.088；
155 笔成交带来 8,032 元费用和 76,610 元滑点损耗。

归因：固定收益平均权重 68.38%，贡献 +9.72% 收益和 6.89% 风险；中国权益
平均权重 24.50%，贡献 -6.62% 收益和 93.11% 风险。组合损益已完全对账。

原因：回撤改善主要来自股债混合；当前动量择时破坏了静态配置的收益与风险调整结果，
交易成本再次扩大差距。静态和零成本组都只是样本内诊断对照。

行动：归档学习用 Factor，不部署策略。若提出低换手、波动目标或不同信号的新版本，
建立新的事前问题与未观察样本，不能用本次诊断结果反复调参。
```

## 完成检查

- [ ] Factor 资产域只有 `equity` 与 `fixed_income`，研究池没有黄金或商品 ETF；
- [ ] 能解释 Panel 研究池与三只策略交易资产的差别；
- [ ] 同日期、资金和市场数据下完成了股票、静态股债、动态零成本和动态真实成本四组对照；
- [ ] 能根据四组结果把资产配置、择时和成本影响分开；
- [ ] 没有把样本内静态权重或不可实现的零成本组写成样本外基准；
- [ ] 没有把 Rank IC 略大于零写成经济证据通过；
- [ ] 收益贡献之和与组合收益对账，风险贡献之和为 100%；
- [ ] 能解释为什么 24.50% 的中国权益平均权重产生 93.11% 风险贡献；
- [ ] 没有把风险模型中的黄金／商品驱动误写成黄金／商品持仓；
- [ ] 压力情景被描述为线性估计，而不是预测；
- [ ] 最终结论同时包含防守效果、收益落后和成本负担；
- [ ] 学习用 Factor 已归档，策略未部署。

## 相关内容

- [研究跨资产 Panel Factor](/help/factors/panel-research)
- [发布 Factor](/help/factors/publish-factor)
- [在策略中使用 Factor](/help/factors/factor-in-strategy)
- [阅读多资产配置归因](/help/backtesting/allocation-attribution)
- [阅读组合风险研究](/help/backtesting/portfolio-risk)
- [为什么回测不等于未来收益](/help/basics/backtest-limitations)
