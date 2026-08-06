# 规划：Factor V2（统一因子研究与信号闭环）

> 2026-08-06 制定。目标是把现有“股票横截面 FactorReport”升级为资产无关的因子研究基础设施，
> 打通“数据与特征 → 因子发现与验证 → 不可变发布 → 策略引用 → 组合与交易”的完整闭环。
> 本文是落地计划，不代表一次性重写。现有研究纪律以
> [`factor-research-discipline.md`](./factor-research-discipline.md) 为准，现有因子到策略能力以
> [`factor-to-strategy.md`](./factor-to-strategy.md) 为准，大类资产数据依赖以
> [`asset-allocation-data.md`](./asset-allocation-data.md) 为准。

## 1. 结论与产品决策

Factor V2 是 jixie 从“股票因子研究 + 策略回测”走向“多资产专业投研平台”的核心工程。

本次升级确认以下决策：

1. **Factor 不按资产类别划分。**股票、债券、商品和宏观都可以形成预测因子；区别在于数据、
   样本结构和评估协议，不在于一个叫 Factor、另一个叫 Signal。
2. **Factor 是可复现的研究定义，Signal 是 Factor 在某个时点对某个资产产生的预测输出。**
   策略消费 Signal，再将其转为目标权重和订单。
3. **现有 `/factors` 继续作为“因子研究”一级产品。**债券和商品提供领域数据、特征模板和报告模板，
   不各自复制一套孤立的因子系统。
4. **现有 `FactorReport` 不废弃。**它继续代表一次不可变研究运行；当前股票报告成为
   `cross_sectional` 评估协议的第一个实现。
5. **不新增因子值大表。**沿用“存定义、快照和报告，不存全市场逐日因子值”的原则；历史研究在
   worker 中现场计算，只有发布版本的当期预测和策略决策快照按审计需要保存。
6. **不新增债券或商品专用回测引擎。**统一策略 Lab 继续负责目标权重、`period` 调仓、成本、成交约束
   和每日交易信号。
7. **预测因子与风险因子明确分开。**Factor V2 近期先完成收益预测因子；久期、信用、通胀等风险暴露
   和归因进入后续组合分析阶段，不与 Alpha 检验混在同一报告里。

## 2. 统一术语

产品、共享类型和文档统一使用以下概念：

| 概念 | 产品含义 | 是否持久化 |
|---|---|---|
| Data Field 数据字段 | 原始价格、财务、曲线、库存、宏观观测值 | 源数据表持久化 |
| Feature 特征 | 对原始字段做的可重复变换，如曲线斜率、Carry、20 日动量 | 默认现场计算 |
| Alpha Factor 预测因子 | 有明确假设、方向、适用范围和计算定义的收益预测规律 | `Factor` 保存可编辑定义 |
| Factor Release 因子发布版 | 通过研究流程后发布的不可变因子版本 | 新增不可变发布记录 |
| Factor Signal 预测信号 | 发布因子在 `asOfDate × asset` 上的标准化分数、期限及可选校准预测 | 历史默认现场算；生产决策留快照 |
| Risk Factor 风险因子 | 用于解释收益、风险和相关性的系统驱动，如久期、信用、通胀 | 后续风险模型维护 |
| Target Weight 目标权重 | 策略根据一个或多个预测信号形成的组合决策 | 回测/部署快照保存 |
| Trade Signal 交易信号 | 下一执行日的买卖数量和订单意图 | 现有 `SignalRun` / `SignalExecution` |

为避免与现有“今日信号”混淆，代码和数据模型中使用 `FactorSignal` 表示预测输出；现有
`SignalRun` 继续只表示策略生成的交易指令。

完整链路固定为：

```text
Data Field → Feature → Alpha Factor → Factor Release
                                      ↓
                                Factor Signal
                                      ↓
                      Signal Combination / Portfolio Construction
                                      ↓
                              Target Weight → Trade Signal
```

## 3. 当前基线与主要缺口

### 3.1 可以直接复用的能力

jixie 已具备下列高价值基础，Factor V2 必须复用并保持行为兼容：

- `Factor`：预置和自定义因子统一为 code-first 定义，预置因子可读、可复制；
- `compileFactor`：隔离沙箱、窗口声明、PIT 财务字段和批量计算；
- `FactorReport`：不可变报告、代码快照、spec、数据截止日和 durable Job；
- 研究纪律：研究卡、explore、一次性 holdout、不可逆 reveal、多重检验计数；
- 横截面报告：Rank IC、分层收益、中性化、衰减、换手、费后和相关性；
- `FactorComposite`：方向、截面标准化、等权合成和共同股票池；
- `ctx.factor()`：策略运行时引用预置或用户因子；
- ETF 日频交易、`period` 调仓、策略回测、部署和每日交易信号。

### 3.2 当前模型的限制

1. `FactorBar` 和 `FactorCtx` 以单只 A 股为中心，字段和 Universe 语义不能自然表达债券曲线、商品
   期限结构或全局宏观状态。
2. `FactorAnalysisSpecV1–V4` 默认“月/周调仓日 × 股票截面 × 未来收益”，缺少评估协议和预测目标
   的显式区分。
3. `FactorReport` 的 payload 是单一横截面结构，时间序列、跨资产面板和宏观状态只能硬塞字段，
   无法形成稳定契约。
4. `Factor` 是可编辑工作区；`key` 定稿后仍缺少独立的不可变发布版本，策略难以明确声明自己依赖
   哪一个已验证版本。
5. `ctx.factor()` 返回当前股票上下文中的标量，不能表达“因子对某个 ETF 的方向、强度、期限和
   来源版本”。
6. 现有 `SignalRun` 是交易结果，不是研究信号；若直接复用名称会混淆预测与执行。
7. `FactorComposite` 目前只在股票横截面研究中使用，尚不能发布为策略可消费的多因子信号。

## 4. 目标产品信息架构

### 4.1 因子研究

现有 `/factors` 从“选择因子并看股票报告”升级为统一研究工作台：

```text
因子研究
├─ 因子库
│  ├─ 预置因子
│  ├─ 自定义因子
│  ├─ 组合因子
│  └─ 已发布版本
├─ 定义工作台
│  ├─ 数据字段与特征目录
│  ├─ 代码 / 表达式编辑
│  ├─ 资产范围与预测目标
│  └─ 因子值预览
├─ 研究运行
│  ├─ 横截面
│  ├─ 时间序列
│  ├─ 跨资产面板
│  └─ 宏观状态
├─ 报告与对比
│  ├─ 单因子报告
│  ├─ 稳健性与样本外
│  ├─ 因子相关与冗余
│  └─ 历史实验台账
└─ 发布
   ├─ 冻结版本
   ├─ 发布预测信号
   └─ 查看策略引用
```

债券、商品和宏观不做独立的 Factor 产品，只提供领域入口和模板：

- 债券：利率趋势、曲线水平/斜率/曲率、Carry/Roll-down、信用和流动性；
- 商品：时间序列动量、横截面动量、Carry、基差、库存、仓单和持仓；
- 宏观：增长、通胀、信用、流动性和外部环境的状态或变化率；
- 跨资产：动量、估值、Carry、波动和宏观敏感度。

### 4.2 策略 Lab

策略 Lab 不复制研究报告，只增加三类能力：

1. 浏览并引用已经发布的因子版本；
2. 查看某次回测实际消费的预测信号快照；
3. 增加多资产收益贡献、风险贡献和宏观阶段表现。

`period` 继续承担定时调仓，不新增另一套“资产配置调度器”。

## 5. 目标领域模型

### 5.1 保留现有实体

- `Factor`：用户的可编辑研究工作区；内置因子仍以稳定 slug seed；
- `FactorReport`：一次不可变研究运行，继续同时承担 experiment 语义；
- `FactorComposite`：可编辑的多因子研究定义；
- `Job`：后台计算尝试；
- `Strategy` / `StrategyDeployment` / `SignalRun`：策略、部署和交易信号。

当前没有“一项命名研究包含多组报告并独立协作/分享”的真实操作，因此暂不新增
`FactorExperiment`。以后满足现有研究纪律文档列出的触发条件时再提炼。

### 5.2 新增 `FactorRelease`

`FactorRelease` 不是每次编辑都创建的 revision，而是用户明确点击“发布”后产生的不可变版本。
建议字段：

```text
id                 ULID
userId
factorId            单因子来源时指向 Factor，可空
compositeId         组合来源时指向 FactorComposite，可空
releaseKey          用户可读稳定键
version             同 releaseKey 单调递增
sourceKind          single | composite
inputDomains        price/fundamental/flow/rates/commodity/macro 等输入域数组
targetAssetClasses  equity/fixed_income/commodity/cash/fx 等目标资产数组
outputScope         asset | global
codeSnapshot        单因子代码或组合完整定义
codeHash
approvedReportId    发布依据报告
methodologySnapshot 研究协议、目标、方向和期限
maturity            experimental | validated | production
lifecycle           active | retired
createdAt
```

约束：

- `[userId, releaseKey, version]` 唯一；
- `factorId` 与 `compositeId` 必须且只能存在一个，并与 `sourceKind` 一致；
- 单因子 `releaseKey` 复用已定稿的 `Factor.key`，内置因子继续使用稳定 slug；组合因子首次发布时分配
  稳定 key，后续版本复用，不再形成另一套身份命名空间；
- 发布后禁止修改；修正定义必须发布新版本；
- `approvedReportId` 必须属于相同代码 hash；不同 maturity 按第 10 节验证对应的研究和运行门槛；
- `inputDomains`、`targetAssetClasses`、`outputScope` 由批准报告的冻结定义和研究协议推导，客户端传值
  只作一致性断言，不能改写发布契约；旧 equity SDK 暂按冻结代码的字段访问保守推导，无法识别时拒绝
  发布，Definition V2 上线后改由其声明式字段目录提供；
- `experimental` 只供研究引用，`validated` 表示已通过正式 holdout，只有 `production + active` 可以
  进入每日部署；
- retire 只阻止新策略引用，不影响历史回测、部署或报告；
- 策略和部署冻结 release ID，不只冻结一个可变化的别名。

`FactorWeatherPin` 与发布版本收口为一套身份：Factor V2 上线后的新 pin 必须引用 `FactorRelease`；现有
pin 继续保留自己的冻结代码快照并按 legacy 读取，不批量伪造 release。迁移时给 pin 增加可空
`releaseId`，旧行保持为空，新行必须非空。这样 FactorWeather、策略和报告不会各自维护一套“当前版本”。

### 5.3 不新增 `FactorValue`

`FactorSignal` 第一阶段是共享 wire/runtime 类型，不建全历史明细表：

```ts
interface FactorSignal {
  asOfDate: string;
  assetId: string | null;
  score: number;
  horizon: number;
  horizonUnit: 'trade_day' | 'calendar_day' | 'month';
  expectedReturn?: number;
  upProbability?: number;
  calibrationReportId?: string;
  releaseId: string;
  dataCutoff: string;
}
```

- `assetId = null` 表示全局宏观状态输出；它必须经过显式资产映射才能形成目标仓位；
- `score` 是统一方向后的无量纲预测分数，正值表示相对更高的预期收益，但策略仍负责阈值和仓位；
- `expectedReturn` 只有模型给出明确收益单位时才填写；`upProbability` 只有经过样本外概率校准时才填写，
  且必须同时给出 `calibrationReportId`，普通 IC、t 值或历史命中率不得包装成“置信度”；
- 历史研究在 worker 内生成并直接交给评估器；
- 策略回测在 run 内缓存，不跨报告复用未经版本校验的值；
- 每日部署只在策略决策快照中保存实际使用的少量信号和 release ID，用于解释订单；
- 只有实测重复计算成本无法接受时，才讨论按 release/date 物化缓存，不能提前建设大宽表。

## 6. 统一因子定义与数据访问

### 6.1 不建设万能 `FactorBar`

股票、收益率曲线、商品合约和宏观序列字段差异巨大。把所有字段塞入一个不断膨胀的
`UniversalFactorBar` 会破坏类型、PIT 语义和加载性能。

采用两层兼容设计：

1. 现有 `defineFactor({ compute(bar, ctx) })` 继续作为 equity v1 adapter；
2. 新增 Factor Definition V2，通过受控数据字段目录和 `ctx` 读取所声明的输入。

概念接口：

```ts
export default defineFactorV2({
  name: '商品期限结构 Carry',
  inputDomains: ['commodity'],
  targetAssetClasses: ['commodity'],
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['future.near.settle', 'future.next.settle', 'future.next.expiry'],
  compute(ctx) {
    const near = ctx.value('future.near.settle');
    const next = ctx.value('future.next.settle');
    return near && next ? near / next - 1 : null;
  },
});
```

这段代码只表达目标接口，不在本文锁定最终命名。正式实施前需要用股票、债券、商品、宏观各一个
例子验证类型和批量加载能力。

### 6.2 数据字段目录

数据字段目录以代码注册表为真相源，像现有 SDK 注册表一样生成：

- Monaco 类型和 hover 文档；
- Agent prompt 的可用字段；
- 分析器的批量预载计划；
- 字段单位、频率、资产适用范围；
- `flow | level | event` 时间语义；
- PIT 规则、`availableDate` 和最大 as-of 回看范围。

`inputDomains` 说明因子读取什么数据，`targetAssetClasses` 说明它预测什么资产，`outputScope` 说明输出
粒度，`analysisKind` 则属于研究报告。四者不能合并成一个模糊的 `domain`：例如“美国实际利率预测
黄金 ETF”应表达为 `inputDomains = [rates, macro]`、`targetAssetClasses = [commodity]`、
`outputScope = asset`、`analysisKind = time_series`。

用户创建的派生特征仍保存在 Factor 代码中，第一阶段不新增独立 `Feature` 表。只有出现跨多个因子复用、
独立权限、血缘和物化需求时再把 Feature 提炼成实体。

## 7. 统一研究协议

### 7.1 新 spec 使用可辨识联合

保留 `FactorAnalysisSpecV1–V4` 原样读取。Factor V2 新增带 `analysisKind` 的统一研究 spec：

```text
FactorResearchSpecV1
├─ CrossSectionalSpec
├─ TimeSeriesSpec
├─ PanelSpec
└─ MacroRegimeSpec
```

共同字段至少包括：

- factor/release 快照；
- `analysisKind`；
- 数据范围和调仓/观察频率；
- 预测目标、收益口径和 horizon；
- Universe 或资产列表；
- 缺失、异常值、成本和可投资性口径；
- explore/holdout 规则；
- 数据 revision/cutoff。

旧报告在读取时适配为 `analysisKind = cross_sectional`，不批量重算、不修改历史 payload。
`FactorReport` 增加可索引的 `analysisKind` 冗余列，详情仍以冻结 `specJson` 为真相源。

### 7.2 四类评估器

#### Cross-sectional

复用当前 `analyzeFactor`，输出 Rank IC、分层、多空、换手、中性化和费后。第一阶段只做适配和拆分，
迁移前后固定 fixture 与真库金标准必须逐位一致。

#### Time-series

研究某个资产在不同历史状态下的预测能力，首版输出：

- 因子值与未来收益的相关/回归斜率；
- 正负或分位状态下的条件收益；
- 方向命中率；
- 多 horizon 衰减；
- 单资产结果与跨资产汇总；
- 滚动窗口、explore/holdout；
- 对重叠持有期使用 Newey-West 或等价稳健标准误。

#### Panel / cross-asset

研究 `date × asset` 面板，首版输出：

- 每期跨资产 Rank IC 及稳定性；
- 各资产自身的时间序列有效性；
- Top/Bottom 或多空诊断组合；
- 波动率缩放前后结果；
- 换手、成本和资产类别贡献；
- 因子相关性和增量信息。

#### Macro regime

研究全局状态如何映射到资产收益，首版输出：

- 状态定义、概率或分数历史；
- 不同状态下各资产未来收益和风险；
- 状态持续时间、切换频率和滞后敏感性；
- 不同 vintage / availableDate 下的结果差异；
- 样本外稳定性。

宏观状态不能直接伪装成某个 ETF 的买卖信号；从状态到资产预期收益的映射必须单独冻结和验证。

### 7.3 报告结构

`FactorReport` 的 envelope 继续统一，payload 改为按 `analysisKind` 分型：

```text
FactorReportDetail
├─ common: identity / snapshot / methodology / lineage / discipline
└─ payload
   ├─ CrossSectionalReport
   ├─ TimeSeriesReport
   ├─ PanelReport
   └─ MacroRegimeReport
```

所有报告共享：数据覆盖、PIT 声明、代码 hash、研究卡、样本内外、尝试次数、成本口径和发布资格；
IC、命中率、状态收益等方法专属指标只出现在对应 payload 中。

### 7.4 研究范围、排序范围与诊断切片

因子在不同股票范围、行业和市场状态下的表现是专业研究的必要部分，但产品必须避免把任意切片变成
挑选最好结果的工具。统一研究协议将三个概念分开：

1. **Universe：正式样本范围。**第一批支持全 A、沪深 300、中证 500、中证 1000；指数成分必须按
   历史时点读取。改变 Universe 会改变研究假设和样本，必须生成新的 report variant、计入尝试次数，
   并独立满足 holdout 纪律。
2. **Ranking scope：预测值的比较范围。**`global` 表示全 Universe 排序；`within_industry` 表示在
   每个历史行业截面内标准化 / 排序后再组合。它与“回归消除行业暴露后全市场排序”不是同一方法，
   必须作为冻结 spec 的正式字段。
3. **Diagnostic slices：同一正式报告的稳健性分解。**第一批支持行业、市值、流动性；以后可增加年份、
   市场状态和宏观阶段。诊断切片展示 Rank IC、分层收益、覆盖率、样本数和不确定性，不自动产生新的
   发布资格；用户将某个切片提升为正式适用范围时，必须重新运行对应 Universe 的研究。

建议共享契约：

```ts
interface FactorEvaluationScopeV1 {
  version: 1;
  universe:
    | { kind: 'market'; market: 'cn_a' }
    | { kind: 'index'; indexCode: '000300.SH' | '000905.SH' | '000852.SH' };
  membership: 'point_in_time';
  rankingScope: 'global' | 'within_industry';
  diagnostics: Array<'industry' | 'size_bucket' | 'liquidity_bucket'>;
}
```

债券和商品复用相同分层思想，但使用各自的领域维度：债券按久期、发行人类型和信用等级，商品按能源、
金属、农产品及品种分组。它们不能借用股票行业字段形成一套表面统一、实际含义错误的分类。

## 8. 从因子发布到策略

### 8.1 策略只引用不可变发布版

新增概念 API：

```ts
const bondSignal = ctx.signal('bond-trend@1', '511260.SH');
```

最终命名在 SDK 设计阶段确定，但必须满足：

- 策略声明具体 release，不默认漂移到最新版；
- 返回 `FactorSignal | null`，而不是直接返回目标权重；
- 时间只能是当前决策日，不能从策略代码传任意未来日期；
- 运行时按 release 的字段依赖和 PIT 规则取数；
- 回测、参数扫描、部署和每日信号使用同一计算实现；
- `StrategyDeployment` 冻结 release ID、代码 hash 和数据契约版本。

现有 `ctx.factor()` 在迁移期保持兼容，用于当前股票截面策略；新功能稳定后再决定是否将其定义为
`ctx.signal()` 的标量快捷方式，不提前废弃。

### 8.2 Signal 不直接决定仓位

策略或组合构建层负责：

- 多信号合成；
- 置信度、风险预算和仓位上下限；
- ETF 可交易代理映射；
- `period` 调仓；
- 交易成本和成交约束。

同一个已发布因子可以被等权、阈值、风险平价等不同策略使用，FactorReport 不替策略决定最终仓位。

## 9. 分阶段落地计划

每个阶段都必须形成可独立验收的纵向切片；上一阶段未过验收门，不并行扩大量资产和指标。

### Phase 0：架构冻结与术语迁移

**交付：**

- 冻结本文的领域术语和实体关系；
- 用股票动量、国债曲线、商品 Carry、宏观通胀状态四个样例验证 Definition V2 与 ResearchSpec；
- 明确 `FactorSignal` 与现有 `SignalRun` 的命名边界；
- 画出旧 `FactorAnalysisSpecV1–V4` 到新 cross-sectional spec 的兼容映射；
- 确定发布门槛的第一版规则，不把“报告跑完”自动视为“可发布”。

**验收门：**四个样例能用同一输出契约表达，旧报告无需迁移或重算。

### Phase 1：通用报告骨架与发布版本

**2026-08-06 第一批实施状态：**已完成后端地基，但尚未完成 Phase 1 验收：

- `FactorReport` 增加 `analysisKind`，历史和现有运行默认按 `cross_sectional` 读取；
- 新增共享 `FactorSignal`、`FactorRelease` 及发布请求类型；
- 新增不可变 `FactorRelease` schema、Prisma migration，以及列表、详情、发布、retire API；
- `experimental` 只接受已完成报告，`validated` 必须通过已揭示 holdout 的主判据；
- `production` 在运行一致性、数据新鲜度和可交易性门槛实现前明确拒绝；
- 新发布身份与 `FactorWeatherPin.releaseId` 已预留关联，旧 pin 保持 `null` 和既有冻结快照；
- migration 已在空白临时数据库从首个版本完整执行通过，并在因子范围 E2E 前应用到开发数据库；
- 研究范围首批实现新增 `FactorAnalysisSpecV5`：全 A、沪深 300、中证 500、中证 1000 可形成独立
  report variant；指数范围按研究日读取不晚于当日的历史成分快照，缺少快照或快照过期时明确失败；
  前端和 Factor Agent 均可选择范围，报告审计展示 PIT Universe 过滤前后样本数。
- `EvaluationScope V1` 支持全局排序和申万一级行业内排序：后者按研究日历史行业归属计算组内
  percentile rank，缺失行业或少于 5 只股票的行业不并入其他行业，而是剔除并计入样本审计；V5
  的方法论审计另存缺失分类数、小行业剔除数和参与行业数；V5 的中性化也在正式研究范围和可交易性
  过滤后估计，避免指数研究借用范围外股票的信息。
- 行业、市值三分位和流动性三分位诊断切片已进入 V5：逐期计算切片 Rank IC、年化 ICIR 和 IC
  正率，仅作为稳健性诊断展示，不改变主报告指标、研究假设判据或发布门禁。
- 新增分型 `FactorResearchSpecV1` 与 `FactorResearchReportPayloadV1`：股票横截面、债券 ETF 时间序列、
  商品跨资产面板、宏观状态四个样例均可由可辨识联合表达；旧 V1–V5 spec 和 payload 在读取时自动
  包装为 `cross_sectional`，新报告将统一 envelope 写入 `specJson`，兼容字段继续供当前 UI 使用；
  时间序列明确冻结 Newey-West 推断和 PIT revision policy，未实现的 evaluator 会被 API 明确拒绝。
- worker 已改由 evaluator registry 调度，现有 `analyzeFactor` 包装为 `CrossSectionalEvaluator`；adapter
  只透传冻结 protocol、source、日志和 locale，不进行数值变换，其他 analysis kind 在注册实现前
  fail-closed。
- 发布元数据不再信任前端填写：当前 equity adapter 从批准报告冻结代码推导 price、fundamental、flow
  输入域，并从 cross-sectional 研究协议推导 equity 目标和 asset 输出；旧客户端可继续提交这些字段，
  但仅作为一致性断言，未知依赖或不一致声明都会 fail-closed。
- 报告结果页已增加发布区：直接展示“发布版 ← 批准报告 ← 代码 hash”血缘、后端推导的数据契约、
  maturity 和 lifecycle；experimental 与符合条件的 validated 可选，production 在运行门槛完成前禁用，
  自定义因子未锁定策略标识时不能发布，组合因子首次发布要求稳定 key。
- 真实浏览器 E2E 已覆盖完成报告发布、price + fundamental → equity → asset 契约核对、版本展示和
  retire，验收截图保存在 `apps/web/acceptance/7r-factor-release-approval.png` 与
  `7s-factor-release-lineage.png`。

尚未完成：策略消费 release。
因此这一批只建立不可变身份与契约，不改变既有因子计算结果，也不能对外宣称 Factor V2 已可用。

**后端：**

- 新增 `FactorResearchSpecV1` 和分型 report payload；
- 新增 `FactorEvaluationScopeV1`，冻结 PIT Universe、排序范围和诊断切片；
- 将现有横截面分析包装为 `CrossSectionalEvaluator`；
- `FactorReport` 增加 `analysisKind`，历史行按 `cross_sectional` 解释；
- 新增 `FactorRelease` 及发布、列表、retire API；
- 发布时校验 factor hash、报告归属、研究阶段和揭示状态。

**前端：**

- 因子库增加“草稿 / 已验证 / 已发布”状态；
- 报告页增加统一的定义、数据、方法、证据和发布区；
- 老报告 URL、历史恢复、运行续接保持不变。

**验收门：**

- 当前全部股票因子报告金标准零漂移；
- 全 A / 沪深 300 / 中证 500 / 中证 1000 使用历史成分且形成独立 report variant；
- 行业内排序和行业中性化具有不同 spec 身份，行业 / 市值 / 流动性诊断不改变主报告发布判据；
- 同一 Factor 可发布 v1/v2，两版不可修改；
- 策略尚未消费 release，但 UI 能追溯“发布版 ← 批准报告 ← 代码快照”。

### Phase 2：时间序列因子纵向切片

选择“已有 ETF 价格即可完成”的时间序列动量作为基础设施验收，再接一条真实债券驱动：

1. ETF 20/60/120 日趋势；
2. 国债收益率趋势或曲线斜率 → 债券 ETF 未来收益。

**交付：**

- `FactorDefinitionV2` 最小运行时和数据字段注册表；
- `TimeSeriesEvaluator`；
- 时间序列报告 UI；
- 研究卡、holdout、揭示、报告历史和尝试计数复用；
- 至少一个内置 ETF 时间序列因子和一个债券因子模板。

**数据依赖：**ETF 日线已具备；债券模板依赖收益率曲线权限与同步，未满足时不得用 ETF 价格反推并
冒充曲线数据。

**验收门：**同一因子在 fixture、worker、报告重跑中可复现；人为构造未来泄漏会被测试拦截；重叠
horizon 的显著性不使用朴素独立样本 t 值。

### Phase 3：发布信号进入策略 Lab

**2026-08-06 首个纵向切片：**已开始，当前仅支持现有 equity Factor SDK 的单因子 release：

- TypeScript 策略使用 `release:<ULID>` 在 `factors` 与 `ctx.factor` 中引用不可变版本；运行时按用户权限
  读取 `FactorRelease.codeSnapshot`，不再回查可编辑 Factor 行；旧 `custom:<key>` 仅作兼容，不再由 Agent
  为新策略生成；
- 回测与参数扫描可使用 experimental / validated release，回测结果保存 release ID、稳定 key、版本、
  code hash 与批准报告，可从结果页回到因子报告；
- Agent prompt 与 Monaco 自动完成只把 active single release 作为新入口，并保留 legacy key 的类型兼容；
- 每日信号 worker 与部署 API 双重要求 `production + active`；当前 production 发布门槛尚未开放，因此使用
  因子 release 的策略只能研究回测，界面会禁用上线动作；
- 组合 release、时间序列/面板/宏观 evaluator 尚未进入策略 runtime，引用时明确失败，不做静默降级。
- 真实浏览器纵向 E2E 已完成 `FactorReport → ep@v1 → release:<ULID> 策略 → 30 笔真实成交 → 结果血缘`
  闭环，并验证非 production 版本的 UI/API 双重部署门禁；截图为
  `apps/web/acceptance/8a-strategy-factor-release.png`。

尚未完成：在部署与每日 `SignalRun` 输出中单独结构化保存 release 依赖和实际预测信号摘要，以及“从因子
报告一键带入 Strategy Lab”的生成动作。

**交付：**

- 新增策略 SDK 的版本化 release 引用；
- release 在回测 worker 和每日信号 worker 中使用同一求值器；
- 策略配置与部署冻结 release 依赖；
- 回测结果展示“使用了哪些因子版本”及关键预测信号；
- `SignalRun` 保存产生交易决策时实际使用的因子信号摘要，不改变其交易信号语义；
- 从因子报告提供“在策略 Lab 中使用”的显式动作。

**首个闭环验收：**

```text
创建 ETF 时间序列因子
→ explore
→ holdout/reveal
→ 发布 v1
→ 策略引用 v1
→ period 调仓回测
→ 部署
→ 今日信号可追溯到 v1
```

编辑原 Factor 或发布 v2 后，历史回测、已有部署和交易信号仍必须绑定 v1，结果不得漂移。

### Phase 4：跨资产面板与配置报告

**首批 Universe：**境内股票 ETF、海外股票 ETF、短债/中长债 ETF、黄金 ETF和少量商品 ETF。

**交付：**

- `PanelEvaluator`；
- 跨资产动量基线；
- 数据到齐后增加 Carry、曲线和宏观特征；
- 资产类别内和类别间标准化规则；
- 组合因子扩展到 panel，并可发布为信号；
- Lab 增加资产收益贡献、风险贡献、滚动相关和宏观阶段表现。

**验收门：**

- 不同上市日期和缺失历史不会造成幸存者偏差或静默缩小 Universe；
- Top/Bottom 研究组合和实际 ETF 多头策略明确区分；
- 研究费后诊断与策略真实成交回测能解释差异；
- 等权和简单规则是强制基线，优化器不提前进入。

### Phase 5：商品专业特征、宏观状态与风险因子

按数据成熟度分两条线推进：

1. **商品因子：**实际月合约期限结构、换月、Carry、仓单和持仓；
2. **宏观状态：**增长、通胀、信用、流动性和外部环境，严格按 release/available/vintage 时间使用。

随后单独建设风险因子与组合归因：

- 久期、曲线、信用、权益 beta、通胀、美元和商品风险暴露；
- 因子收益归因、风险贡献和情景冲击；
- Alpha Factor 与 Risk Factor 的重合检查。

**验收门：**商品连续收益能解释换月规则；宏观研究能够证明每个观察值在决策日真实可得；风险归因
不被包装成收益预测结论。

### 建议项目拆分

| 里程碑 | 包含阶段 | 用户可见结果 | 相对工作量 | 关键依赖 |
|---|---|---|---|---|
| A：Factor V2 骨架 | Phase 0–1 | 统一报告骨架、已发布版本、老股票因子零回归 | L | 现有 Factor/Report |
| B：首个端到端闭环 | Phase 2–3 | 时间序列因子可研究、发布并进入策略和今日信号 | XL | ETF 日线；债券曲线用于第二个样例 |
| C：多资产配置 | Phase 4 | 股票/债券/黄金/商品 ETF 的 panel 因子和配置报告 | XL | 代理池、统一资产分类、数据覆盖 |
| D：专业固收商品与宏观 | Phase 5 | Carry、库存、宏观状态、风险暴露和归因 | 持续演进 | 曲线、实际合约、仓单、PIT 宏观 |

Factor V2 MVP 建议以里程碑 B 为交付边界。只完成 A 会得到漂亮的新架构但没有新增研究能力；完成 B 后，
用户已经能走通“发现时间序列因子 → 样本外验证 → 发布 → ETF 策略 → 每日交易信号”，可以独立产生
产品价值，再决定是否投入 C 和 D。

## 10. 发布门槛

所有 Factor Release 至少满足：

1. 有冻结的因子定义、数据字段和 PIT 规则；
2. 有预先填写的假设、经济逻辑、预期方向和主要判据；
3. explore 报告完成且样本数量达到协议最低要求；
4. `experimental` 可以只有 explore 证据；升级为 `validated` 必须完成并通过正式 holdout；
5. `production` 还必须通过回测/每日信号求值一致性、数据日常维护和成本可交易性验收；
6. 报告包含成本或明确说明该协议为什么不适用成本；
7. 无已知未来泄漏、幸存者偏差或不可解释的数据修订；
8. 发布版本冻结代码、组合定义、方法、horizon、数据依赖和批准报告。

预置因子进入正式菜单仍继续执行“数据可得、市场逻辑、样本外与费后”三道门，不因 Factor V2 扩大
资产范围而降低标准。

## 11. 测试与验收体系

### 11.1 金标准与兼容

- 当前代表性股票因子的 IC、分层、净值和费后结果逐位对比；
- 历史 `FactorReport`、URL、holdout/reveal、FactorWeather 不重算不失联；
- `ctx.factor()` 既有策略回测结果保持一致；
- V1–V4 spec 的 normalize 和 wire 兼容常驻测试。

### 11.2 时间语义

- 每类字段分别测试 `flow | level | event`；
- 宏观使用 `availableDate`，不能按 `period` 对齐；
- 财务、曲线、期货合约和 ETF 上市日期均使用 PIT fixture；
- 故意注入未来值时报告必须失败，而不是静默忽略。

### 11.3 统计协议

- 横截面已知排序 fixture；
- 时间序列已知领先/无领先 fixture；
- panel 中一部分资产有效、一部分无效的汇总 fixture；
- 重叠 horizon 的稳健标准误；
- explore/holdout 隔离、多重检验计数和失败留痕。

### 11.4 研究到交易

- release 不可变、版本递增和 retire；
- 因子编辑不污染 release；
- 回测与隔离 worker 的信号逐位一致；
- 回测与每日信号在相同数据截止日产生相同预测；
- E2E 覆盖“研究 → 发布 → 策略引用 → 回测 → 部署 → 今日信号”全链路。

## 12. 迁移策略

1. `/factors`、factor key、老 report ID 和分享 URL 保持稳定；
2. 历史报告只在读取层适配为 cross-sectional，不批量改 payload；
3. 现有内置和用户因子默认 `domain = equity`、`outputScope = asset`；
4. `FactorComposite` V1 保持股票横截面语义，新 panel 组合使用新 definition version；
5. `ctx.factor()` 至少跨越 Phase 3 保持兼容；
6. 新策略优先引用 `FactorRelease`，旧策略继续按当前逻辑运行；
7. 只有真实性能测试证明现场计算不可接受，才增加物化缓存；
8. 每个 Phase 单独迁移、单独回归，禁止一次 schema 迁移同时改四种评估器和策略运行时。

## 13. 明确非目标

- 不批量导入上百个因子；
- 不因支持多资产就直接建设重型 Barra 克隆；
- 不在第一版提供任意勾选控制变量直到显著的 p-hacking UI；
- 不把宏观相关性包装成因果结论；
- 不把研究多空组合默认当成境内可执行交易策略；
- 不在数据底座稳定前上 ML、自动因子挖掘或遗传表达式搜索；
- 不在 Factor V2 中顺带泛化商品/国债期货交易引擎；
- 不让 Factor Signal 直接落成订单，组合构建和风险约束必须保持独立。

## 14. 完成定义

### 14.1 Factor V2 MVP（Phase 0–3）

第一轮工程在以下条件全部满足时完成：

1. 股票横截面研究完整迁入统一协议且零回归；
2. 至少一个债券或 ETF 时间序列因子完成正式样本外研究；
3. 因子可发布为不可变版本，策略可显式引用具体版本；
4. 回测、部署和每日交易信号能追溯到同一 release 和预测输入；
5. 旧因子、旧报告、旧策略和 FactorWeather 继续可用；
6. 用户能在一个产品闭环中完成：

```text
提出假设 → 定义因子 → 选择评估协议 → explore → holdout
→ 发布 → 策略引用 → 回测 → 部署 → 解释交易信号
```

### 14.2 Multi-Asset V1（Phase 4）

在 MVP 之上增加：

1. 至少一个跨资产 panel 因子完成 explore、holdout 和报告；
2. 股票、债券、黄金和商品 ETF 采用统一的历史可投资 Universe；
3. panel 因子可发布并被多资产策略显式引用；
4. Lab 能解释各资产的收益贡献、风险贡献、成本和配置漂移。

Phase 5 的专业商品、宏观状态和风险归因是持续演进，不作为 MVP 或 Multi-Asset V1 的阻塞条件。
研究到交易的闭环始终优先于继续扩充因子数量、增加复杂优化器或建设单独的债券/商品研究页面。
