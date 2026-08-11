# 使用 Python 编写策略

回测工作台可以使用 TypeScript 或 Python。两种语言最终都由同一套回测规则处理行情、成交、费用、A 股 T+1 和涨跌停，因此语言不同不应改变交易规则。

## 切换策略语言

1. 打开“回测工作台”，新建策略或打开尚未运行的草稿。
2. 在代码编辑器顶部找到语言选择，选择“Python”。
3. 确认切换。页面会用 Python 空白模板替换当前代码。
4. 检查编辑器旁显示 `py-v1` 和“股票 / ETF 回测预览”。

切换语言会替换未保存的代码。已有重要代码时，先复制到其他位置，或先运行并保存当前版本。

![回测工作台中的 Python 编辑器和运行入口](/docs/images/help/zh/backtesting/python-strategy-01.png)

## 一个可以运行的例子

下面两段代码表达同一件事：当 20 日历史数据准备好后，把贵州茅台的目标仓位设为 50%。点击页签可以比较两种写法。

:::code-tabs
```typescript
let ordered = false;

export default defineStrategy({
  name: '20 日历史示例',
  async onBar(ctx) {
    const closes = ctx.history('600519.SH', 'close', 20);
    if (!ordered && closes.length === 20) {
      ctx.orderTargetPercent('600519.SH', 0.5);
      ordered = true;
    }
  },
});
```
```python
from jixie import Strategy

strategy = Strategy(name="20 日历史示例", watch=["600519.SH"])
ordered = False

@strategy.on_bar
def handle_bar(ctx):
    global ordered
    closes = ctx.history("600519.SH", "close", 20)
    if not ordered and len(closes) == 20:
        ctx.order_target_percent("600519.SH", 0.5)
        ordered = True
```
:::

Python 模块会在整次回测中保留变量，所以示例中的 `ordered` 可以防止每天重复下达同一意图。

## 运行并检查结果

1. 打开“编辑启动参数”，设置起止日期、资金和成本。
2. 点击“运行回测”。
3. 在日志中检查 Python 输出或错误行号。
4. 等待主要指标出现，再核对成交笔数、交易明细和净值。

![Python 策略完成回测后的指标和日志](/docs/images/help/zh/backtesting/python-strategy-02.png)

Python 报错会标出 `strategy.py` 的行号。先定位第一条错误，不要只看最后一行异常名称。

## 当前支持范围

`py-v1` 当前支持股票和 ETF、日线历史窗口、常用指标、预置因子、目标仓位、股数订单和条件单。

以下入口在 Python 模式下暂不开放：

- 股指期货及股票／期货混合策略；
- 自定义 TypeScript Factor；
- 参数扫描；
- 部署上线和今日信号。

页面隐藏这些入口不是权限问题。需要使用上述功能时，切换回 TypeScript，并按 TypeScript SDK 重写策略。

## 相关内容

- [设置回测参数](/docs/help/backtesting/run-settings)
- [运行回测并查看日志](/docs/help/backtesting/run-and-logs)
- [查看回测结果](/docs/help/backtesting/results-overview)
