# 策略因子引用与运行准备

这里提供两种不同成本和责任的入口，Factor 仍拥有定义与发布，Signals 仍拥有部署血缘核对。

| 文件 / 入口 | 消费者 | 输入输出与副作用 |
| --- | --- | --- |
| [references.ts](references.ts) `extractFactorKeys` | definitions/drafts、visibility、backtests/submit、Sharing、prepare | 源码 → 字面量键数组；正则提取 ctx.factor 调用及 factors 声明，过滤引擎内置键，去重。调用中的键先于声明中的键，同组按出现顺序；不编译、不查库，不保证识别动态表达式 |
| [prepare.ts](prepare.ts) `prepareStrategyFactors` | 正式回测、扫描父 Worker、Signals 部署与运行 | 源码、userId、locale、usage → `{ modules, factors }`；查库、检查可用来源、编译／检查元数据并形成运行模块和依赖血缘 |

## 三个场景

| usage | 调用方 | 准入 |
| --- | --- | --- |
| research（默认） | backtests/run、扫描父 Worker | published 或 archived |
| deployment | Signals.deployBacktestReport | 只许 published |
| signal | Signals IPC Worker | published 或 archived，之后由 Signals 核对冻结血缘 |

自定义单因子只查询本人及内置用户，组合只查询本人；公开别人的因子不等于可直接作为自己的运行依赖。找不到任何请求键即拒绝。受控 research-only 输入不能进入策略准备，即使由内置 key 引用。

TS/Python 按各自语言准备，临时编译对象在 finally dispose；返回的是可传输模块和 FactorDependency，不把活动会话交给扫描 cell。Panel 单因子保留批准报告资产范围，组合解码并校验批准快照、哈希和研究范围，不能改用当前可编辑组合。模块顺序与引用键顺序对应。

扫描准备一次后直接传 modules 给所有 cell；正式回测附加 factors 为报告血缘；Signals 比较准备结果与部署／运行快照。完整回测、扫描和信号捕获各走自己的编排，不能用共享准备推导它们共享同一生命周期。

改提取看 [references.test.ts](references.test.ts)，改准备看 [prepare.test.ts](prepare.test.ts)；权限／可见性还看 [Strategy 路由测试](../routes/index.integration.test.ts)，冻结比对见 [Signals factor-inputs](../../signals/factor-inputs/README.md)。

[返回 Strategy 总览](../README.md)
