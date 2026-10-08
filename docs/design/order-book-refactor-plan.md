# OrderBook 重构计划与新 session 交接

状态：2026-09-29 本轮单一提交已完成人工代码审查及全部约定验证；实现、测试与本文一并提交。

## 任务与当前基线

重构目标文件：`apps/api/src/backtesting/order-book.ts`。延续当前 session 对 Engine 的整理方式：实例持有稳定依赖，类内部处理自己的状态与业务细节，调用方只表达必要的执行步骤；命名表达真实行为，不靠功能开关、空对象或重复参数隐式控制流程。

仓库：`/Users/liucong/Projects/jixie`。计划创建时 HEAD 为 `b15ee93d`，实施前重新检查 Git 状态和 HEAD，保留用户后续修改。

本 session 已提交的重要变更：

- `58bda002`：EngineData 统一初始数据加载。
- `cd9b4b05`：FactorEvaluator 内部持有定义索引、错误去重状态。
- `bd5c2c84`：因子侧提供 FactorDescription；归因 Tracker 始终创建，现金账户归因不依赖因子是否存在。
- `b15ee93d`：删除期货启用开关，账户统一执行生命周期。

最近验证：301 项测试通过，3 项默认关闭的会计集成／历史性能测试跳过；全仓构建通过；隔离股票与混合账户 E2E 通过。记录见 [执行职责设计记录](execution-naming-and-ownership.md)。这些是重构前基线，不能替代本次修改后的验证。

本次只交付计划，没有创建新 session，也没有修改实现或提交该计划。

## 已确认、不能退回的设计

1. Engine 创建并持有 EngineData、CashPortfolio、FuturesPortfolio、OrderBook、AllocationAnalysisTracker；它们共享实例，不复制账户。
2. 两个账户始终存在。不恢复 futuresEnabled、stockOrdersEnabled，不以账户资金为零表示接口禁用。
3. accounts 是初始资金配置；缺省现金账户 100%、期货账户 0%。旧 futures 字段兼容接收但忽略。资金不足由正常成交规则处理，不自动跨账户转账。
4. EngineData 负责市场数据；FactorHost/FactorDescription 负责因子元数据与需求汇总。OrderBook 不解析因子定义或策略源码。
5. AllocationAnalysisTracker 始终存在，只归因股票／ETF 现金账户；没有分类的实际持仓归入 other，不能把期货盈亏纳入。
6. Engine 调用顺序：检查退市持仓 → 当天订单执行 → 期货结算 → 记录收盘 → 输出进度 → onBar 决策。OrderBook 不调用 onBar，不推进交易日，不承担每日结算或结果汇总。
7. Python 和 Signals 的能力限制独立于旧 futures 声明。retainFinalState 仍只支持现金账户：正期货资金配置提前拒绝，实际期货订单意图也拒绝。
8. assert 表示检查并抛错；ensure 适用于补齐状态或资源。不要仅为了统一前缀机械重命名。

## 当前实现与问题

OrderBook 目前通过构造参数保存 engineData、cashPortfolio、futuresPortfolio、cost；executeOpen 不再传入账户是合理的。其状态有三种寿命：

| 状态 | 当前字段 | 寿命 |
| --- | --- | --- |
| 本次策略决策 | date、decision | beginDecision 到 commitDecision |
| 等待执行的普通指令 | pendingTargets、pendingTargetDecisionDate、pendingOrders、pendingLotOrders、pendingFutureIntents | 决策提交后到各自执行步骤消费 |
| 持续生效的条件单 | conditionalOrders | 跨决策保留，触发、取消或清仓清理后结束 |

需要解决的具体问题：

- executeOpen 每日传入同一个 allocationTracker，并每次重新创建日志闭包；这两个稳定依赖与账户依赖的传递方式不一致。
- executeOpen 不只处理开盘价，还会基于当天 OHLC 处理条件单。当前名字不能完整表达实际模拟范围。
- 开盘执行方法夹杂数据准备、前后权重、归因、订单执行与清空、回调，阅读主顺序需要理解大量局部细节。
- pending 状态散落在五个字段和一个日期字段里，与 decision 使用另一套命名；容易遗漏某一步的消费或误解 null 与空 Map。
- 现金调仓与普通增减订单重复了成交检查和填单参数；但条件单的触发、滑点及价格边界不同，不能直接全部合成一个万能 fill 方法。
- 条件单方法同时做分组、候选优先级、成交价格选择、账户更新、删除订单和高水位更新；这些是不同阅读步骤。

不以文件行数或类的数量作为验收标准。OrderBook 仍是指令收集与执行的所有者，不拆成一组只转发参数的类。

## 推荐实现方案

建议作为一个完整、可审查的变更完成。以下是实现顺序，不是拆成多个交付阶段。

建议提交消息：

`refactor(engine): clarify order book execution ownership`

此消息需在新 session 的 Gate 1 中与用户确认后再开始实现。

### 1. 稳定依赖在构造时注入

在 OrderBookInput 增加必填 allocationTracker，以及具名日志通知 onRebalance。维持必填通知，测试可显式传入空函数，不新增“有没有 tracker/回调”的启用判断。

接口目标：

```ts
interface OrderBookInput {
  engineData: EngineData;
  cashPortfolio: CashPortfolio;
  futuresPortfolio: FuturesPortfolio;
  allocationTracker: AllocationAnalysisTracker;
  cost: CostModel;
  onRebalance: (date: string) => void;
}

// Called once during engine initialization.
this.orderBook = new OrderBook({
  engineData: this.engineData,
  cashPortfolio: this.cashPortfolio,
  futuresPortfolio: this.futuresPortfolio,
  allocationTracker: this.allocationTracker,
  cost,
  onRebalance: (date) => this.logRebalance(date),
});

// Called once per trading day, before settlement and the next decision.
await orderBook.executeOrders(date, previousDate);
```

onRebalance 只通知现有调仓执行步骤已经完成，消息格式留在 Engine。不要将回调推迟到整天执行完以后；后续现金／期货步骤可能失败，改变回调时点会改变已有日志语义。

Tracker 的权重计算与 captureRebalance 留在调仓步骤内，它需要在持仓修改前后读取同一组账户状态。不要为了让 OrderBook “纯粹”而把细节重新暴露回 Engine，或新建通用事件总线。

### 2. 入口命名与主顺序

把 executeOpen 改名为 executeOrders，注释说明其执行当日待执行指令和盘中条件单模拟。当前私有 executeOrders 相应改为 executeCashOrders 或更精确的名称，避免同名冲突。

主入口读起来应能直接看到以下顺序：

1. 保存执行前已持仓证券集合。
2. 有 previousDate 时处理期货换月；带显式期货意图的逻辑代码仍跳过自动换月。
3. 执行待调仓目标：加载所需行情 → 前权重 → 调仓 → 后权重及归因 → 消费目标 → 日志通知。
4. 执行股数／手数订单：加载行情 → 转换与合并 → 先卖后买 → 消费普通订单。
5. 清理刚清仓证券的退出类条件单。
6. 执行持续条件单：加载行情 → 当日触发及成交 → 更新保留订单状态。
7. 有 previousDate 时执行期货意图，并消费该批意图。

将有独立数据准备、执行及收尾的步骤提取成私有方法，例如 executePendingRebalance、executePendingCashOrders、executeActiveConditionalOrders、executePendingFutureIntents。不要为一行字段读取增加包装方法；期货 roll 若在主入口已清楚，可以直接保留。

保留 previousDate：它是期货映射所用的决策时点，不是“是否启用期货”的判断。禁止为了简化签名而改为总用当天映射。

### 3. 显式整理三种状态寿命

- date 改成 decisionDate，表达 trailingStop/条件单创建等操作使用的日期。
- decision 继续负责本次 onBar 的指令收集和同步参数校验。
- 将普通待执行状态收拢为一个私有 PendingOrders 对象，字段包含 decisionDate、targets、shareOrders、lotOrders、futureIntents；不包含持续条件单。
- 用明确的工厂函数创建空决策和空待执行状态；无需继承、状态机库或多个包装类。
- 各执行步骤只消费属于自己的 pending 字段，不在执行前一次性清空，也不使用 finally 清空；保留当前异常发生时的中间状态和回调时序。
- conditionalOrders 继续由同一个 OrderBook 持有。它不应随一次空决策或普通订单消费而被清空。
- hasFutureIntents 继续表示“当前 decision 是否收集到了期货意图”，供 Engine 在 commitDecision 前检查；不能误改成持仓、成交历史或 pending 状态，也不新增持久化的启用标志。

必须保留 null 和空集合的区别：targets=null 表示没有调仓指令；targets=new Map() 表示显式清仓，仍进入调仓／归因／日志流程。

### 4. 将复杂成交步骤整理成可读的方法

现金订单：

- 保留目标调仓和增减股数两种不同输入语义；目标份额仍以执行当日现金账户开盘权益计算。
- 用现金账户完整语义命名局部变量，避免 portfolio/stockPortfolio/futurePortfolio 多套别名混用。
- 调仓和普通订单中的重复填单元数据，可通过一个具名输入的窄私有方法组装；仅在它确实减少重复且不隐藏数量与价格决定时提取。
- 滑点价格、买入可负担数量、T+1 可卖数量、限价保护仍由调用处清楚决定。禁止在通用 helper 中一律重新定价、截断数量或重新排序。
- executionPrice 目前由 slippage.test.ts 直接使用；默认保留现有导出位置和数学公式，不为“整理文件”新增转导出层。

条件单：

- 提取候选选择、成交基准价等可独立理解的纯计算；类型放在使用处附近。
- 显式保留止损／移动止损优先于止盈、多止损选最高触发价的现有规则。
- 当日跳空与盘中触发不同；限价买入不能高于触发价，止盈价格不能被滑点降到触发价以下。
- 保持当日处理顺序：退出类 → 限价买入 → 更新剩余移动止损高水位。不能先用当天最高价更新高水位再判定当天最低价触发。
- 条件单的创建日期、重复 upsert、高水位保留、取消和清仓删除都保持原语义。

期货意图：

- 可把 delta/contracts/notional/hedge 到目标手数的转换提取为私有 resolveFutureTargetContracts；使用 switch 明确四种输入语义。
- 不移动 FuturesPortfolio 内部保证金、成交、换月与结算的记账职责。
- 对冲规模读取现金指令和条件单执行后的实际现金账户敞口。
- 保留“先平旧合约，成功后才尝试开新合约”的分支；不假定平旧和开新是原子事务。

### 5. 快照保持消费者契约

CashOrderSnapshot、ConditionalOrderKind、ConditionalOrder 被 result.ts、contract.ts、Context 和 Signals 使用。默认保持结构及导出路径，snapshot 方法可保留原名并补充“只包含现金订单”的说明，不为统一命名扩大到公开 SDK／报告协议。

snapshot 必须继续返回深拷贝，包括 Map 内的条件单对象。不能直接暴露内部 pending 或持续订单对象。新增 PendingOrders 类型不进入报告、数据库或 Worker 协议。

## 必须保持的行为清单

| 场景 | 不变量 |
| --- | --- |
| 决策与执行 | onBar 收集，随后交易日执行；不在策略下单函数内直接成交 |
| 同日多次下单 | 股票股数／手数按当前规则累计；期货 delta 只在前一个意图也为 delta 时累计，目标型意图覆盖规则保持 |
| 完整目标配置 | setHoldings 是整组目标替换；未列持仓按当前规则退出，不改为局部补丁 |
| 订单消费 | 普通订单尝试一次后消费；不能成交的普通订单不自动转成跨日挂单；条件单持续保留 |
| 现金成交 | 先卖后买，保留 Map 遍历顺序、复权／真实股数换算、整手、手续费、T+1/T+0 差异 |
| 行情与涨跌停 | 执行用精确当日行情；估值可按原规则沿用历史价；不为了成交补用旧价格 |
| 期货映射 | 用先前已知映射执行，保留到期换月与显式退出抑制自动换月的行为 |
| 数据加载 | 保留每个步骤原来的加载证券范围、先后顺序与失败边界，不把全天 loadBars 合成一批 |
| 归因 | 调仓前后权重时点与日期、targets、调用次数保持；无因子／空账户照常工作 |
| 首末交易日 | 首日没有 previousDate 时期货执行自然不发生；末日未执行现金指令仍可进入快照 |
| 错误 | 参数校验仍同步抛错，TS 沙箱 catch 行为不变；不额外引入禁止重复调用的生命周期规则 |
| 能力边界 | 不恢复启用开关，不扩展 Python／Signals 的期货能力，不静默丢弃期货状态 |

重构若发现当前规则有业务问题，记录发现和证据；不要在同一纯结构提交里顺手修正成交模型。涉及改变上述语义时先与用户讨论。

## 文件范围与交付

主要修改：

- [order-book.ts](../../apps/api/src/backtesting/order-book.ts)：依赖、状态、入口与执行步骤。
- [engine.ts](../../apps/api/src/backtesting/engine.ts)：一次注入 Tracker/通知，调整每日调用。
- [order-book.test.ts](../../apps/api/src/backtesting/order-book.test.ts)：构造与生命周期／快照／消费回归。
- [context.test.ts](../../apps/api/src/backtesting/context.test.ts)：构造参数适配。
- [README.md](../../apps/api/src/backtesting/README.md) 和本设计记录：职责与调用入口。

按实际缺口扩展 backtesting 下 conditional-orders、futures-rules、allocation-analysis、final-state、slippage 测试；必要时调整 strategy runtime 的构造测试。测试应通过成交结果、持仓、归因和快照验证行为，不靠私有方法调用次数或照抄实现。

不计划新增业务类、集中 types.ts、数据库迁移、公共 API/SDK 字段、workspace 或跨包构建依赖。实现若确需超出此范围，先说明原因。文件拆分不是本次目标，先完成职责与执行顺序的整理。

## 检查、审查与提交工作流

使用 `/Users/liucong/.codex/skills/review-gated-development/SKILL.md`，不要沿用本 session 对上一轮代码的审查批准。

1. 新 session 完整读取根 CLAUDE.md、AGENTS.md、上述 skill、本文、backtesting README 与当前代码。涉及 Web/Docs 实现再读 apps/web/CLAUDE.md。
2. 检查当前工作区；将本文建议的范围、接口、提交消息和检查计划作为 Gate 1 交给用户确认。确认只批准实现，不等于代码审查通过。
3. 一次完成完整范围与必要测试代码。审查前只运行 pnpm typecheck、受影响文件 ESLint/Prettier、git diff --check 和文档链接检查。不要运行测试、构建或启动服务。
4. Gate 2 提供关键 diff 入口、行为保留依据、静态结果和未运行的验证清单；停下等待人工代码审查。
5. 审查通过后至少运行 Backtesting 全套、Strategy runtime/SDK/execution、Signals、Worker 协议。可沿用命令：

```sh
pnpm --filter api test src/backtesting src/strategy/runtime src/strategy/sdk src/strategy/execution src/signals tests/job-worker-protocol.test.ts
pnpm build
JIXIE_PYTHON_EXECUTABLE="$PWD/.venv/research-py-v1/bin/python3" JIXIE_JOB_E2E_ONLY=strategy-orchestration,mixed-futures pnpm e2e job-system
```

这些命令只在审查后执行。根 build 包含静态检查和所有 workspace 构建；E2E 使用隔离数据库、真实 Worker 与合成行情，不调用生产数据写入。显式关闭的测试如未启用，应单独报告，不算通过。

6. 建议新增的关键回归：空目标清仓与 null 无操作；执行步骤依次消费；条件单跨空决策保留；同日止损／止盈冲突；高水位更新顺序；现金成交后对冲；显式期货退出遇到换月；归因和日志在正确步骤产生；快照深拷贝；零资金账户及末日期货意图限制。先检查现有覆盖，再补缺口。
7. 测试设施修正可在已批准范围内自主完成；若必须修改产品行为，重新提交 Gate 2，不能边修边继续运行行为验证。
8. 全部必需检查通过后更新记录，提交已确认消息，不再另设提交确认，不推送。清理临时服务，检查截图，并在最终回复中直接展示 E2E 截图。

## 新 session 可直接使用的任务说明

> 请阅读 docs/design/order-book-refactor-plan.md，基于当前代码完成 OrderBook 重构。延续 Engine 现有的统一账户、accounts 默认分配、因子描述和现金账户归因设计；不要恢复 futures 启用开关。优先整理稳定依赖注入、executeOpen 的实际语义、决策／待执行／持续条件单状态，以及当天执行步骤；保持现有交易、时点和错误语义。按 review-gated-development 工作流，先确认本文范围和提交消息，再实施；静态检查后交人工审查，批准后运行测试／构建／隔离 E2E 并提交。不要仅拆文件，也不要擅自扩展成交模型。

## 本轮实施记录（2026-09-29）

- Gate 1：用户确认完整范围和唯一提交消息 `refactor(engine): clarify order book execution ownership`。
- 基线 HEAD：`b15ee93d`；开始时只有本文未跟踪，无其他已修改文件，本文纳入本轮交付。
- 稳定依赖：Tracker 与具名调仓通知在 Engine 初始化时注入；每日入口为 `executeOrders(date, previousDate)`。
- 状态：当前决策、统一 PendingOrders、持续条件单分别持有；各步骤单独消费，现金快照保持原字段及深拷贝。
- 执行：提取调仓、普通现金订单、持续条件单和期货意图步骤；保留加载范围、异常边界、调仓归因／通知时点、换月及对冲顺序。
- 条件单：候选优先级与退出基准价为局部纯函数，高水位仍在退出与限价买入之后更新。
- 期货目标：用 switch 明确 delta/contracts/notional/hedge，保留原取整和映射时点。
- 未提取通用现金 fill 包装：四处现金填单保留显式参数，使价格、可负担数量、可卖数量及元数据求值顺序可直接审查；条件成交也不合并到通用填单流程。
- 新增 7 个回归用例：空目标与 null、后续现金行情失败、通知异常、条件行情失败后的普通订单消费、未成交普通订单消费、首日期货意图与当前决策区分、最高止损优先于同日止盈。原快照隔离、高水位、换月退出、现金成交后对冲及账户约束用例保留。
- 本次没有变更公开 SDK/API、数据库、workspace、跨包构建依赖，也没有恢复账户启用开关。
- Gate 2：用户明确批准本轮代码审查，随后执行以下验证；上一轮基线结果未替代本轮验证。
- 审查前静态检查：`pnpm typecheck` 通过（含后端边界扫描：0 violations、SDK 生成物一致性及全部 workspace 类型检查）；5 个受影响 TS 文件 ESLint / Prettier 检查通过；`git diff --check` 通过；两份文档的 28 个本地链接目标存在。

### 审查后验证

- 约定测试命令通过：46 个测试文件通过，308 项测试通过；2 个文件中 3 项默认关闭的历史性能／会计集成测试跳过，未计为通过。
- `pnpm build` 通过，全部 workspace 构建成功。Vite 报告大 chunk 与静态／动态混合导入提示，本轮未改动这些前端模块。
- 隔离 E2E：`strategy-orchestration`、`mixed-futures` 均通过。首次沙箱执行因本地监听 `EPERM` 未进入验收；获得本地服务权限后重跑原命令成功，无产品或测试代码修正。
- 使用项目 `.venv/research-py-v1/bin/python3`、隔离数据库、合成行情与真实 Worker。股票回测 3 笔成交；混合账户校验分账户净值与现金账户归因。
- 截图已人工式视觉检查：`apps/web/acceptance/job-system-backtest.png`、`apps/web/acceptance/mixed-futures-result.png`；同轮另生成现金归因中英文及混合账户英文截图。
- E2E fixture 正常退出；脚本完成浏览器／子进程回收、Prisma disconnect、临时数据库删除，并断言 API 与模型服务端口均为 ECONNREFUSED。
- 按已确认消息直接提交，不推送。后续重构另行讨论，不纳入本次提交。

## 后续封装重构（2026-09-29，独立提交）

前一轮已提交为 `d268ce8e`。本轮 Gate 1 已确认，提交消息为
`refactor(engine): encapsulate order book execution helpers`。

- 用六个明确的 private readonly 字段持有稳定依赖，替代 input 参数包。
- 将 conditionalLimitBlocked、futureContractsForNotional、mergeShareAndLotOrders、sellableFromFor、executionPrice、limitBlocked 融入 OrderBook 私有方法。
- 行情与成本直接读取实例；股数／手数合并直接读取 pending。证券、方向、执行日期、映射日期、价格和数量继续显式传参，不新增临时执行状态。
- 纯校验、空状态工厂、条件候选及基准价计算保留文件内函数。保持原计算、加载和消费顺序。
- 本轮按新批准范围取消 executionPrice 独立导出；原先“默认保留导出”的要求属于前轮范围。slippage.test.ts 改为通过 Engine / OrderBook 的实际买卖成交验证原有四类滑点场景，不绕过 private。
- 不改公共 SDK、数据库、账户交易规则或快照契约。Gate 2 尚未批准，本轮未运行测试、构建或 E2E。
- 审查前静态检查通过：全仓 `pnpm typecheck`（含边界扫描 0 violations 与生成物一致性）、两个受影响 TS 文件 ESLint / Prettier、`git diff --check`、28 个文档本地链接。当前变更未提交，等待本轮人工代码审查。
- 审查批准后运行与前轮相同的 Backtesting、Strategy runtime/SDK/execution、Signals、Worker 协议测试、全仓构建及股票／混合账户隔离 E2E；验证成功后更新本节并直接提交，不推送。
- 审查修订：将唯一调用的 assertFraction 内联到 trailingStop，保持有限值检查、开区间边界、同步抛错及原错误文案；其他多处复用且无实例依赖的校验与键生成函数继续保留为未导出的文件内函数。
- 本次审查修订后重新完成全仓 typecheck、受影响 TS 文件 ESLint / Prettier、diff 与 28 个本地文档链接检查，全部通过；行为验证仍未运行，等待修订版 Gate 2 审查。

### 封装重构最终验证

- 用户批准包含 assertFraction 内联的修订版 Gate 2，随后执行本轮行为验证。
- 约定测试：46 个文件、308 项测试通过；3 项默认关闭的历史性能／会计集成测试跳过，未计为通过。4 项实际成交滑点测试全部通过。
- `pnpm build` 成功；仅有前端 chunk 体积及混合导入提示。
- 使用项目 Python 环境运行 `JIXIE_JOB_E2E_ONLY=strategy-orchestration,mixed-futures pnpm e2e job-system`，两条隔离 E2E 均通过，无需修正产品或测试代码。
- 本轮 `job-system-backtest.png` 与 `mixed-futures-result.png` 已检查；fixture 正常退出并完成数据库 disconnect／临时库清理，两个服务端口拒绝连接，额外进程检查无遗留 E2E 服务。
- 全部约定验证通过，以已确认消息提交，不推送。本节取代上述审查中“等待批准／未运行”的阶段状态。

## 生命周期入口命名整理（2026-09-29）

本轮 Gate 1 已确认，提交消息：`refactor(engine): clarify order collection lifecycle names`。

- beginDecision → beginOrderCollection，commitDecision → commitCollectedOrders。
- hasFutureIntents → hasCollectedFuturesOrders，明确只查询本轮收集的期货指令。
- snapshot → snapshotCashOrders，明确快照只有现金订单。
- 同步 Engine、OrderBook 测试和 README；上文旧名称保留为历史记录，以本节为当前命名。
- 只改命名，不改变调用顺序、校验、状态消费或快照结构；不撤销期货快照限制，不调整 Context 交易接口。
- 新 session 的期货 Signals 研究任务见 [交接 prompt](futures-signals-research-prompt.md)，不属于本轮实现范围。
- 当前实现等待 Gate 2 人工审查；本轮行为测试、构建和隔离 E2E 尚未运行。
- 审查前静态检查全部通过：全仓 typecheck（含边界扫描和生成物一致性）、受影响 TS 文件 ESLint / Prettier、git diff --check、29 个本地文档链接；源码已无旧入口引用。未提交，等待人工审查。

### 生命周期命名整理最终验证

- 用户批准 Gate 2 后完成本轮验证：46 个文件、308 项测试通过；3 项默认关闭的历史性能／会计集成测试跳过，不计为通过。
- 全仓 `pnpm build` 成功，仅有前端产物体积及混合导入提示。
- 使用项目 Python 环境的 strategy-orchestration、mixed-futures 隔离 E2E 均通过；本轮股票回测和混合账户截图已检查。
- fixture 正常退出，数据库连接和临时库由脚本清理，服务端口关闭检查通过，额外进程检查无遗留 E2E 服务。
- 无需修正产品或测试代码；按已确认消息提交，不推送。本节替代本轮此前等待审查的阶段状态。

## Signals 直接装载执行订单（2026-09-30）

基于期货 Signals 提交 `7ef4b20f`。Gate 1 已确认完整范围，提交消息为
`refactor(engine): load execution orders without strategy collection`。

- 删除 restoreCashOrders，新增 loadExecutionOrders({ cashOrders, futuresOrders })，一次复制并替换待执行状态与持续条件单；不调用策略、不经过收集／提交，不恢复完整引擎。
- 期货输入按顺序共用 collectFutureIntent 的有限值检查、手数截断、零 delta 忽略、delta 累积及目标覆盖规则。该局部函数服务两个独立缓冲区，不将 Signals 暂存状态放到当前策略 decision。
- 装载先准备独立副本并校验期货意图，再替换执行状态；重复装载不保留上一批订单或条件单。前向现金订单不带目标调仓归因日期，沿用此前恢复现金订单的语义。
- Signals 的 account-day 直接装载，删除双重恢复和期货收集／提交。roll 不加入显式期货意图，保留自动换月及显式退出抑制换月规则。
- 测试覆盖输入隔离、批次替换、校验／累积／覆盖、现金订单一次执行、混合指令及换月／退出；已有条件单成交后对冲回归保留。
- 不修改 SDK、数据库、快照输出或成交规则。当前未提交，等待 Gate 2；审查前只运行静态检查。
- 审查通过后运行 Backtesting、Strategy runtime/SDK/execution、Signals、Worker 协议测试和全仓构建；隔离 job-system E2E 选择 strategy-orchestration、mixed-futures、daily-signals、futures-signals，覆盖本轮新消费者。
- 静态检查最终全部通过：全仓 typecheck（含后端边界 0 violations、生成物一致性）、4 个受影响 TS 文件 ESLint / Prettier、git diff --check、41 个本地文档链接。首轮类型检查发现并修正 Signals 意图收窄及 roll 测试必填字段问题；本轮未运行行为验证。

### 直接装载最终验证

- 用户批准继续完成本轮简化，Gate 2 通过后执行行为验证；Signals 的全面梳理留待后续讨论，不扩展本轮范围。
- 约定测试：51 个文件、335 项测试通过；2 个文件中 3 项默认关闭的历史性能／会计集成测试跳过，未计为通过。
- 首次测试发现新增混合指令 fixture 未预加载现金行情，导致复权因子读取报 data_not_ready；仅补齐测试行情加载，相关静态检查及完整约定测试重跑通过，未修改产品代码。
- 全仓 `pnpm build` 通过，仅有既有前端大 chunk 与静态／动态混合导入提示。
- 使用项目 Python 环境运行 strategy-orchestration、mixed-futures、daily-signals、futures-signals 四条隔离 job-system E2E，全部通过。
- 本轮 mixed-futures-result.png 与 futures-signals-mixed-zh.png 已视觉检查。fixture 正常退出并完成数据库连接／临时库清理，服务端口关闭断言通过，额外进程检查无遗留测试服务。
- 更新记录后按已确认消息直接提交，不推送。本节取代本轮此前等待审查／未运行验证的阶段状态。

## 显式获取末日状态（2026-09-30）

Gate 1 已确认完整范围和提交消息：
`refactor(engine): separate final state capture from execution`。

- 保留已存在的 recordEndOfDay / runStrategyOnBar 改名和 beginOrderCollection 方法注释。
- Engine.run 直接返回 BacktestingResult，删除 retainFinalState 和结果包装类型；公开异步 collectFinalState，仅在运行成功后允许读取。
- StrategyExecution 持有 Engine，run 直接返回带血缘的结果；提供 collectFinalState，要求调用时对象尚未关闭。Signals 在 run 成功后显式获取快照，再在 finally 关闭资源；普通回测和扫描不采集快照。
- 末日始终记录策略实际读取的计算因子值，不触发额外求值；快照仍按需补加载现金行情并复制序列化，可能失败，失败可重试。快照结构、交易规则和 Signals 投影保持不变。
- 更新相关消费者、测试和文档，清理现行 README 中旧的股票限定及结果包装描述；不改变 SDK、HTTP、数据库或账户规则。
- 必要测试覆盖运行前／中／失败后拒绝读取、独立快照、末日新订单行情延迟加载及失败重试、仅末日因子读取、Signals 运行／采集／关闭顺序和采集失败资源释放。
- 审查前仅运行静态检查。Gate 2 待人工审查；尚未运行本轮测试、构建及 E2E，尚未提交。
- 审查批准后运行 Backtesting、Strategy runtime/SDK/execution/scans、Signals 与 Worker 协议测试，全仓构建，以及 strategy-orchestration、mixed-futures、daily-signals、futures-signals 四条隔离 E2E；通过后更新记录并按已确认消息提交，不推送，清理测试服务。
- 审查前静态检查通过：全仓 typecheck（后端边界 0 violations、生成物一致性、全部 workspace）、23 个受影响 TS 文件 ESLint / Prettier、git diff --check、80 个本地文档链接。首轮检查发现测试仍使用旧返回包装及条件单联合类型字段访问，已修正并重跑通过。
- 明确时序变化：run 完成结果归集和完成日志后才允许显式快照；后续快照加载失败不撤销已完成的回测，但 Signals 仍失败并在 finally 释放资源。此为拆分操作后的预期边界，不改变成交与快照内容。

### 显式末日状态最终验证

- 用户批准 Gate 2 后执行本轮验证。54 个测试文件、434 项测试通过；2 个文件中 3 项默认关闭的历史性能／会计集成测试跳过，不计为通过。
- 首次测试发现 runtime.test-worker.mjs 仍解构旧结果包装，修正该测试 Worker，并同步修正 runtime-benchmark.test-worker.mjs 中同类调用。两者 ESLint / Prettier 与 diff 检查通过，完整约定测试重跑通过；未改动已审查产品代码，未运行默认关闭的基准测试。
- 全仓 pnpm build 通过，只有既有前端 chunk 体积和混合导入提示。
- 使用项目 Python 环境的 strategy-orchestration、mixed-futures、daily-signals、futures-signals 四条隔离 job-system E2E 全部通过。
- 本轮 mixed-futures-result.png、futures-signals-mixed-zh.png 已视觉检查。fixture 正常退出、数据库连接及临时库由脚本回收，API 与模型服务端口关闭断言通过，额外进程检查无遗留测试服务。
- 更新记录并按已确认消息直接提交，不推送。本节取代此前等待审查／未运行验证的阶段状态。

## OrderBook 文件阅读顺序（2026-09-30）

- 用户确认在同一文件内整理布局：顶部只保留 imports、OrderBookInput 和 OrderBook 主类，随后排列公开订单／快照契约、内部状态类型和状态工厂／辅助函数。
- ConditionalOrderKind 改为 ConditionalOrder['kind']，避免重复维护订单种类；不拆文件，不改类方法、交易规则或状态工厂内容。
- 提交消息：`refactor(engine): move order book supporting types below class`。
- 审查前执行全仓 typecheck、该文件 ESLint / Prettier 与 diff 检查，并静态对比确认类体和执行辅助函数未变。未运行行为验证，未提交，等待人工审查。
- 本轮仅布局和等价类型派生，不新增测试；审查通过后运行现有 OrderBook 测试与 API 构建，通过后更新记录并提交，不推送。

### 同轮追加：减少单次调用的内部层级

- 用户确认六处合并，与上述尚未提交的布局调整一起交付；提交消息更新为 `refactor(engine): simplify order book internal structure`，替代此前仅描述布局的消息。
- applyConditionalCommands 合入 commitCollectedOrders；mergeShareAndLotOrders 合入普通现金订单执行；emptyPendingOrders 改为有类型标注的字段初值；conditionalExitBasePrice 合入成交价格准备；现金订单及条件单的执行体分别与其加载包装合并。
- 保留执行主流程、调仓算法／归因边界、条件退出优先级选择、期货目标手数换算和清仓后的条件单清理。保持 await 加载位置、加载后读取待执行订单、先卖后买、状态消费、移动止损高水位与 placedDate 规则；基准价继续使用原比较表达式。
- 现有测试覆盖相关异常边界、撤单、移动止损、跳空、手数换算与一次消费，不新增重复测试。审查前仅静态检查；修订版等待人工审查，尚未运行测试或构建。
- 审查通过后运行 Backtesting、Strategy runtime/SDK/execution、Signals 及 Worker 协议测试、API 构建和 strategy-orchestration／mixed-futures 两条隔离 E2E；验证通过后更新记录、提交且不推送，并清理测试服务。该验证范围替代此前仅布局时的计划。
- 修订版静态检查通过：全仓 typecheck（含后端边界扫描与生成物一致性）、OrderBook ESLint / Prettier、git diff --check。尚未提交，等待 Gate 2。

### 审查修订：校验命名

- 用户要求先完成修改点 1，第 2 点（现金与期货指令处理方式统一）留待提交后单独讨论，本轮不实施。
- assertPositiveOrderValue / assertFiniteOrderValue 统一重命名为 validatePositiveOrderValue / validateFiniteOrderValue，定义及所有调用同步；保留校验条件、抛错文案与顺序。
- 保留工作区中用户已改的 beginDecision / commitDecision 及 Engine、测试调用，同步方法注释和当前 README。此前布局与六处合并继续纳入同一提交，消息仍为 `refactor(engine): simplify order book internal structure`。
- 修订版重新执行静态检查后等待 Gate 2；本轮仍未运行行为验证或提交。

### 内部结构简化最终验证

- 用户明确要求当前所有改动一并提交，批准继续验证；包含布局、六处内部合并、beginDecision / commitDecision 命名及修改点 1。修改点 2 未实施，留待提交后讨论。
- 修订版全仓 typecheck、相关文件 ESLint / Prettier、git diff --check 全部通过。
- 相关测试 51 个文件、340 项通过；2 个文件中 3 项默认关闭的历史性能／会计集成测试跳过，未计为通过。API 构建通过，验证无需修正代码。
- strategy-orchestration 和 mixed-futures 两条隔离 E2E 通过；本轮 job-system-backtest.png、mixed-futures-result.png 已视觉检查。
- fixture 正常退出并回收数据库连接／临时库，测试服务端口关闭断言通过，额外进程检查无遗留 E2E 服务。
- 按已确认消息提交当前全部五个文件，不推送。本节取代本轮此前等待审查／未运行验证的阶段状态。


## 账户 SDK 与决策语义（2026-09-30）

Gate 1 已确认，基线 `544eec1b`，开始时工作区干净。唯一提交消息：
`feat(strategy)!: make account scopes and order semantics explicit`。

- TS 作者接口分为 `portfolio.equity`、`stock`、`futures`；行情、因子、日期保留顶层。
  `stock` 的权益／可用现金只取现金账户；期货权益／可用资金／保证金分别读取期货账户。
  `enrich` 返回独立公开对象，不继承或扩展 EngineContext，内部 Context 同样按账户分组，桥接命令使用 stock.* / futures.*，临时 bar frame 同步账户结构。
- 股票下单显式区分后复权股数与真实整手；条件单名区分后复权价格和比例；仓位辅助归 stock，
  ATR 风险份额只用现金账户权益。期货增量／手数目标／名义金额目标／动态对冲保持各自业务含义。
- 新策略决策：增量累加、重复目标覆盖；现金完整目标表与现金增量互斥，期货按代码检查。
  零增量继续忽略。现金 `setTargetWeight` 仍更新当次完整目标表的一项，未列持仓按原规则退出，
  不偷换为单标的局部目标；`setTargetWeights` 替换整表。
- `closePosition` 覆盖同标的先前普通指令；现金在提交时转换为原股数订单或目标表中的零权重，
  期货为零手数目标。后续增量报错，后续目标可覆盖。持续条件单不自动取消，沿用执行时清理规则。
  成交顺序、复权／真实单位转换、资金、T+1、涨跌停、归因、每日结算保持原有执行逻辑。
- Signals 把真实股数转换为后复权增量列表；OrderBook 共用收集函数负责累加。
  `loadExecutionOrders` 仍直接装载历史执行批次，不施加新策略的冲突限制，不改已有信号含义。
  schemaVersion=2 快照、HTTP 与数据库结构不变，无迁移。
- Python 现有现金账户接口迁入 `ctx.stock`，使用 snake_case；可读分账户资金，仍不新增期货交易。
- 旧版扁平作者接口移除；已有源码／冻结部署不自动改写，重新执行前须迁移并重新回测部署。
  旧报告仍可查看。仓库示例、Agent 提示、SDK 参考、编辑器跳转和中英帮助一并迁移。
- reference.ts 为公开签名真相源，contract.ts 通过 setup 的静态生成函数生成。生成阶段未准备 Python
  环境、未运行应用。Python 路径与 workspace 未变化，现有 component-impact 清单已覆盖 API/sandboxd，
  现有 deployment-plan 回归将于审查后验证；不添加冗余部署条目。
- 测试代码覆盖冲突双向拒绝、分账户资金、增量累加／目标覆盖、清仓覆盖与重复清仓、条件单独立、
  原快照混合指令回放和 T+1；TS/Python／Worker／E2E fixture 同步新调用，编辑器验收增加两账户同名方法的文档定位。

当前阶段：实现与静态检查，尚未提交；本轮测试、构建、E2E 未运行，待 Gate 2 人工代码审查。
批准后运行 Backtesting、Strategy SDK/runtime/execution/scans、Signals、受影响 Factor／Research／Agent 测试及
Worker 协议、部署／setup 检查，全仓构建；隔离运行 strategy-orchestration、mixed-futures、daily-signals、
futures-signals，并验收 Python 策略与 SDK hover。全部通过后更新记录、直接提交，不推送，清理服务。

### 首版审查前静态结果

- 全仓 `pnpm typecheck` 通过：shared、API、Docs、sandboxd、Web；SDK 生成物一致性通过。
- 后端静态边界扫描：868 个文件、0 违规，未增加边界例外。
- 51 个手工维护的 TS/TSX/MJS 文件 Prettier 检查通过；全部改动脚本及生成契约 ESLint 通过。
- Python SDK 仅做 AST 语法解析，通过；改动 Markdown 的相对本地链接目标存在；`git diff --check` 通过。
- 未运行测试、构建、E2E 或数据库操作，未启动服务；工作区尚未提交，等待本轮人工代码审查。

### 内部接口同步（同一提交）

- 用户确认继续完成 SDK、Context、OrderBook 全链路后统一提交；此确认是范围批准，非修订代码审查批准。
- EngineContext / BacktestingContext 直接提供 portfolio、stock、futures；订单操作与余额不再保留扁平入口。
- OrderBook 的 SDK 入口明确账户与单位，例如 orderStockAdjustedShares、orderFuturesContracts；
  Engine 的 beginDecision / commitDecision / executeOrders 生命周期入口保留。
- runtime 命令、查询和临时账户 frame 同步分组；Python snake_case 入口映射到共享命令。
  Signals 持久化快照与数据库仍不变，不添加账户类或通用分派层。
- 增补账户桥接命令顺序、Context 到 OrderBook 的累加和账户区分，以及 SDK 实时权益读取测试。
- 修订版全仓 typecheck、SDK 生成物一致性通过；后端边界静态扫描 868 文件、0 违规。
- 66 个手工维护脚本 Prettier 检查通过，改动脚本及生成契约 ESLint 通过，Python AST 解析通过。
- git diff --check 通过。当前未提交、未启动服务、未运行测试／构建／E2E，修订代码等待 Gate 2 人工审查。

### 审查后验证与提交（2026-10-08）

- 用户批准本轮代码审查；产品实现未再改动。
- Backtesting、Strategy、Signals、受影响 Agent/Research 与 Factor Worker 测试：68 文件、
  604 项通过；2 文件中 3 项默认关闭的性能／历史会计测试跳过，不计为通过。
- sandboxd 生命周期 8 项通过；首次受沙箱临时 socket 权限阻止，放开执行权限后通过。
- SDK setup、部署计划、后端边界检查器测试共 55 项通过；全仓 build 通过，仅有前端大 chunk 提示。
- 编译产物模式的隔离 job-system E2E：strategy-orchestration、mixed-futures、
  python-strategy、daily-signals、futures-signals 全部通过。临时数据库使用合成行情，
  不涉及开发库、真实供应商或券商。Python 用例加入显式选择列表，默认套件范围不变。
- SDK hover 使用隔离 API 与临时开发 Vite 验收通过，检查两账户 closePosition 的类型签名和文档链接。
  临时入口 URL 的重复斜杠已修正；脚本固定等待造成的 Monaco 就绪竞态改为条件等待，
  修订后重跑通过。仅修改测试脚本及验收记录，无产品修复。
- 混合账户回测、Python 结果、Signals 英文桌面／窄屏及 SDK hover 截图已视觉检查。
- 两套夹具正常退出，临时数据库连接关闭并清理，API／模型／Vite 端口关闭断言通过。
- 验证后的测试修改 ESLint / Prettier、git diff --check 通过。
  按已确认消息统一提交，不推送。本节取代上文等待审查／未验证的阶段状态。
