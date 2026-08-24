# 使用 Python 研究运行环境

研究文档中的 Python Cell 运行在固定的 `research-py-v1` 环境中。固定环境让同一份源码在不同时间运行时使用一致的主要依赖，而不是临时安装一套未知版本的软件。

## 当前可以使用的包

| 包 | 适合的任务 |
| --- | --- |
| NumPy | 数组、线性代数、向量化计算和模拟 |
| pandas | 表格整理、连接、分组、滚动窗口和日期对齐 |
| SciPy | 概率分布、假设检验、优化、信号处理和数值算法 |
| statsmodels | 回归、HAC 协方差、时间序列模型、平稳性检验和诊断 |
| Matplotlib | 产品原生图表无法表达的自定义静态图 |
| scikit-learn | 预处理、模型选择、协方差估计和经典机器学习流程 |

NumPy 以 `np`、pandas 以 `pd` 预先提供；其他包按标准导入名使用。编辑器会对常用 SciPy 和 statsmodels 接口提供提示。

## 运行统计检验

1. 先用平台 `data.*` 方法读取并核对数据。
2. 在代码中显式处理缺失值、对齐日期和确定样本。
3. 从固定包导入现成检验或估计器，不要手写 p 值、回归或优化器。
4. 运行 Cell，记录样本数、统计量、区间和假设方向。
5. 在相邻 Markdown Cell 解释限制，不要只抄一个 p 值。

```python
from scipy import stats
import statsmodels.api as sm

clean = sample[["x", "y"]].dropna()
t_stat, p_value = stats.ttest_1samp(clean["x"], popmean=0.0)
model = sm.OLS(clean["y"], sm.add_constant(clean["x"])).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": 2},
)
print({"n": len(clean), "t": t_stat, "p": p_value})
model.summary()
```

![固定运行环境中的 SciPy 和 statsmodels 输出](/docs/images/help/zh/research/python-runtime-01.png)

## 选择图表方式

折线、散点、柱状、直方图和热力图优先使用 `charts.*`，它们在页面中可以悬停和缩放。只有产品原生图表无法表达时才使用 Matplotlib。

当前 Matplotlib 环境提供 DejaVu Sans，不提供中文字体。Matplotlib 图内标题、坐标轴、图例和标注应使用简洁英文；Markdown 说明和控制台文字仍然可以使用中文。

## 不能做什么

- 不能在 Cell 中运行 `pip install` 或临时增加包。
- 不能访问宿主目录、密钥或任意外部网络。
- 导入不在允许清单中的模块会在执行前或执行时失败。
- 不要为了绕过缺失包而自行重写成熟统计方法；记录能力缺口更可靠。
- 使用 scikit-learn 时必须事先确定训练、验证和测试区间，防止把未来数据泄漏到训练过程。

## 遇到缺失能力

先确认导入名是否正确，并查看编辑器提示。包确实不在当前运行环境时，在 Markdown 中记录缺少的能力和它对研究的影响；不要让 Agent 换用名称相似但统计含义不同的方法。

## 相关内容

- [查看研究输出](/docs/help/research/outputs)
- [读取美国国债收益率曲线](/docs/help/research/yield-curves)
- [怎样阅读多变量时间序列研究](/docs/help/basics/multivariate-time-series-relationships)
