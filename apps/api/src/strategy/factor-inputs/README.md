# 策略因子引用与运行准备

这里分开源码准备、运行元数据装配与血缘核对；Factor 仍拥有定义与发布，Signals 决定部署与运行需要核对哪些冻结快照。

| 文件 / 入口 | 消费者 | 输入输出与副作用 |
| --- | --- | --- |
| [references.ts](references.ts) `extractFactorKeys` | definitions/drafts、visibility、backtests/submit、Sharing、prepare | 源码 → 字面量键数组；正则提取 ctx.factor 调用及 factors 声明，过滤引擎内置键，去重。调用中的键先于声明中的键，同组按出现顺序；不编译、不查库，不保证识别动态表达式 |
| [prepare.ts](prepare.ts) `prepareStrategyFactors` | 正式回测、扫描父 Worker、Signals 部署与运行 | 源码、userId、usage → `{ modules, factors }`；查库、检查可用来源、编译 TS／保留 Python 源码，形成可传输模块和不含运行输入字段的依赖记录 |

## 三个场景

| usage | 调用方 | 准入 |
| --- | --- | --- |
| research（默认） | backtests/run、扫描父 Worker | published 或 archived |
| deployment | Signals.deployBacktestReport | 只许 published |
| signal | Signals IPC Worker | published 或 archived，之后由 Signals 核对冻结血缘 |

自定义单因子只查询本人及内置用户，组合只查询本人；公开别人的因子不等于可直接作为自己的运行依赖。找不到任何请求键即拒绝。受控 research-only 输入在执行初始化时拒绝，即使由内置 key 引用。

准备阶段不启动 FactorRuntime。Panel 单因子保留批准报告资产范围，组合解码并校验批准快照、哈希和研究范围，不能改用当前可编辑组合。模块顺序与引用键顺序对应。

[metadata.ts](metadata.ts) 的 `resolveStrategyFactorMetadata` 消费 FactorHost.describe 返回的定义，装配 window/inputs、汇总组合输入并拒绝 research-only 字段。装配结果用于 Engine 行情加载和完整报告血缘。此函数不创建 runtime、不查数据库。

共享模拟创建 FactorHost，读取元数据后复用同一批实例计算；扫描父进程只准备源码，各 cell 自己初始化。Signals 部署没有模拟，显式创建一次 FactorHost 做准入与元数据检查并 finally 关闭；信号运行将部署／运行快照交给共享模拟，在 Engine 开始前严格比较完整血缘。[lineage.ts](lineage.ts) 提供原 Signals 使用的 JSON 解析和规范化比较，兼容规则不变。

改提取看 [references.test.ts](references.test.ts)，改准备看 [prepare.test.ts](prepare.test.ts)；权限／可见性还看 [Strategy 路由测试](../routes/index.integration.test.ts)，冻结比对见 [Signals factor-inputs](../../signals/factor-inputs/README.md)。

[返回 Strategy 总览](../README.md)
