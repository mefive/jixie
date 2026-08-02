# 在策略中使用自定义因子

自定义因子完成分析并锁定策略标识后，可以在回测策略中读取因子值、给股票排序并选择持仓。

多因子合成是因子研究对象，不能直接作为一个策略标识引用。需要用于策略时，应在策略代码中明确写出要读取的单因子和组合规则，让权重、方向和缺失值处理可以独立审查。

## 开始前

确认以下条件：

- 自定义因子已经成功运行分析。
- 页面显示“已锁定”的完整策略标识。
- 已经知道因子值越高或越低分别代表什么。
- 回测工作台中已经有一段可以编辑的策略。

本页使用：

```text
custom:help_book_to_market
```

实际操作时，应替换成自己页面上显示的完整标识。

## 在策略中声明并读取因子

策略需要同时完成两件事：

1. 在顶层 `factors` 中声明要使用的因子。
2. 在选股逻辑中通过 `ctx.factor` 读取每只股票的因子值。

下面的示例每月从沪深 300 中选择账面市值比最高的 10 只股票，并等权持有：

```ts
let last = '';

export default defineStrategy({
  name: '账面市值比因子示例',
  factors: ['custom:help_book_to_market'],

  async onBar(ctx) {
    if (ctx.period('monthly') === last) return;
    last = ctx.period('monthly');

    const universe = (await ctx.universe('000300.SH')).minListDays(365);
    await ctx.ensureBars(universe.codes());

    const picks = universe
      .rankBy((_bar, code) =>
        ctx.factor('custom:help_book_to_market', code),
      )
      .top(10);

    if (picks.length) ctx.equalWeight(picks);
  },
});
```

其中：

- `factors` 告诉回测运行环境需要加载哪个自定义因子。
- `ctx.ensureBars` 准备股票的历史行情数据。
- `ctx.factor(标识, code)` 返回指定股票在当前回测日期的因子值。
- `rankBy(...).top(10)` 按数值从高到低排序并取前 10 只。
- 因子返回 `null` 或非有限数值时，该股票不会进入有效排序。

下图中的标记分别是：

1. 当前策略。
2. 顶层 `factors` 声明。
3. 选股逻辑中的 `ctx.factor`。
4. “运行回测”按钮。

![在策略声明和选股逻辑中引用自定义因子](/docs/images/help/zh/factors/factor-strategy-reference-01.png)

标识必须在两处完全一致，包括 `custom:` 前缀。

## 在编辑器中核对因子

把鼠标停在策略代码中的完整因子标识上，编辑器会显示因子的名称、类型和实现入口。

下图中的标记分别是：

1. 代码中的因子标识。
2. 因子说明和查看实现的链接。

![在策略编辑器中查看因子说明和实现入口](/docs/images/help/zh/factors/factor-strategy-hover-01.png)

运行前使用这个提示确认：

- 引用的是正确因子，而不是名称相近的另一个因子。
- 当前标识确实存在。
- 需要检查时可以打开因子实现。

## 运行并检查结果

1. 设置回测开始日期、结束日期和初始资金。
2. 点击“运行回测”。
3. 在日志中确认回测已完成，没有因子加载或计算错误。
4. 查看结果概览、交易明细和净值图。

下图中的标记分别是：

1. 本次回测的日期摘要。
2. 收益、风险、换手、费用和成交等结果。
3. 交易明细及成交笔数。
4. 策略净值和基准曲线。

![使用自定义因子的真实回测结果](/docs/images/help/zh/factors/factor-strategy-result-01.png)

出现成交说明策略已经读取因子并完成选股，不说明这个因子适合实盘。还需要检查：

- 排序方向是否符合原来的定义；
- 没有因子值的股票是否被正确排除；
- 股票池、调仓频率和持仓数量是否符合预期；
- 交易成本、换手和回撤是否可以接受；
- 不同历史区间和正式保留段结果是否稳定。

## 常见问题

### 提示找不到因子

检查标识是否已经锁定，并完整复制了 `custom:` 前缀。不要使用因子的中文显示名称代替策略标识。

### 声明了 `factors`，但策略仍然不能读取

还需要在策略逻辑中调用 `ctx.factor`。声明负责加载，`ctx.factor` 才会读取指定股票的数值。

### `ctx.factor` 写了，为什么仍然报错

确认同一个完整标识也出现在顶层 `factors` 数组中，并检查字符串拼写是否完全一致。

### 回测没有成交

先查看日志，再检查日期区间内是否有足够的有效因子值、股票池是否为空、`top` 数量和其他筛选条件是否过严。

### 修改因子代码后需要改策略标识吗

不需要。锁定标识保持不变，但应重新运行因子分析和回测，让新结果对应新代码。

## 相关内容

- [确认策略标识](/docs/help/factors/strategy-key)
- [设置回测参数](/docs/help/backtesting/run-settings)
- [查看回测结果概览](/docs/help/backtesting/results-overview)
- [正式保留段和样本外结果](/docs/help/factors/holdout-results)
