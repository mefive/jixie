# 修改策略和重新运行

> 标为“历史中文界面示例”的图保留当时的结果或状态，数值未重新计算。当前操作请以本文步骤和当前界面图为准。

代码、日期、资金或成本发生变化后，页面上的旧结果不会自动重新计算。需要再次运行回测，新的结果才会使用修改后的设置。

## 修改后运行

1. 打开要修改的策略。
2. 修改代码，或点击顶部的“编辑启动参数”修改日期、资金和成本。
3. 检查顶部显示的日期和资金。
4. 点击“运行回测”。
5. 等待结果区域和日志显示本次运行已经完成。

“运行回测”按钮重新变为可用，表示当前设置与上一次完成的回测不同。这时页面上的指标仍是上一次结果，不能用来判断本次修改。

## 修改后离开页面

下图中的标记分别是：

1. 当前日期和资金摘要。
2. 需要点击的“运行回测”按钮。
3. 尚未运行修改时出现的确认框。

![历史中文界面示例：修改回测参数后离开策略时的确认提示](/docs/images/help/zh/backtesting/edit-rerun-01.png)

点击“新建”或切换到其他策略时，如果出现“有改动尚未运行”：

- 需要保留修改：点击“取消”，然后运行回测。
- 不需要保留修改：点击“放弃改动”继续。

“放弃改动”会丢失当前没有运行过的代码或参数变化。已经完成并保存的上一次结果不会因此改变。

结果只保留最近提交，不提供历史选择或旧源码恢复。修改代码或启动参数后会提示重跑；重新提交会清理旧结果，即使新运行失败也不会回退。

## 比较修改前后的结果

比较两次结果时，至少记录：

- 策略代码或规则改了什么。
- 起始和结束日期。
- 初始资金。
- 基础滑点和冲击系数。
- 成交笔数、累计收益和最大回撤。

一次只改一个主要设置，更容易判断变化来自哪里。若同时改变规则、日期和成本，不能把结果差异归因于其中某一项。

## 刷新页面前

尚未运行的修改在刷新或关闭页面时也可能丢失。看到浏览器的离开提示时，先取消离开并运行回测；确认不需要修改时再离开。

## 迁移旧版账户接口

期货数据、交易、`accounts` 和 `futures` 声明已退役。旧代码会报错，平台不会自动改写源码或用股票行情替代。全部初始资金进入股票 / ETF 现金账户。

策略 SDK 已改为按账户分组。旧版扁平接口不再可用，平台不会自动修改已保存源码。当前保留结果仍可查看；旧策略重新回测或扫描前需要迁移源码。

| 原调用 | 新调用 |
| --- | --- |
| `ctx.value` | `ctx.portfolio.equity`（组合报告）；现金仓位计算使用 `ctx.stock.equity` |
| `ctx.cash` / `ctx.availableCash` | `ctx.stock.availableCash` |
| `ctx.order(code, shares)` | `ctx.stock.orderAdjustedShares(code, shares)`（后复权股数） |
| `ctx.orderLots(code, lots)` | `ctx.stock.orderLots(code, lots)`（每手 100 真实股） |
| `ctx.setHoldings(weights)` | `ctx.stock.setTargetWeights(weights)` |
| `ctx.orderTargetPercent(code, weight)` | `ctx.stock.setTargetWeight(code, weight)` |
| `ctx.positions()` / `ctx.shares(code)` | `ctx.stock.positions()` / `ctx.stock.adjustedShares(code)` |
| `ctx.exit(code)` | `ctx.stock.closePosition(code)` |
| `ctx.equalWeight` / `ctx.atrUnits` / `ctx.volTargetWeights` | `ctx.stock.equalWeight` / `ctx.stock.atrAdjustedShares` / `ctx.stock.volTargetWeights` |
| `ctx.stopLoss` / `ctx.limitBuy` | `ctx.stock.stopLossAtAdjustedPrice` / `ctx.stock.limitBuyAtAdjustedPrice` |
| `ctx.trailingStop` / `ctx.takeProfit` / `ctx.cancelConditional` | `ctx.stock.trailingStopByFraction` / `ctx.stock.takeProfitByFraction` / `ctx.stock.cancelConditional` |

同日增量单累加，重复目标以后者为准。现金目标表包含整个账户，未列持仓会清仓，不能与现金增量单混用。`closePosition` 覆盖该标的之前的普通指令，之后再发增量单会报错。清仓仍受停牌、涨跌停和可卖数量限制；持续条件单按原规则独立处理。

Python 对应使用 `ctx.stock.order_adjusted_shares`、`set_target_weights`、`set_target_weight`、`close_position` 等 snake_case 方法，账户字段为 `ctx.portfolio.equity`、`ctx.stock.equity`、`ctx.stock.available_cash`。Python 仍只支持股票和 ETF，不增加期货交易。完整接口见 [SDK 参考](/sdk)。

## 相关内容

- [设置回测参数](/help/backtesting/run-settings)
- [运行回测和查看日志](/help/backtesting/run-and-logs)
- [查看回测结果](/help/backtesting/results-overview)

