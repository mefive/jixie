# TypeScript SDK Context 构造对齐

状态：方案、精确提交信息及人工代码 review 已确认，必要验证全部通过。
提交信息：`refactor(sdk): align TypeScript SDK context construction`。

## 交付与阅读顺序

Strategy 与 Factor 都按定义工厂 → Context 构造 → 公开方法阅读，Runner 负责：

```ts
const capabilities = adapter.bind(input);
const context = new StrategyContext(capabilities, parameters);

await strategy.onBar(context);
```

Factor 已经在 Runner 创建 CrossSectionalFactorContext / AssetFactorContext，本轮以它为基准。
StrategyContext 实现 shared 的 StrategyCtx，私有能力字段提供基础数据和操作；enrich 删除，工厂不再构造 Context。
工厂保留定义／参数规范及简单回调转发，从而保持作者对象作为 JavaScript callback receiver 和动态回调读取。
Python Strategy 已采用 Context(capabilities, params)，本轮仅适配 TS，不变更 Python 运行实现。

Strategy SDK 入口位于 [typescript.ts](../../apps/api/src/strategy/sdk/typescript.ts)，包含工厂、Context、参数与周期规则。
其专有辅助按职责独立：

- [stock-account.ts](../../apps/api/src/strategy/sdk/stock-account.ts)：账户转发、live getter、等权／ATR／逆波动率仓位。
- [universe.ts](../../apps/api/src/strategy/sdk/universe.ts)：内存选股链。
- [timeframe-series.ts](../../apps/api/src/strategy/sdk/timeframe-series.ts)：已完成周／月的序列。
- [indicators.ts](../../apps/api/src/strategy/sdk/indicators.ts)：日频／多周期／仓位复用的原有计算。

Strategy 有更多业务方法，仍比 Factor Context 大；统一类形态、装配位置与阅读步骤，辅助算法保持。
不引入跨业务 SDK 基类或新 package。共享 Contract、Monaco、Agent 文档和用户源码写法保持。

## 责任与兼容

- SDK 声明并消费 Capabilities；Adapter 实现基础能力；Runner 绑定、构造 Context 并调用公开回调。
- 内部 StrategyDefinition 的 onBar 接收公开 Context，不再接收能力对象。仅内部消费者需要适配。
- 参数仍复制、冻结且不可直接替换；公开 Context 方法仍支持解构、作为自身可枚举属性出现。
- 账户 getter、portfolio/futures 引用与原始方法调用保持；能力对象保存在私有字段中。
- Context 的原型由普通对象变为 StrategyContext.prototype；公开接口没有新增构造入口或成员。
- TS 即时 command、Python done 后重放、Adapter 缓存与 bridge/Transport 语义保持。
- 可信测试 compile 及 Python 对照 fixture 通过 createFixtureEngineStrategy 显式适配 Engine 回调，
  不用公开 Context 类型断言绕过能力注入；生产仍在 isolate 执行用户源码。

没有数据库、HTTP、字段口径、PIT、撮合、持久化源码、部署 workspace 或跨包构建依赖变化。
SDK 仍只依赖自己的模块、shared 类型与已有纯计算；既有部署影响清单覆盖 Strategy TS 路径。

## 审查与验证

审查前仅运行全仓类型／生成物一致性／后端边界、格式、lint、引用、链接及 diff 静态检查。
准备的回归包含 Context 完整签名、方法解构／枚举、参数快照与冻结、能力隔离、作者 receiver、
每日 Context 独立、原有账户／选股／周期／指标、工厂和覆盖参数、真实 sandbox bundle 边界。

人工 review 后运行 SDK / TS-Python runtime / 相关 Engine 和执行消费者，以及源码／编译 Worker 的
策略／因子语言组合、Signals、Scan 与退出路径；构建 shared/API 并验证编译后的 SDK/Runner 入口。
隔离测试按现有 fixture 使用临时数据库并释放资源；不启动开发服务或变更开发数据库。

### 审查前静态结果

- 全仓 `pnpm typecheck` 通过；shared、API、Web、Docs、sandboxd 类型检查及 SDK 生成物一致性通过。
- 后端边界扫描覆盖 887 个文件、3295 条运行时边、867 条类型边，0 违规；SDK 没有新增宿主依赖。
- 所有本轮 TS 文件的 ESLint、Prettier 检查通过，原计算辅助仅按职责迁移。
- 源码 enrich 引用已移除；本轮 Markdown 的相对文件链接有效，diff 与新文件空白检查通过。

### 审查后验证结果（2026-10-09）

- SDK、Strategy TS/Python runtime、Factor SDK/TS runtime、Engine Context、因子执行、扫描和 Signals
  相关回归 38 个文件、294 项通过，包含私有能力、参数冻结、方法解构／枚举、作者 receiver、
  新旧参数快照独立、指标／账户／选股／周期和原有沙箱隔离／同步错误语义。
- 真实源码 Worker 14 项通过；dist 生产入口的同组 Worker 14 项通过，覆盖四种策略／因子语言组合、
  连续扫描、Signals、错误路径、启动恢复及进程退出。
- 编译后的 SDK／Runner 检查 2 项通过：五个 SDK 文件均进入 bundle，Engine/Prisma 和外部 import 不进入；
  实际 isolate 上执行三日回测，Context 每日独立，冻结参数与 override、原始 callback receiver、
  解构指标／选股／周期／账户方法、成交和日志全部正常。
- 后端边界检查器自测 33 项通过；shared/API 构建通过，生成声明与公开作者 Contract 保持。

全部验证首次通过，没有审查后产品修订或测试断言调整。Python 使用本地 3.13.3；
相关 Worker 使用隔离 SQLite，关闭数据库连接及子进程；TS isolate 在 finally 释放，验证进程全部退出。
本轮不涉及 UI 变化，没有启动开发服务或执行浏览器 E2E，也没有改写开发数据库。

审查和行为验证已完成，按预定信息自动提交，不 push。
