# Research 作者 SDK

Cell 可直接使用 `data`、`results`、`valuation`、`charts`。实际实现位于 `python/`，由
[runtime/python/runner.py](../runtime/python/runner.py) 创建对象并注入 Cell namespace；reset 重建这些对象。
Research 当前只有 Python 作者接口，不增加空的 TypeScript SDK。

| 对象 | 实现 | 公开方法 |
| --- | --- | --- |
| `data` | [python/data.py](python/data.py) | `series`、`cross_section`、`panel`、`yield_curve`、`macro`、`fx`；商品收益/仓单/持仓；市场状态；股票基本面/财务值/报表/指标/财务截面与面板/资金流/分红；ETF 份额、指数估值、行业状态、期货结算 |
| `results` | [python/results.py](python/results.py) | `factor_report`、`backtest_report`、`strategy_scan_report`、`factor_weather` |
| `valuation` | [python/valuation.py](python/valuation.py) | `fcff_scenarios`、`implied_revenue_growth` |
| `charts` | [python/charts.py](python/charts.py) | `line`、`area`、`bar`、`scatter`、`event_path`、`histogram`、`boxplot`、`heatmap` |

`data/results` 接收 [ResearchHost](python/host.py) 的 `request(method, arguments)` 能力和 pandas 对象；
SDK 负责调用参数组装、公开列映射及 DataFrame 转换，宿主 runtime 负责消息帧、查询、权限和输入回放。
`valuation` 接收 pandas，保留既有 NumPy/SciPy 数值实现；`charts` 生成 `_ChartResult`，纯标量转换归
[scalars.py](python/scalars.py)。SDK 不导入 runtime，不管理会话、信号计时器、Cell 变量或图像输出。

公开签名、枚举、返回列和双语说明的真相源为
[shared/sdk/research/contract.ts](../../../../../packages/shared/src/sdk/research/contract.ts)。同目录的
`python-signature.ts`、`python-stub.ts`、`agent-catalog.ts` 服务 Pyright、文档与 Agent。
`pnpm setup:sandbox` 继续生成原路径 `apps/sandboxd/python/jixie_research_sdk.pyi`，生成物不承担实现。
当前内部类名保留 `_DataApi` 等；作者使用的是注入对象，不需要自行构造这些类或修改已有 Cell。

验收入口：[独立 SDK 注入测试](python/sdk.test.ts)、[Python 会话回归](../runtime/python/session.test.ts)、
[FCFF 数值回归](../templates/fcff/valuation-template.test.ts)、[镜像输入打包测试](../runtime/python/packaging.test.ts)。
打包测试不能替代真实 Docker 验收；Python 源文件须同步 Dockerfile、`.dockerignore` 和部署影响清单。

[宿主协议与分派](../runtime/host/README.md) · [运行时](../runtime/README.md) · [返回 Research 总览](../README.md)
