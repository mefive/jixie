# 策略因子

本模块只有一个生产实现 [factor.ts](factor.ts)。`StrategyFactor` 集中管理策略引用的因子：准备源码、校验运行定义、生成报告来源快照。Factor 业务仍负责定义和发布；Signals 决定部署与运行何时核对哪些冻结快照；沙箱资源由 StrategyExecution / FactorHost 管理。

| 入口 | 消费者 | 职责 |
| --- | --- | --- |
| `StrategyFactor.extractKeys(source)` | definitions/visibility、backtests/submit、Sharing、fromStrategySource | 只扫描 ctx.factor 调用与 factors 声明中的字面量，过滤内置键并按顺序去重；不执行代码、不查库、不编译，不识别动态表达式 |
| `StrategyFactor.fromStrategySource(source, userId, usage)` | 回测、扫描、Signals 部署与运行 | 查询授权来源、校验发布状态及批准快照、编译 TS 或保留 Python 源码，返回 `StrategyFactor[]`；不启动 runtime |
| `StrategyFactor.validateRuntimeMetadata(factors, definitions)` | StrategyExecution、Signals 部署 | 检查运行定义是否完整及是否包含 research-only 输入；不修改或复制因子 |
| `StrategyFactor.dependenciesFromJson(value)` | Signals 持久化读取 | 校验并读取来源快照，保留 null 兼容语义 |
| `StrategyFactor.assertDependencies(expected, actual)` | Signals 部署与运行 | 规范化比较来源快照；选择比较对象和执行时机的业务规则留在 Signals |
| `factor` 只读属性 / `factor.toDependency(definition?)` | 执行与报告 | FactorHost 直接读取因子对象，报告仅输出来源快照，传入运行定义时附加实际 inputs；Engine 不接收源码 |

## 准备与隔离

| usage | 调用方 | 准入 |
| --- | --- | --- |
| research（默认） | backtests/run、扫描 Worker | published 或 archived |
| deployment | Signals.deployBacktestReport | 只许 published |
| signal | Signals Worker | published 或 archived，随后由 Signals 核对冻结血缘 |

自定义单因子只查询本人及内置用户，组合只查询本人；公开别人的因子不等于可直接作为自己的运行依赖。缺少请求键即拒绝。Panel 单因子保留批准报告资产范围，组合校验批准快照、哈希和研究范围，不改用当前可编辑组合。返回顺序与引用键顺序对应。

数据库仅在 fromStrategySource 确实需要查库时加载，编译器仅在准备 TS 源码时加载。导入类、提取引用、解析或比较快照均不因此启动数据库或加载编译器。准备中的源码转换、组合解码、资产范围解析及快照规范化都为类的私有方法，不保留旧函数的转发文件。

实例集中存放源码、身份和预期运行配置，组合组件保留不可变 StrategyFactor 实例。实际运行定义由 FactorHost 提供，校验不回写因子，也不创建附加元数据的因子副本。toDependency(definition) 结合来源身份和实际 inputs 生成独立报告快照；不传定义时仅返回来源身份。StrategyExecution 将 StrategyFactor[] 直接交给 FactorHost，读取元数据后复用同一批运行实例计算；各参数和日期区间使用独立执行对象。Signals 部署显式创建 FactorHost 做准入检查并 finally 关闭。

测试集中在 [factor.test.ts](factor.test.ts)，按引用提取、状态与元数据隔离、快照兼容、授权与源码准备分组。源码操作组在准备组之前验证不加载数据库和编译器；准备组使用独立重置的查询替身，并验证不启动 runtime。Signals 的快照选择与拒绝时机见 [runs/run.test.ts](../../signals/runs/run.test.ts)。

[返回 Strategy 总览](../README.md)

FactorHost 位于 [execution/factor-host.ts](../execution/factor-host.ts)。组合组件也使用 StrategyFactor，来源为批准快照中的嵌入源码，不重新查询当前组件；顶层报告仍只记录原组合依赖。已删除 CustomFactorModule 和 toEngineModule 转换。Engine 从 FactorExecutionPort.describe() 获取数据需求和批准资产范围。
