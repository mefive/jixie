# Factor SDK

这里放因子作者使用的工厂、Context 方法与 Python 对象。公开契约归 shared，源码加载、隔离、协议和资源生命周期归 [runtime](../runtime/README.md)。

| 入口 | 职责与消费者 |
| --- | --- |
| `packages/shared/src/sdk/factor/reference.ts` | TS 编写接口与双语说明的唯一手工来源；`buildFactorSdkDts` 供 Monaco 使用 |
| 同目录 `contract.ts` | `setup:sandbox` 生成的 API 编译契约；类型通过 `@jixie/shared/sdk/factor/contract` 导入，禁止手改 |
| 同目录 `python.ts` | Python 公开字段、版本及 `.pyi` 渲染；保持 shared 根级既有导出名 |
| [typescript.ts](typescript.ts) | `defineFactor` / `defineFactorV2` 工厂，以及 `CrossSectionalFactorContext.history`、`AssetFactorContext.value/lag`；实现生成契约，由 TS runtime 打包后在 isolate 内实例化 |
| [python.py](python.py) | Factor 工厂、FactorBar、横截面/资产 Context 与回调注册；不加载用户代码、不处理帧、不管理进程 |
| [contract.test.ts](contract.test.ts) | API 元数据/声明兼容，以及编辑器双语声明对合法与非法作者代码的检查 |

TS 横截面 `compute(bar, ctx)` 与 V2 `compute(ctx)`、Python 的工厂/装饰器调用方式保持不变。
TS runtime 的 [sandbox-bundle.ts](../runtime/typescript/sandbox-bundle.ts) 只打包此 SDK 与受信任的协议入口，在宿主进程缓存源码；每个因子仍在独立 isolate 中初始化。
SDK 接收宿主已准备的历史数组和声明字段，不查询数据库、不导入 Engine 或 runtime；全局注册、批量调用与错误处理属于 runtime。
宿主组装的 `FactorBar` 通过映射类型保留可写字段；脚本编辑器/编译契约的 Bar 保持 readonly，字段清单不重复维护。
TS 编辑器现有五个 V2 字段和 Python 的七个字段继续分别维护；runtime 的受控研究字段及业务准入不随目录迁移改变。
本次不扩充 TS 编辑器字段，不把不同语言的能力边界误写成完全对等。

两种语言的实现都按工厂、横截面 Context、资产 Context 组织；两个 Context 类采用相同业务名称。
TS 类由 runtime 构造，不增加用户脚本构造入口；公开类型名 `FactorCtx`、`TimeSeriesFactorCtxV2` 保持兼容。
TS 方法保持可解构调用；准备好的数组与声明字段集合保存在私有字段中，不新增公开数据属性。

| 公开能力 | TypeScript | Python |
| --- | --- | --- |
| 横截面定义 | `defineFactor({ name, window?, minCoverage?, compute })` | `Factor.cross_sectional(name=..., window=..., min_coverage=...)` |
| 时间序列 / 面板定义 | `defineFactorV2`，用 `analysisKind` 区分 | `Factor.time_series` / `Factor.panel` |
| 计算函数注册 | 对象中的 `compute` | `@factor.compute` |
| 横截面历史 | `ctx.history(n, field?)` | `ctx.history(periods, field="close")` |
| 资产当前值 / 历史值 | `ctx.value(field)` / `ctx.lag(field, periods)` | 相同方法名 |

本次只统一内部组织与职责，保留语言原有公开入口和行为，不引入新旧工厂兼容层。
已知差异继续保留：TS `history` 非正窗口返回空数组，Python 报错；TS 未知历史字段回退到收盘价
（类型声明不允许该调用），Python 报错；TS 收盘价历史声明省略第二参数，Python 还允许显式 `"close"`。
这些差异以及上面的字段范围不作为本次整理的隐式变更；若统一行为或改公开工厂，须另行评估存量代码兼容。

Python 运行器位于 [runner.py](../runtime/python/runner.py)，它在隔离进程内注册 `jixie` 模块并加载用户定义。
sandboxd 仅分派到该业务入口；Dockerfile 保留业务目录结构并显式打包 SDK 与 runner，二者同时影响 API/sandboxd 部署。
生成 `.pyi` 仍位于 `apps/sandboxd/python/jixie_factor_sdk.pyi`；它是静态声明，不是执行实现。

契约修改流程：shared 来源 → 生成声明 → SDK/runtime 适配 → 静态检查 → 人工审查 → 行为验证。
本次实施与验证状态见 [统一 SDK 计划](../../../../../docs/design/business-sdk-organization.md)。
