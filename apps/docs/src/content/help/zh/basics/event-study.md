# 怎样阅读事件研究

事件研究把多个公开事件对齐到“事件日”，检查事件附近标的收益是否超出市场基准。当前协议支持本地分红记录中 `divProc = 预案` 的公告，并使用显式指定的股票集合。

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

## 样本如何形成

1. 只保留研究日期内的预案公告。
2. 同一股票、同一报告期如有重复预案记录，保留最早公告。
3. 股票或基准在窗口内缺少任一日收益时，排除该事件。
4. 同一股票的两个事件窗口重叠时，保留较早事件，避免同一段收益被重复计入。

样本筛选页签会报告请求标的、区间内事件、完整窗口、重叠排除和最终样本数，用来核对选择过程。

## 区间、效应量和稳健性

平台把每个事件的 CAR 当作一个事件级观测，并按事件交易日聚类计算平均 CAR 的标准误、t 值与 95% 区间，允许同日公告共享市场冲击。标准化平均 CAR 用于评估效应大小；5% 缩尾平均 CAR 用于检查结论方向是否被少数极端事件驱动。

这个区间仍不会自动解决行业聚集或同一股票跨年事件的相关性。

## Python 教学复现

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
