# 使用 Python 编写 Factor

新建自定义 Factor 时，代码编辑器默认使用 Python `py-v1`。同一套 Python Factor SDK 支持股票截面、单资产时间序列和跨资产 Panel；研究类型决定代码入口、可选字段和报告方法。

## 新建 Python Factor

1. 打开顶部“因子研究”。
2. 点击左侧“新建”。
3. 选择“股票横截面因子”“ETF 时间序列因子”或“Panel 横截面因子”。
4. 填写显示名称和创建后固定的 Factor key。
5. 确认编辑器顶部显示“Python · py-v1”。
6. 直接编辑代码，或在左侧向 Agent 说明公式、方向、窗口和缺失值规则。

编辑器会提供 Python 类型和 Factor 字段补全。补全只说明字段可用，不说明它适合当前研究。

![Python Factor 编辑器与字段补全](/docs/images/help/zh/factors/python-factor-01.png)

## 股票横截面写法

横截面 Factor 在每个比较日期对每只股票输出一个数值或 `None`。

```python
from jixie import Factor, FactorBar, CrossSectionalFactorContext

factor = Factor.cross_sectional(name="盈利收益率")

@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext) -> float | None:
    return 1 / bar.pe_ttm if bar.pe_ttm is not None and bar.pe_ttm > 0 else None
```

- `bar.pe_ttm` 是当前股票在当前历史时点可得的市盈率 TTM。
- 返回的数字参加当期排序。
- `None` 表示没有有效值，不参加当期排序。
- 不要用 `0` 代替缺失；零会被当成真实因子值。

需要价格或财务历史时，通过 `ctx.history(periods, field)` 读取，并在定义中设置足够的 `window` 和 `min_coverage`。

## 时间序列写法

时间序列 Factor 对一个资产自己的历史计算信号。

```python
from jixie import Factor, AssetFactorContext

factor = Factor.time_series(
    name="ETF 20日趋势",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income", "commodity"],
    window=21,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 20)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
```

`inputs` 和 `target_asset_classes` 是定义的一部分。代码只能读取已声明输入；窗口不足时返回 `None`。

## Panel 写法

Panel Factor 使用 `Factor.panel(...)`，在每个决策日为固定跨资产池中的每个资产输出可横向比较的分数。它的 `compute` 仍读取单个资产历史，但报告会在共同月末比较这些分数。

Panel 分数的量纲和方向必须可跨资产比较。价格水平通常不能直接比较，应使用收益率、波动调整值或其他明确标准化的信号。

## 检查、分析和发布

1. 等待代码状态变为已保存。
2. 处理编辑器中的字段、类型和返回值错误。
3. 设置日期、频率、股票池或资产池、预测周期和研究卡。
4. 点击“运行分析”，查看日志和完整报告。
5. 修改代码后重新运行；旧报告仍对应旧代码。
6. 只有与当前名称、key、代码、研究类型和协议一致的批准报告才能发布。

发布后的 Factor 冻结其定义。继续试验时复制为新草稿，不要把旧报告当成新代码的证据。

## TypeScript 兼容

已有 TypeScript Factor 仍可读取和运行；Python 是新建草稿的默认语言，不会自动重写历史定义。两种语言遵守同一研究协议，但函数名和空值写法不同，不能把代码直接混用。

## 常见问题

### `Factor.cross_sectional` 与当前研究类型不一致

代码入口必须与创建时选择的研究类型一致。时间序列用 `Factor.time_series`，Panel 用 `Factor.panel`。

### Python 能运行，为什么仍不能发布

代码可执行只是第一关。还要有与当前定义一致的批准报告，并完成页面要求的研究卡、Holdout 或其他门槛。

## 相关内容

- [新建和编辑自定义因子](/docs/help/factors/create-custom-factor)
- [阅读稳健截面推断](/docs/help/factors/robust-inference)
- [发布 Factor 并用于策略](/docs/help/factors/publish-factor)

