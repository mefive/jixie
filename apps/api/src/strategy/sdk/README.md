# Strategy SDK

这里实现用户的策略声明、选股链、仓位构造、周期和指标辅助。公开接口不是 Engine 的内部类型。

| 入口 | 职责与消费者 |
| --- | --- |
| `packages/shared/src/sdk/strategy/reference.ts` | 公开 TS 签名与双语文档、Agent 参考；唯一手工维护的公开签名来源 |
| 同目录 `contract.ts` | `setup:sandbox` 复用声明生成器输出的编译契约；不要手改；通过 `@jixie/shared/sdk/strategy/contract` 类型导入 |
| [typescript.ts](typescript.ts) | `defineStrategy`、`enrich`、Universe、多周期与指标辅助；沙箱 entry 和可信测试 fixture 使用 |
| [contract.test.ts](contract.test.ts) | 公开成员、内部能力隔离与 Engine 基础签名兼容检查 |
| [typescript.test.ts](typescript.test.ts) | 选股、仓位与多周期行为验证 |

`defineStrategy` 接受公开 `CodeStrategy`，返回供 runtime 装配的内部 `EngineStrategy`；用户声明中的
`onBar` 接受独立 `StrategyCtx`，Engine 的基础回调接受 `EngineContext`。`enrich` 用明确的辅助成员
补齐公开上下文，并在返回处校验完整签名，不把 Engine 类型直接作为公开接口继承来源。
`loadCrossSection` 和 `resampledBars` 是内部能力，公开用户入口是 `universe` / `weekly` / `monthly`。
内部行情可以携带因子准备需要的额外字段，不因此扩展公开 OHLC 字段；SDK 不更改数据可见时间。

编辑器的 FactorKey 根据用户可用因子动态生成；供实现编译的 FactorKey 为 string，运行时仍按冻结依赖
校验。两者共用同一签名渲染器，不维护平行的 SDK 方法清单。文档 URL 保持不变；订单文档锚点使用 stock.* / futures.* 区分账户。

Python 的 `Strategy`、`Context`、`Universe` 实现在 `apps/api/src/strategy/sdk/python.py`，
方法改为 ctx.stock 下的 snake_case 命名，功能范围仍为股票和 ETF；`strategy/runtime/python/runner.py` 注入数据请求并处理协议与超时。
共享 Engine 不意味着两种语言功能完全对等，也不意味着 SDK 直接访问数据库或券商。

修改公开 TS 方法时：编辑 reference → 生成 contract → 修改 SDK/runtime → 静态类型及生成物一致性检查
→ 审查通过后做行为验证。SDK 只在声明和决策回调内使用；Engine 的账户/撮合与 Factor 的源码执行分别
由其所属模块维护。详细验收见 [设计记录](../../../../../docs/design/strategy-sdk-boundaries.md)。

## 账户与订单

公开上下文只通过 `portfolio.equity` 提供组合权益；`stock` 和 `futures` 分别提供权益、可用现金及账户操作。
TS 的 `enrich` 构造独立且完整校验的对象，不再修改或透出整个 EngineContext。现金手数与后复权股数
显式命名；ATR 仓位辅助使用现金账户权益。Python 同步整理已有现金操作，不新增期货交易。

新策略决策中，增量累加、重复目标覆盖。现金完整目标表不能与现金增量单混用；期货按代码检查。
清仓覆盖同标的先前普通指令，后续增量报错，后续目标可覆盖。持续条件单独立处理。
旧扁平 SDK 已移除；数据库中的源码、冻结部署不自动重写。历史报告可读，重新执行前需迁移源码。
见 [迁移说明](../../../../docs/src/content/help/zh/backtesting/edit-rerun.md)。

内部 EngineContext 同样按 portfolio / stock / futures 分组，Context 将操作交给带账户及单位名称的
OrderBook 方法。runtime 以 stock.* / futures.* 命令回放，并按账户发送临时 bar frame；
这些 IPC 数据不改变 Signals 持久化快照。SDK 复用账户基础能力并添加 stock 仓位辅助，
仍由独立公开契约检查完整签名。
