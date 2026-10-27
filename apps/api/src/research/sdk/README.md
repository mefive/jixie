# Research 作者 SDK

Cell 可直接使用 `data`、`results`、`charts`。实现位于 `python/`，由
[sandbox/python/research_runner.py](../sandbox/python/research_runner.py) 通过 [bindings.py](python/bindings.py) 创建对象并注入 namespace；reset 重建对象和 Cell 变量。Research 当前只有 Python 作者接口。

| 对象 | 实现 | 公开方法 |
| --- | --- | --- |
| `data` | [python/data.py](python/data.py) | 市场序列、横截面、Panel、财报与财务指标，以及当前保留的数据查询 |
| `results` | [python/results.py](python/results.py) | `factor_report`、`backtest_report`、`strategy_scan_report` |
| `charts` | [python/charts.py](python/charts.py) | `line`、`area`、`bar`、`scatter`、`event_path`、`histogram`、`boxplot`、`heatmap` |

`data/results` 接收 [ResearchCapabilities](python/capabilities.py) 的 `request(method, arguments)` 能力。SDK 负责参数组装、公开列映射及 DataFrame 转换；宿主负责消息帧、查询与权限。`charts` 生成 `_ChartResult`，标量转换归 [scalars.py](python/scalars.py)。SDK 不管理会话、计时器、Cell 变量或图片输出。

公开签名、返回列和双语说明来自 [shared/sdk/research/contract.ts](../../../../../packages/shared/src/sdk/research/contract.ts)。Python signature/stub、Agent catalog、编辑器和 SDK 文档共同消费此契约。`pnpm setup:sandbox` 生成 `apps/sandboxd/python/jixie_research_sdk.pyi`，不从 Prisma 推断公开接口。

创建绑定使用 `create_research_sdk(capabilities, pandas_module)`，ResearchAdapter 提供请求能力。财务分析方法由用户在普通 Python 中编写；没有专用文档模板或内置估值模型。

验收入口：[SDK 注入测试](python/sdk.test.ts)、[Python 会话回归](../sandbox/research-sandbox-pool.test.ts)、[镜像输入打包测试](../sandbox/python/packaging.test.ts)。打包测试不替代真实镜像验收，Python 文件变更须同步 Dockerfile、`.dockerignore` 和部署影响清单。

[宿主协议与分派](../sandbox/host/README.md) · [运行时](../sandbox/README.md) · [返回 Research 总览](../README.md)
