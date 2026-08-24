# 读取美国国债收益率曲线

Research Python 可以读取平台审核过的美国国债名义收益率和实际收益率期限序列。使用 `data.yield_curve()` 时必须明确曲线、期限和日期；不要把不同期限或名义／实际收益率互相替换。

## 选择曲线和期限

- `us_treasury_nominal`：美国国债名义收益率曲线。
- `us_treasury_real`：美国国债实际收益率曲线。

名义曲线支持 1M、2M、3M、6M、1Y、2Y、3Y、5Y、7Y、10Y、20Y 和 30Y；实际曲线当前支持 5Y、7Y、10Y、20Y 和 30Y。实际收益率不等于名义收益率减去任意通胀数字，不能自行替换。

## 读取收益率水平

1. 在研究问题或 Markdown Cell 中写明曲线、期限、样本区间和频率。
2. 新建或打开 Python Cell。
3. 输入 `data.yield_curve()`，设置 `curve`、`tenor`、`start` 和 `end`。
4. 日频使用 `frequency="daily"`；完整月度观察使用 `frequency="monthly"`。
5. 收益率水平使用 `transform="level"`。
6. 运行 Cell，检查返回表的 `date` 和 `value`。

```python
real_10y = data.yield_curve(
    "us_treasury_real",
    tenor="10Y",
    start="20150101",
    end="20251231",
    frequency="monthly",
    transform="level",
)
real_10y
```

`value` 的单位是百分比。例如 `1.75` 表示 1.75%，不是 0.0175。

![收益率曲线数据和返回列](/docs/images/help/zh/research/yield-curves-01.png)

## 读取百分点变化

使用 `transform="difference"` 返回相邻观察的百分点变化。收益率从 4.0% 变为 4.2% 时，变化是 `0.2` 个百分点。

```python
nominal_10y_change = data.yield_curve(
    "us_treasury_nominal",
    tenor="10Y",
    start="20200101",
    end="20251231",
    frequency="monthly",
    transform="difference",
)
```

百分点变化不是债券持有期收益，也不包含票息、久期或价格变化。研究债券总收益时不能直接用它代替。

## 月度和未完成周期

`partial_period="exclude"` 是默认值，会排除尚未结束的月度周期。只有明确需要观察未完成月份时才使用 `include`，并在结论中说明最后一期可能继续变化。

## 与中国市场数据对齐

美国收益率来自美国收盘观察。与 A 股、人民币 ETF 或国内期货比较时，不要默认同一个日历日期代表可同时交易的信息。应在代码中显式滞后美国序列，或在 Markdown 中清楚披露所用时区和信息可得规则。

## 检查真实运行结果

先检查样本起止日、缺失值和观察数，再运行相关、回归或检验。下图展示固定运行环境中的真实收益率研究输出；一次显著结果仍然只是样本内关联，不是因果结论或交易信号。

![收益率研究的统计输出](/docs/images/help/zh/research/yield-curves-02.png)

## 常见问题

### 某个实际收益率期限无法运行

实际曲线当前没有所有短期限。使用编辑器提示中的支持值，不要把名义期限或相邻期限静默替代。

### 返回的第一行变化为空

`difference` 需要前一条观察才能计算变化。第一条结果没有上一期时会为空，这是预期行为。

## 相关内容

- [使用研究数据目录](/docs/help/research/data-catalog)
- [使用 Python 研究运行环境](/docs/help/research/python-runtime)
- [怎样阅读时间序列关系研究](/docs/help/basics/time-series-relationships)
