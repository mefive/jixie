# 可信跨市场研究：收益、汇率与相关性

> 学习路径 · 预计 60～90 分钟 · 需要会运行 Python Cell，但不要求事先掌握时间序列统计。

这项练习研究一个有限问题：**2015～2025 年间，沪深 300、恒生指数和标普 500 的人民币月收益相关性有多高，
这种关系是否随时间变化？** 目标是学会建立可反驳、可复现的证据，不是选出历史收益最高的市场或给出配置比例。

## 学完以后

你应该能够：

1. 区分价格指数、可交易 ETF、本币收益和人民币收益；
2. 说明为什么跨市场数据必须按 `availableDate` 而不是相同日历日期对齐；
3. 在看结果前固定问题、样本、变量和失败条件；
4. 同时阅读全样本相关、滚动相关和区块 bootstrap 区间；
5. 把结论限制在历史描述，不把相关性直接写成因果或配置建议。

## 开始前先补齐前置知识

- 第一次使用研究文档时，先完成[第一次完成量化研究](/docs/help/getting-started/first-research)。
- 不熟悉价格指数和 ETF 时，先读[股票、ETF 和指数](/docs/help/basics/stocks-etfs-indices)。
- 不熟悉币种换算时，先读[怎样比较中港美市场收益](/docs/help/basics/cross-market-returns)。

## 第一步：在看数据前冻结问题

在第一格 Markdown Cell 写下：

```text
问题：2015-01 至 2025-12，沪深 300、恒生指数和标普 500 的人民币月收益相关性有多高，
      36 个月滚动相关是否稳定？

事前预期：三地相关性为正但显著低于 1；滚动相关会随市场阶段变化。
主要证据：完整月度样本的 Pearson 相关、36 个月滚动相关、12 个月区块 bootstrap 95% 区间。
反证条件：若相关长期接近 1，或区间宽到无法区分低、中、高相关，则“存在稳定分散化”不能成立。
样本：2015-01 至 2025-12，不在看结果后修改起止日。
结论边界：价格指数不含股息，人民币换算不等于 ETF 实际回报，本研究不包含成本，也不证明因果。
```

这个预期不是要强行证明“分散化有效”。它先声明什么结果会削弱结论，防止看到某一段低相关后才改写问题。

## 第二步：冻结数据语义

| 研究对象 | 稳定 ID | 本币 | 人民币口径 | 不能替代的对象 |
| --- | --- | --- | --- | --- |
| 沪深 300 价格指数 | `equity.cn.csi300.price` | CNY | 与本币相同 | `510300.SH` ETF |
| 恒生价格指数 | `equity.hk.hsi.price` | HKD | HKD/CNY 换算 | `159920.SZ` ETF |
| 标普 500 价格指数 | `equity.us.spx.price` | USD | USD/CNY 换算 | `513500.SH` ETF |

三条序列都是**价格指数**，不包含股息再投资，也不能按指数点位成交。香港和美国收盘数据只在严格更晚的首个
上交所交易日进入中国收盘信息集。Research loader 已按 `availableDate` 处理；不要在 Python 中重新按源市场
日历日期拼接。

## 第三步：读取月收益并验证汇率分解

新建 Python Cell，读取本币与人民币月收益。`partial_period="exclude"` 会排除未完成月份；这里的结束日已经是
完整历史年份，但仍显式保留这一研究规则。

```python
import numpy as np
import pandas as pd

START = "20150101"
END = "20251231"


def series_column(frame: pd.DataFrame, column: str) -> pd.DataFrame:
    return frame.rename(columns={"value": column}).set_index("date")


returns = pd.concat(
    [
        series_column(
            data.series(
                "index",
                "equity.cn.csi300.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "csi300_cny",
        ),
        series_column(
            data.series(
                "index",
                "equity.hk.hsi.price",
                start=START,
                end=END,
                measure="market.adjusted_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_local",
        ),
        series_column(
            data.series(
                "index",
                "equity.hk.hsi.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_cny",
        ),
        series_column(
            data.series(
                "index",
                "equity.us.spx.price",
                start=START,
                end=END,
                measure="market.adjusted_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "spx_local",
        ),
        series_column(
            data.series(
                "index",
                "equity.us.spx.price",
                start=START,
                end=END,
                measure="market.cny_close",
                frequency="monthly",
                transform="simple_return",
                partial_period="exclude",
            ),
            "spx_cny",
        ),
    ],
    axis=1,
    join="inner",
).dropna().sort_index()

returns["hsi_fx"] = (1 + returns["hsi_cny"]) / (1 + returns["hsi_local"]) - 1
returns["spx_fx"] = (1 + returns["spx_cny"]) / (1 + returns["spx_local"]) - 1

hsi_identity_error = (
    (1 + returns["hsi_local"]) * (1 + returns["hsi_fx"]) - (1 + returns["hsi_cny"])
).abs().max()
spx_identity_error = (
    (1 + returns["spx_local"]) * (1 + returns["spx_fx"]) - (1 + returns["spx_cny"])
).abs().max()

pd.Series(
    {
        "observations": len(returns),
        "first_month": returns.index.min(),
        "last_month": returns.index.max(),
        "hsi_identity_max_error": hsi_identity_error,
        "spx_identity_max_error": spx_identity_error,
    }
)
```

先检查观察数、首尾月份和分解误差，再计算任何统计量。共同样本少于预期时，应检查平台返回的缺失汇率诊断，
不能用无限期前填补造人民币收益。

## 第四步：比较全样本和滚动相关

```python
cny_columns = ["csi300_cny", "hsi_cny", "spx_cny"]
full_sample_correlation = returns[cny_columns].corr()

rolling_correlation = pd.DataFrame(index=returns.index)
rolling_correlation["CSI 300 / Hang Seng"] = returns["csi300_cny"].rolling(36).corr(
    returns["hsi_cny"]
)
rolling_correlation["CSI 300 / S&P 500"] = returns["csi300_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation["Hang Seng / S&P 500"] = returns["hsi_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation = rolling_correlation.dropna().reset_index()

full_sample_correlation.round(3)
```

再用独立 Python Cell 画图：

```python
charts.line(
    rolling_correlation,
    x="date",
    y=["CSI 300 / Hang Seng", "CSI 300 / S&P 500", "Hang Seng / S&P 500"],
    title="36-month rolling correlation of CNY price-index returns",
)
```

全样本相关把十一年压成一个数字；滚动相关展示关系是否随阶段改变。滚动窗口高度重叠，相邻点不是独立证据，
所以不能把每次上升和下降都解释成新的市场机制。

## 第五步：用区块 bootstrap 表达不确定性

普通逐月重抽样会破坏时间顺序。下面固定随机种子，以 12 个月连续区块重抽样，保留一部分短期依赖。区块长度是
方法选择，不是客观真理；换成合理的相邻长度应作为敏感性检查，而不是挑出最好看的区间。

```python
def block_bootstrap_correlation(
    frame: pd.DataFrame,
    left: str,
    right: str,
    block_length: int = 12,
    resamples: int = 5000,
    seed: int = 20260825,
) -> pd.Series:
    paired = frame[[left, right]].dropna().to_numpy()
    observation_count = len(paired)
    if observation_count < block_length * 2:
        raise ValueError("Sample is too short for the chosen block length")

    random = np.random.default_rng(seed)
    block_count = int(np.ceil(observation_count / block_length))
    maximum_start = observation_count - block_length + 1
    estimates = np.empty(resamples)

    for sample_index in range(resamples):
        starts = random.integers(0, maximum_start, size=block_count)
        indices = np.concatenate(
            [np.arange(start, start + block_length) for start in starts]
        )[:observation_count]
        sample = paired[indices]
        estimates[sample_index] = np.corrcoef(sample[:, 0], sample[:, 1])[0, 1]

    return pd.Series(
        {
            "estimate": np.corrcoef(paired[:, 0], paired[:, 1])[0, 1],
            "ci_low": np.quantile(estimates, 0.025),
            "ci_high": np.quantile(estimates, 0.975),
            "observations": observation_count,
            "block_months": block_length,
        }
    )


correlation_intervals = pd.DataFrame(
    {
        "CSI 300 / Hang Seng": block_bootstrap_correlation(
            returns, "csi300_cny", "hsi_cny"
        ),
        "CSI 300 / S&P 500": block_bootstrap_correlation(
            returns, "csi300_cny", "spx_cny"
        ),
        "Hang Seng / S&P 500": block_bootstrap_correlation(
            returns, "hsi_cny", "spx_cny"
        ),
    }
).T

correlation_intervals.round(3)
```

区间宽表示有限样本无法精确定位相关性。它不是“未来 95% 的相关性会落在这里”，也没有自动解决结构突变、
极端月份或数据选择问题。

## 怎样写结论

用下面的结构写最后一格 Markdown Cell，并替换方括号中的真实输出：

```text
在固定的 2015-01 至 2025-12 完整共同样本中，三组人民币价格指数月收益相关为 [...…]。
36 个月滚动相关的范围是 [...…]，说明 [...…]。
12 个月区块 bootstrap 的 95% 区间是 [...…]；最不确定的关系是 [...…]。

这些结果支持／不支持“历史相关显著低于 1”，但不足以证明未来分散化稳定。
价格指数不含股息，人民币换算不等于 ETF 收益，且未计费用、跟踪误差、税费和再平衡成本。
下一步若研究可交易组合，应改用明确 ETF 代理、冻结再平衡规则，并加入成本和样本外区间。
```

不要只写“相关性低，所以值得买”。如果全样本、滚动窗口和区间给出不同强度的证据，应保留这种不一致。

## 完成检查

- [ ] Markdown Cell 在运行前写明问题、预期、反证条件和样本区间；
- [ ] 代码使用稳定 ID、`market.cny_close` 和完整月度观察；
- [ ] 输出记录共同样本的首尾日期、观察数和汇率分解误差；
- [ ] 同时查看全样本、滚动窗口和区块 bootstrap 区间；
- [ ] 结论区分价格指数与 ETF、历史描述与未来判断；
- [ ] 在干净环境完整运行全文，并封存一个不可变研究版本。

全部完成后，这项练习证明你能够保留一份可复查的跨市场研究记录；它不证明三地配置具有正的费后收益。

## 下一步

- [沪深 300 趋势策略：参数、成本与样本外](/help/learning/csi300-trend-strategy)
- [研究文档与运行记录](/docs/help/research/records)
- [查看研究输出](/docs/help/research/outputs)
- [怎样阅读时间序列关系研究](/docs/help/basics/time-series-relationships)
- [收益和风险指标](/docs/help/basics/performance-risk)
