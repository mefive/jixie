# 怎样阅读事件研究

事件研究把多个公开事件对齐到“事件日”，检查事件附近标的收益是否超出市场基准。在当前产品中，样本规则、统计与图表需要写在 Research 的 Markdown/Python Cell 中。下文以“分红预案公告”为方法示例，不表示现在可以通过固定事件研究按钮直接运行。

## 先确认事件数据是否可用

先在[数据目录](/docs/help/research/data-catalog)核对事件定义和日期。当前 `data.equity_dividends()` 读取单只股票**已实施现金分红，并按除息日筛选**，不是分红预案公告样本。不能把除息日替换成预案公告日后仍沿用原研究问题。

如果问题要求预案公告，而公开 SDK 没有相应输入，应保留能力缺口，不生成声称已完成的事件检验。`charts.event_path()` 负责画已有结果，不会自动取得事件、筛选样本或计算显著性。旧对话图表的重查规则见[嵌入式分析](/docs/help/research/embedded-analysis)。

## 事件日和窗口

公告日先映射到公告当日或其后首个交易日，该日记为 0。`[-5, 5]` 表示从事件日前 5 个交易日到事件日后 5 个交易日，共 11 个收益观测。

本地公告只有日期，没有盘前、盘中或盘后时刻。因此第 0 日不能精确代表市场首次可以交易该信息的时刻，必须把这个限制与结论一起保留。

## AR、CAR 和 CAAR

市场调整模型用标的收益减去同日基准收益：

$$
AR_{i,\tau}=R_{i,\tau}-R_{m,\tau}
$$

一个事件在窗口内的累计异常收益是：

$$
CAR_i[a,b]=\sum_{\tau=a}^{b}AR_{i,\tau}
$$

对 $N$ 个事件的 CAR 取平均，得到 CAAR：

$$
CAAR[a,b]=\frac{1}{N}\sum_{i=1}^{N}CAR_i[a,b]
$$

事件时间路径展示每个相对交易日的平均异常收益和截至该日的 CAAR。如果累积在事件前就开始，可能存在预期、泄露、共同趋势或事件日误差。

## 示例样本应怎样形成

1. 只保留研究日期内的预案公告。
2. 同一股票、同一报告期如有重复预案记录，保留最早公告。
3. 股票或基准在窗口内缺少任一日收益时，排除该事件。
4. 同一股票的两个事件窗口重叠时，保留较早事件，避免同一段收益被重复计入。

需要在代码输出中逐项报告请求标的、区间内事件、完整窗口、重叠排除和最终样本数，用来核对选择过程；不会自动出现固定的样本筛选页签。

## 区间、效应量和稳健性

示例方法把每个事件的 CAR 当作一个事件级观测，可在代码中按事件交易日聚类计算平均 CAR 的标准误、t 值与 95% 区间，允许同日公告共享市场冲击。标准化平均 CAR 用于评估效应大小；5% 缩尾平均 CAR 用于检查结论方向是否被少数极端事件驱动。

这个区间仍不会自动解决行业聚集或同一股票跨年事件的相关性。

## Python 教学复现

以下只演示已准备输入后的统计步骤，假定 `stock_returns`、`benchmark_returns` 和 `event_trade_dates` 已按同一事件顺序对齐，完整窗口与重叠检查已经完成，且聚类数量足够。它不提供当前缺失的预案公告取数入口。

```python
import numpy as np
import statsmodels.api as sm

# rows: one row per event; columns: relative trading days
abnormal = stock_returns - benchmark_returns
event_car = abnormal.sum(axis=1)
caar_path = abnormal.cumsum(axis=1).mean(axis=0)

mean_car = event_car.mean()
fit = sm.OLS(event_car, np.ones((len(event_car), 1))).fit(
    cov_type="cluster",
    cov_kwds={"groups": event_trade_dates},
    use_t=True,
)
confidence_interval = fit.conf_int(alpha=0.05)[0]
```

## 结论边界

- 市场调整异常收益不是严格的因果反事实。同期公司消息、行业变化和事件选择都可能混杂结果。
- 事件公告可能是市场早已预期的信息，“公告附近有收益”不表示策略可交易。
- 调整事件窗口、标的集合或日期区间后反复查看结果，会引入多重尝试偏差。
- 当前模型只减去一个市场基准；它没有控制行业、规模、价值或其他同期风险暴露。

## 延伸阅读

- [SciPy：t 分布](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html)
- [怎样阅读两组分布比较](/docs/help/basics/distribution-comparison)
- [怎样阅读时间序列关系研究](/docs/help/basics/time-series-relationships)
