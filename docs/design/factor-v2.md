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
   worker 中现场计算，只有已发布 Factor 的当期预测和策略决策快照按审计需要保存。
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
| Alpha Factor 预测因子 | 有明确假设、方向、适用范围和计算定义的收益预测规律；草稿可编辑，发布后不可变 | `Factor` 持久化 |
| Factor Signal 预测信号 | 发布因子在 `asOfDate × asset` 上的标准化分数、期限及可选校准预测 | 历史默认现场算；生产决策留快照 |
| Risk Factor 风险因子 | 用于解释收益、风险和相关性的系统驱动，如久期、信用、通胀 | 后续风险模型维护 |
| Target Weight 目标权重 | 策略根据一个或多个预测信号形成的组合决策 | 回测/部署快照保存 |
| Trade Signal 交易信号 | 下一执行日的买卖数量和订单意图 | 现有 `SignalRun` / `SignalExecution` |

为避免与现有“今日信号”混淆，代码和数据模型中使用 `FactorSignal` 表示预测输出；现有
`SignalRun` 继续只表示策略生成的交易指令。

完整链路固定为：

```text
Data Field → Feature → Published Factor
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
4. `Factor` 已具备 `draft → published → archived` 生命周期和不可变 key，但当前发布契约仍只覆盖
   单因子与批准报告，尚未覆盖组合因子和校准后的预测输出。
5. `ctx.factor()` 返回当前股票上下文中的标量，不能表达“因子对某个 ETF 的方向、强度、期限和
   来源 Factor、批准报告和代码 hash”。
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
│  └─ 已发布 / 已归档 Factor
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
   ├─ 选择批准报告并锁定 Factor
   ├─ 复制为独立草稿
   └─ 查看策略引用与血缘
```

债券、商品和宏观不做独立的 Factor 产品，只提供领域入口和模板：

- 债券：利率趋势、曲线水平/斜率/曲率、Carry/Roll-down、信用和流动性；
- 商品：时间序列动量、横截面动量、Carry、基差、库存、仓单和持仓；
- 宏观：增长、通胀、信用、流动性和外部环境的状态或变化率；
- 跨资产：动量、估值、Carry、波动和宏观敏感度。

### 4.2 策略 Lab

策略 Lab 不复制研究报告，只增加三类能力：

1. 浏览并引用已经发布的因子；
2. 查看某次回测实际消费的预测信号快照；
3. 增加多资产收益贡献、风险贡献和宏观阶段表现。

`period` 继续承担定时调仓，不新增另一套“资产配置调度器”。

## 5. 目标领域模型

### 5.1 保留现有实体

- `Factor`：草稿可编辑、发布后不可变的研究资产；内置因子仍以稳定 slug seed；
- `FactorReport`：一次不可变研究运行，继续同时承担 experiment 语义；
- `FactorComposite`：可编辑的多因子研究定义；
- `Job`：后台计算尝试；
- `Strategy` / `StrategyDeployment` / `SignalRun`：策略、部署和交易信号。

当前没有“一项命名研究包含多组报告并独立协作/分享”的真实操作，因此暂不新增
`FactorExperiment`。以后满足现有研究纪律文档列出的触发条件时再提炼。

### 5.2 Factor 生命周期与唯一 key

Factor 不再包含用户可见的发布版本，也不再设置 `FactorRelease`。生命周期只有：

```text
draft → published → archived
```

- `key` 是用户内唯一、创建后不可修改的英文索引；策略直接以 `ctx.factor(key, asset)` 引用；
- `name` 是允许中英文和重名的显示名称，草稿期可修改；
- 草稿的代码、名称、描述和 Agent 对话自动保存；
- 发布必须选择同一 Factor、同一代码 hash 的已完成报告；密封 Holdout 未揭示时不得发布；
- 发布把 `approvedReportId`、`codeHash` 和 `publishedAt` 写回 Factor，并在服务端锁定名称、代码、研究
  类型、描述和对话；
- 修改已发布 Factor 的唯一入口是“复制”：代码、配置、描述和完整 Agent 对话复制到独立 `_vN` 草稿，
  报告、发布状态、策略引用和验证结论不复制；复制后不保留父子关系；
- 已发布 Factor 不得删除，只能归档；归档后不进入新策略补全，历史回测仍可按 Factor ID 与代码 hash
  追溯；
- `FactorWeatherPin` 只接受已发布 Factor，并继续冻结自己的代码与方法快照。

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
  factorId: string;
  dataCutoff: string;
}
```

- `assetId = null` 表示全局宏观状态输出；它必须经过显式资产映射才能形成目标仓位；
- `score` 是统一方向后的无量纲预测分数，正值表示相对更高的预期收益，但策略仍负责阈值和仓位；
- `expectedReturn` 只有模型给出明确收益单位时才填写；`upProbability` 只有经过样本外概率校准时才填写，
  且必须同时给出 `calibrationReportId`，普通 IC、t 值或历史命中率不得包装成“置信度”；
- 历史研究在 worker 内生成并直接交给评估器；
- 策略回测在 run 内缓存，不跨报告复用未经版本校验的值；
- 每日部署只在策略决策快照中保存实际使用的少量信号和 Factor ID，用于解释订单；
- 只有实测重复计算成本无法接受时，才讨论按 factor/date 物化缓存，不能提前建设大宽表。

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

- Factor、批准报告与代码 hash 快照；
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

### 8.1 策略只引用不可变 Factor.key

新增概念 API：

```ts
const bondSignal = ctx.signal('bond_trend', '511260.SH');
```

最终命名在 SDK 设计阶段确定，但必须满足：

- 策略声明已发布 Factor 的唯一 `key`；Factor 发布后不可修改，因此 key 永不漂移；
- 返回 `FactorSignal | null`，而不是直接返回目标权重；
- 时间只能是当前决策日，不能从策略代码传任意未来日期；
- 运行时按 Factor 的字段依赖和 PIT 规则取数；
- 回测、参数扫描、部署和每日信号使用同一计算实现；
- `StrategyDeployment` 冻结 Factor ID、key、代码 hash、批准报告和数据契约版本。

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

### Phase 1：通用报告骨架与不可变 Factor

**2026-08-07 不可变 Factor 子阶段实施状态：**身份、生命周期和策略消费纵向闭环已完成；Phase 1
的通用 Definition / Report 扩展仍按后续批次推进：

- `FactorReport` 增加 `analysisKind`，历史和现有运行默认按 `cross_sectional` 读取；
- 新增共享 `FactorSignal`、`FactorDependency` 及发布请求类型；
- Factor 增加 `draft/published/archived` 生命周期、批准报告、代码 hash 和发布时间；
- 发布只接受同一 Factor、同一代码 hash 的完成报告，未揭示 Holdout 明确拒绝；
- Factor Weather 只接受已发布 Factor，并继续保留自身冻结快照；
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
- 报告结果页发布区展示“Factor key ← 批准报告 ← 代码 hash”血缘；发布后编辑器与 Agent 都切换为只读，
  只能复制成新的 `_vN` 草稿继续研究。
- Strategy Lab 与 Monaco 只列出 published Factor，插入可读的唯一 key，运行血缘冻结 Factor ID、key、
  名称、研究类型、代码 hash 与批准报告。
- 新建 Factor 在确认 key 后立即持久化；草稿自动保存，发布后不可修改，复制会保留代码、配置、描述和
  完整 Agent 对话，但不复制报告、状态、策略引用或父子关系。
- bootstrap 在 Prisma migration 前执行幂等身份迁移，为旧数据补齐唯一 key；随后 schema migration 删除
  `FactorRelease` 及旧引用字段，运行时只保留 `Factor.key` 一套身份。
- 真实浏览器 E2E 已覆盖创建、分析、发布、归档、`_vN` 复制、Lab 中文名称检索补全、raw key 插入、
  回测依赖冻结，以及债券 ETF 时间序列因子进入 ETF 策略回测。

策略消费 published Factor 已在 Phase 3 的纵向切片落地。Phase 1 不改变既有横截面因子计算结果。

**后端：**

- 新增 `FactorResearchSpecV1` 和分型 report payload；
- 新增 `FactorEvaluationScopeV1`，冻结 PIT Universe、排序范围和诊断切片；
- 将现有横截面分析包装为 `CrossSectionalEvaluator`；
- `FactorReport` 增加 `analysisKind`，历史行按 `cross_sectional` 解释；
- 新增 Factor 发布、复制、归档 API，并在所有写路径校验草稿状态；
- 发布时校验 factor hash、报告归属、研究阶段和揭示状态。

**前端：**

- 因子库增加“草稿 / 已验证 / 已发布”状态；
- 报告页增加统一的定义、数据、方法、证据和发布区；
- 老报告 URL、历史恢复、运行续接保持不变。

**验收门：**

- 当前全部股票因子报告金标准零漂移；
- 全 A / 沪深 300 / 中证 500 / 中证 1000 使用历史成分且形成独立 report variant；
- 行业内排序和行业中性化具有不同 spec 身份，行业 / 市值 / 流动性诊断不改变主报告发布判据；
- 已发布 Factor 不可修改，复制会生成独立 `_vN` 草稿并要求重新研究；
- UI 能追溯“Factor key ← 批准报告 ← 代码快照”。

### Phase 2：时间序列因子纵向切片

选择“已有 ETF 价格即可完成”的时间序列动量作为基础设施验收，再接一条真实债券驱动：

1. ETF 20/60/120 日趋势；
2. 国债收益率趋势或曲线斜率 → 债券 ETF 未来收益。

**2026-08-06 统计内核切片：**已实现独立 `TimeSeriesEvaluator` 的第一层纯计算边界：按资产输出因子值
与未来收益相关性、回归斜率、方向命中率、正负状态条件收益和 Newey-West t 值。评估输入显式携带
`featureAvailableDate`、`asOfDate`、`targetDate`，拒绝决策日后才可得的特征、越过冻结 data cutoff 的
前瞻收益、重复观测和未声明资产；自动或手填 lag 都不得低于重叠预测窗口所需的最小滞后。当前尚未接入
报告 UI，不能由产品页面发起。

**2026-08-06 ETF 观测切片：**已接入 `EtfDaily + EtfAdjFactor` 的批量加载和纯观测生成器，首版只接受
日频、交易日 horizon，可生成任意 2–504 交易日趋势（产品模板使用 20 / 60 / 120）及严格向后的未来
总收益。趋势和目标收益统一使用复权价，缺少复权因子、重复日期、未声明资产均 fail-closed；fixture
验证了份额拆分不会制造趋势、改变未来目标价格不会反向改变当日因子值。该切片尚未替代通用
`FactorDefinitionV2` 字段注册表，只是用现有 ETF 数据验收时间边界和复权口径。

**2026-08-06 worker 与报告接线切片：**统一 `/factor/analysis/run` 已接受 `time_series` spec，但只解析
`etf_trend_20 / 60 / 120` 三个受控模板；路由按全部目标 ETF 的共同最新行情冻结 data cutoff，拒绝未知
模板、无行情资产、超前 cutoff、panel/macro 和尚未实现的时间序列 hypothesis/holdout。durable Job 将
完整研究 spec 与模板快照交给 worker，结果以 `FactorTimeSeriesReportV1` 持久化并通过分型
`researchPayload` 读取，不再伪装为旧 `FactorReport`。横截面 variant/test key 继续使用旧 protocol 计算，
避免已有报告身份漂移。真实 worker 线程已用国债、黄金、沪深 300 ETF 的 2024 年数据跑通 720 条观测；

**2026-08-06 产品纵向切片：**`/factors` 已按“研究定义决定评估协议”的原则接入首个时间序列产品：
因子库把现有股票预设归入横截面组，并新增 ETF 20 / 60 / 120 日趋势模板；用户不再先选择一个抽象的
evaluator，而是在选中模板后只配置研究资产、未来收益 horizon 和样本区间。中间工作区展示只读信号
定义、输入和输出，不伪装成股票 `defineFactor` 代码；右侧报告按资产展示相关性、回归斜率、方向命中率、
Newey-West t 值和正负状态条件收益，并明确标注“信号证据不是策略回测”。不可变报告 URL、运行续接、
参数变更提示和历史恢复已打通，前端不再读取旧 `payload` 或调用股票发布区。真实浏览器已用国债、黄金、
沪深 300 ETF 跑通 7,287 条观测，配置态与报告态验收截图分别为
`apps/web/acceptance/9a-factor-time-series-config.jpg` 和
`apps/web/acceptance/9b-factor-time-series-report.jpg`。

**2026-08-07 Factor Definition V2 最小运行时：**时间序列模板已从“key → 后端硬编码 lookback”迁移为
真实可执行定义。首版字段注册表只开放 `etf.adjustedClose`，定义必须显式声明 `version = 2`、
`analysisKind = time_series`、`outputScope = asset`、日频、输入域、目标资产类别和所需窗口；计算上下文
首批只提供 point-in-time 的 `ctx.value(field)` 与 `ctx.lag(field, periods)`。worker 在 isolated-vm 中编译
冻结的 `defineFactorV2` 源码，由该源码逐资产计算 score，再交给既有 TimeSeriesEvaluator；报告保存原始
代码快照和 SHA-256，不再把模板配置 JSON 冒充代码。20 / 60 / 120 日趋势均通过同一编译器，复权、
未来价格隔离和未知字段 fail-closed 测试保持通过。前端中间工作区重新展示只读真实代码与输入、窗口、
输出审计，刷新不可变报告后仍恢复被冻结定义；真实浏览器验收截图为
`apps/web/acceptance/9c-factor-definition-v2.jpg`。

**2026-08-07 时间序列研究纪律：**时间序列已复用股票研究的研究卡、探索尝试计数、一次性 Holdout、
密封计算和不可逆 reveal，但采用自己的主判据，不把 Rank IC 强塞给时间序列。首批可预先冻结“跨资产
Newey–West t 中位数”或“跨资产方向命中率均值”；API 拒绝研究方法与判据错配。探索报告的数据截止
强制等于样本期末，避免前瞻收益穿过密封边界；正式 Holdout 的结束日取所选 ETF 的共同最新可用日期，
不能用股票日历中尚无 ETF 数据的日期冒充已验证区间。密封报告详情和 Job 日志均不返回结果，用户主动
揭示后才显示逐资产指标与预设判据是否通过。真实浏览器已完成“研究卡 → explore → 密封 Holdout →
reveal → 不可变 URL 回放”，并确认 3 个 ETF 的正式保留段截至共同数据日 2026-07-24，共 1,017 条观测。

**2026-08-07 内置模板与发布：**内置模板本身是只读 published Factor；要修改模板时先复制为用户草稿，
运行研究并批准报告后再发布。发布时复核报告冻结的 Definition V2 与当前 Factor 代码逐字一致，不再为
虚拟模板建立另一套发布身份。

**2026-08-07 ETF 策略求值内核：**已发布的单因子时间序列 Definition V2 可在研究回测中通过
`ctx.factor('etf_trend_20', etfCode)` 按策略决策日逐资产求值。host 从不可变 Factor 代码重新编译并冻结
window / inputs 契约，direct 与 walled lane 在引擎内使用同一实现读取截至当日的 ETF 复权行情；
窗口未满返回 `null`，声明 `etf.adjustedClose` 的定义若收到普通股票代码也返回 `null` 并记录首个契约错误；
动态标的仍须先 `ensureBars`，显式 `watch` 会在运行前加载。策略得到的是定义本身算出的 score，不会把
研究报告中的相关性、t 值或命中率误作交易信号。每日信号生产门槛及其完成状态见 Phase 3。

**2026-08-07 自定义定义类型地基：**`Factor` 已持久化创建后不可变的 `analysisKind`，历史记录默认保持
`cross_sectional`。创建和更新不再用“任一编译器能通过”来猜测定义类型，而是按该身份严格选择
`defineFactor` 或 `defineFactorV2` 编译器；研究路由同样拒绝把股票定义交给时间序列 evaluator，或把
时间序列定义交给股票 evaluator。

**2026-08-07 自定义 Definition V2 产品切片：**“新建”只让用户选择创建后不可变的定义协议——股票
横截面因子或 ETF 时间序列信号，而不是再增加一组会与资产类别互相冲突的 evaluator 开关。自定义时间
序列定义使用可编辑 Monaco、Definition V2 输入/窗口/输出审计和时间序列参数报告；因子库仍以“内置模板
与自定义因子”为所有权主结构，并用研究方法徽标区分定义。相关性矩阵和多因子合成只接收横截面定义，
避免把不同样本结构错误混算。Factor Agent 已按持久化 `analysisKind` 选择专用提示词和严格编译器；当前
只允许 `etf.adjustedClose`，遇到曲线、Carry、库存或宏观请求必须明确拒绝。真实浏览器已完成“新建 ETF
时间序列定义 → 冻结探索研究卡 →
7,227 条观测报告 → 刷新恢复 → 因子库方法徽标”，截图为
`apps/web/acceptance/10a-custom-time-series-definition.png` 和
`apps/web/acceptance/10b-custom-time-series-report.png`；发布和策略消费的后半段验收见 Phase 3。

**2026-08-07 时间序列 Agent 研究工具：**自定义 Definition V2 的 Agent 已获得独立
`runTimeSeriesFactorAnalysis`，不再误用股票的频率、股票池、中性化和 Rank IC 参数。每次调用必须在看到
结果前冻结候选完整代码、ETF 资产、未来收益 horizon、样本区间和研究卡；工具固定日频复权价格、PIT
cutoff 与 Newey–West 自动 lag，只返回逐资产指标及跨资产中位 t / 平均命中率。首版资产和 horizon 与
产品当前能力一致，仍不能揭示 holdout、发布、部署或代表用户下单。

时间序列策略内核和策略 Lab 产品入口已进入 Phase 3，自定义 V2 定义与 Factor Agent 作者能力也已开放；
**2026-08-07 国债曲线因子纵向切片：**Factor V2 字段目录已开放财政部中国国债收益率曲线
`rates.cgb.yield.2y / 5y / 10y / 30y`，单位为百分比；定义自行将变化量和期限利差转换为 bp。源数据
完整同步 2006-03-01 至 2026-08-06，曲线在约 17:30 发布，所以每个点从下一上交所交易日才允许进入
`ctx.value / ctx.lag`。research observation loader、策略 direct lane 与 walled lane 复用相同 PIT 口径，
未知字段、非债券 ETF 目标、缺曲线和普通股票代码均 fail-closed。

内置模板新增 10Y 收益率 20 日下行、10Y−2Y 曲线斜率与 2Y/5Y/10Y 曲率，并作为只读 published
Factor 使用唯一 key。真实页面用 5Y/10Y/30Y 国债 ETF 在 2018-01-01 至 2026-08-06 生成 4,853 条
20 日前瞻观测；报告显式展示来源、下一交易日可得规则、逐资产相关性、Newey–West t 与方向命中率。
浏览器回归与截图为 `apps/web/e2e/bond-curve-factor.mjs`、
`apps/web/acceptance/11a-cgb-yield-factor-config.png`、
`11b-cgb-yield-factor-report.png` 和 `11c-cgb-yield-factor-metrics.png`。

至此 Phase 2 的“价格信号 + 真实债券驱动”交付完成；生产日常维护与每日信号开放仍属于 Phase 3 的
production 门槛，不因研究链路跑通而自动开放。

**交付：**

- `FactorDefinitionV2` 最小运行时和数据字段注册表；
- `TimeSeriesEvaluator`；
- 时间序列报告 UI；
- 研究卡、holdout、揭示、报告历史和尝试计数复用；
- 至少一个内置 ETF 时间序列因子和一个债券因子模板。

**数据依赖：**ETF 日线与官方国债曲线已具备；后续曲线同步必须保留来源归属、北京时间解析和
下一交易日可得门控，不得改用 ETF 价格反推并冒充曲线数据。

**验收门：**同一因子在 fixture、worker、报告重跑中可复现；人为构造未来泄漏会被测试拦截；重叠
horizon 的显著性不使用朴素独立样本 t 值。

### Phase 3：已发布 Factor 进入策略 Lab

**2026-08-07 身份模型收口：**

- TypeScript 策略在 `factors` 与 `ctx.factor` 中直接使用不可变 `Factor.key`，不支持前缀或版本 ID；
- Agent prompt 与 Monaco 只列出当前用户 published Factor，建议项同时展示 key、name、研究类型和描述，
  选择后只插入 key；
- host 按当前用户和内置所有者解析 Factor，只有 published 或历史追溯所需的 archived Factor 能进入研究
  回测；草稿、外部用户因子和未知 key 均 fail-closed；
- `BacktestSummary.factorDependencies` 冻结 Factor ID、key、名称、研究类型、代码 hash 和批准报告，可从
  结果页回到 Factor 与报告；
- `StrategyDeployment.factorDependencies` 与 `SignalRun.factorDependencies` 复制同一血缘快照，worker
  执行前重新解析并比对，发现漂移或损坏即失败；
- 每日 worker 只在最终决策 bar 记录策略真实调用过的 Factor/资产/value；`SignalRun.factorInputs` 按
  Factor ID 和 key 保存覆盖数、有效数、最小/最大/均值与决策资产实际值；
- published Factor 可一键打开 Strategy Lab；页面按 key 重新读取当前用户的 published Factor，并从批准
  报告恢复时间序列研究资产，预填显式 `watch`、`ctx.factor` 和 `ctx.period` 约束；
- 时间序列 Factor 已进入研究回测与每日信号 runtime；跨资产面板 Factor 已进入研究与策略回测
  runtime，宏观状态 evaluator 仍未进入策略 runtime，引用时明确失败。

**2026-08-07 时间序列每日信号生产闭环：**部署不再按研究方法一刀切拒绝时间序列 Factor。部署快照除
Factor ID、key、代码 hash 和批准报告外，继续冻结 Definition V2 的 `inputs`；每日 worker 重编译后逐项
比对，数据字段发生漂移也会失败。日常维护只在活跃部署实际依赖 `rates.cgb.yield.*` 时访问财政部曲线源，
同步最近窗口并保留“下一上交所交易日可得”的 PIT 口径；纯股票/ETF 部署不受外部曲线源影响。生成单个
部署的信号前，按其冻结依赖逐期限检查曲线，截至决策日缺期限、含未来数据或超过 14 个日历日未更新均
返回 `data_not_ready`，不会静默把空值当交易信号。ETF 价格时间序列使用既有按 `watch` 同步链路。
“今日信号”同时展示该决策日真正读取的 Factor、有效覆盖、均值和逐决策标的值，而不是只在数据库保存。
真实浏览器已走通“利率 Factor 策略回测 → 部署 → 指定已发布截止日生成信号 → 页面解释输入”，并断言
回测、部署、SignalRun 三层均冻结 `rates.cgb.yield.10y`，最终决策值为 `511010.SH 1.1900`。回归脚本为
`apps/web/e2e/bond-curve-signal.mjs`，截图为 `apps/web/acceptance/12a-cgb-signal-deployment.png` 和
`12b-cgb-signal-factor-inputs.png`。

尚未完成：面向时间序列 evaluator 的校准 `FactorSignal` 输出。当前一键带入只形成明确的策略研究请求，
仍由 Agent 生成策略并经策略回测验证，不把因子报告本身误认为交易算法。

**交付：**

- 新增策略 SDK 的 published Factor key 引用；
- Factor 在回测 worker 和每日信号 worker 中使用同一求值器；
- 策略配置与部署冻结 Factor 依赖；
- 回测结果展示“使用了哪些因子”及关键预测信号；
- `SignalRun` 保存产生交易决策时实际使用的因子信号摘要，不改变其交易信号语义；
- 从因子报告提供“在策略 Lab 中使用”的显式动作。

**首个闭环验收：**

```text
创建 ETF 时间序列因子
→ explore
→ holdout/reveal
→ 发布 Factor
→ 策略引用 Factor.key
→ period 调仓回测
→ 部署
→ 今日信号可追溯到 Factor ID 与代码 hash
```

发布后的 Factor 不允许编辑；复制出的 `_vN` 草稿与原 Factor 完全独立，历史结果不得漂移。

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

**2026-08-08 第一条 Panel 纵切：**已实现结构化 `PanelSpec`、共同月末 ETF 面板装载、
`PanelEvaluator`、Definition V2 `analysisKind = panel` 编译与 worker、策略运行时和 Factor Lab 专属报告。
首发固定资产池为沪深 300 ETF（境内权益）、纳指 ETF（海外权益）、国债 ETF（固收）和黄金 ETF；
ETF 元数据必须与声明资产类别一致，上市较晚、历史窗口不足、共同目标日缺行情和超出数据 cutoff 均
fail-closed，不会静默回填。报告同时展示跨资产 Rank IC / ICIR、等权强制基线、Top/Bottom、成本前后
多空、单边换手和逐资产覆盖。内置 `cross_asset_momentum_120` 可复制、研究，并在发布后通过唯一
`Factor.key` 进入多资产策略；从报告进入 Strategy Lab 会预填固定资产池、`watch`、`ctx.factor` 与
月度 `ctx.period` 的研究请求。

真实 E2E 在 2020–2024 样本得到 59 个有效月末、236 条观测，并从内置已发布 Factor 的“用于策略”
入口进入 Strategy Lab；内置与用户自建 Factor 共享策略入口，但只有用户自建 Factor 能发布或归档。
脚本随后用同一 key 对四类 ETF 做月频排序、选择最强两只等权，2023-01 至 2025-01 实际产生 42 笔
ETF 成交和 30.24% 区间收益，并冻结 `analysisKind = panel` 的因子血缘。研究报告的样本平均 Rank IC
为 0.0712、单边 10bp 后多空年化为负 7.14%；策略结果页另行标注其收益来自真实持仓、现金、费用和
成交约束，不把两条收益序列混为一谈。回归脚本为 `apps/web/e2e/factor-panel.mjs`，截图为
`apps/web/acceptance/factor-panel-report.png` 和 `apps/web/acceptance/factor-panel-strategy.png`。

**2026-08-09 Panel 研究纪律验收：**真实浏览器已走通“预设假设与主要判据 → 59 个月探索段 →
16 个月密封 Holdout → 不可逆揭示”。密封报告不返回 payload、metrics、研究结果或 Job 日志；重复揭示
保留同一首次查看时间。`cross_asset_momentum_120` 在探索段平均 Rank IC 为 0.0712，但正式保留段为
-0.1500，因此产品明确显示“未达到预设主要标准”，没有把探索段正向结果包装成有效信号。回归仍由
`apps/web/e2e/factor-panel.mjs` 负责，新增截图
`apps/web/acceptance/factor-panel-holdout-sealed.png` 和
`apps/web/acceptance/factor-panel-holdout-revealed.png`。

**2026-08-09 国债久期梯队：**默认 Panel Universe 扩展为 6 只 ETF，在原有境内权益、海外权益、
黄金和 5 年国债之上加入 10 年、30 年国债 ETF。Factor 参数、研究报告和 Strategy Lab 预填共用同一
份 Universe，避免研究与交易漂移。资产类别仍保持专业语义上的 `fixed_income`，久期由具体标的表达，
不把每个期限误建成新的大类资产。研究装载严格保留上市历史：2020–2024 探索段共 59 个有效月末，
5 年和 10 年国债各有 59 条观测；30 年国债 ETF 上市且满足 121 日窗口后，首个有效月末为 2023-12-29，
只有 12 条观测。因此 6 资产报告实际为 307 条观测、每月覆盖最少和中位数均为 5、最多为 6，而不是
静默回填成 354 条。真实 E2E 继续走通密封 Holdout 与策略交接；六资产月度轮动产生 43 笔 ETF 成交，
2023-01 至探索段末区间收益为 24.00%。
久期覆盖验收截图为 `apps/web/acceptance/factor-panel-duration-coverage.png`。

1–3 年国债 ETF（511160.SH）直到 2025-01-06 才上市，暂不以“短债长历史”名义加入默认研究池；
短久期暴露仍留待更长历史的可交易标的或底层指数研究。

**2026-08-09 商品 ETF 纵切：**豆粕（159985.SZ）、有色金属（159980.SZ）和能源化工
（159981.SZ）完成日线与复权同步，并通过上市以来开放日零缺口、零无成交、复权因子逐日覆盖和极端
收益检查。三只 ETF 已加入日常 `major` 数据同步、时间序列资产选择和默认 Panel Universe；产品保留
各自真实暴露名称，能源化工不冒充原油。ETF 总收益可以参与信号发现和策略成交，但不能被解释成专业
期货 Carry、库存或换月归因，后者仍属于 Phase 5。
空库全量导入和已有库 bootstrap 回填都覆盖这三只 ETF，产品代码不会先于生产行情上线。

九资产真实 E2E 在 2020–2024 探索段得到 59 个有效月末、468 条观测，覆盖最少 5、中位数 8、最多
9 个资产。豆粕、有色金属分别从 2020-06-30 起各有 54 条有效观测，能源化工从 2020-07-31 起有 53 条；
30 年国债仍严格保持 12 条晚上市观测。九资产月度轮动产生 46 笔真实 ETF 成交，2023-01 至探索段末
区间收益为 14.41%。探索段平均 Rank IC 为 0.0704，但密封 Holdout Rank IC 为 -0.1479，产品继续判定
“未达到预设主要标准”：本纵切验收的是数据、研究和交易链路，不宣称 120 日动量有效。商品覆盖截图为
`apps/web/acceptance/factor-panel-commodity-coverage.png`。

**2026-08-09 Panel 类别证据分解：**报告不增加一个会改变 Factor 含义的“标准化开关”，而是固定
提供三层可核对证据。全局 Rank IC 继续直接比较所有 ETF；类别内 Rank IC 在每个 `类别 × 月份` 内
独立排名后等权汇总，只回答同类标的能否选对；类别间 Rank IC 先把每类 ETF 的分数和未来收益分别
等权聚合，再跨类别排名。类别间多空组合同样先按类别平均分选择 Top/Bottom 类别，再在所选类别内部
分配 ETF，并单独计算换手和成本。这样 ETF 数量更多的固收、商品不会在类别间证据中自动获得更多票数。

该分解只存在于研究报告，不改写 Factor 原始分数，也不静默改变 Strategy Lab 的交易算法。冻结的旧
Panel 报告允许没有新增诊断字段，读取时保持兼容。九资产真实 E2E 得到：全局 Rank IC 0.0704；113 个
可比较的 `类别 × 月份` 内平均 Rank IC 为 0.0796；59 个月类别间 Rank IC 为 0.0356。更关键的是，
全资产费后多空年化为 +6.26%，真正的类别间费后多空年化却为 -8.52%、平均单边换手 37.29%。因此
探索样本中的正向证据更接近同类 ETF 内部选择，不能被包装成已验证的大类配置能力；正式 Holdout
仍以预设全局标准判定失败。回归截图为
`apps/web/acceptance/factor-panel-normalization.png`。

**2026-08-09 Panel 组合因子研究纵切：**`FactorComposite V1` 继续只表达股票横截面，新建
`FactorPanelCompositeDefinition V2` 表达跨资产 Panel，用户在同一个组合创建器中先选择研究方式，再从
对应方法允许的 Factor 中选择 2–5 个成分。首个受控基线把跨资产 120 日动量设为正向、60 日年化波动率
设为负向；每个月末严格取所有成分共有的 `日期 × ETF` 观测，分别做 Rank 或 Z-score 标准化、对齐方向后
等权平均，不拟合成分权重。报告冻结完整组合定义和每个成分的可执行源码，Holdout 直接复用同一快照，
后续修改可编辑组合或成分不会污染历史报告。

九资产真实 E2E 在 2020–2024 探索段得到 59 个有效月末和 468 条组合观测，并完成密封 Holdout；页面同时
展示组合方法、正负方向、Panel 覆盖、全局与类别分解证据。回归脚本为
`apps/web/e2e/factor-panel-composite.mjs`，截图为
`apps/web/acceptance/factor-panel-composite.png`。

**2026-08-09 Panel 组合发布与策略闭环：**`FactorPanelCompositeDefinition V2` 在创建时取得用户内唯一、
不可修改的 `key`；草稿可编辑，发布时必须绑定同一组合的完成报告，并逐字复核报告冻结的组合定义与全部
成分源码。发布还要求每个 Panel 成分本身已经发布。发布后组合不可编辑或删除，只能归档或复制为独立的
`_vN` 草稿；复制不继承报告、发布状态或策略引用。

策略 host 从批准报告读取冻结源码包和研究 Universe，不再读取成分的当前代码；策略的显式 `watch`
必须与批准报告资产池一致，不一致时 fail-closed。`ctx.factor(compositeKey, asset)` 在每个
决策日先对该资产池中所有 ETF 计算共有成分，再按研究定义做共同交集、Rank/Z-score、方向对齐和
等权合成。因此策略消费的是与报告同义的跨资产可比分数，同时仍由策略自己决定调仓周期、Top N、目标
权重和真实订单。策略回测结果只冻结父组合 ID、key、源码包 hash、批准报告和输入字段，不把内部成分
伪装成多条独立策略依赖。

真实浏览器已走通“创建组合 → Panel explore → 密封 Holdout → 发布 → 用于策略 → 月度 ETF 多头回测”，
2023-01 至 2025-01 产生 41 笔真实 ETF 成交；结果页显示唯一父依赖
`momentum_low_vol_panel`，批准报告源码包 hash 与回测血缘一致。回归脚本仍为
`apps/web/e2e/factor-panel-composite.mjs`，新增截图
`apps/web/acceptance/factor-panel-composite-published.png` 和
`apps/web/acceptance/factor-panel-composite-strategy.png`。

**2026-08-09 多资产配置归因与每日信号闭环：**策略引擎新增结构化 `allocationAnalysis V1`，不允许
前端根据成交日志反推会计结果。每个交易日按实际持仓价格变动、当日成交后价格变动、逐资产手续费和
滑点计算净贡献；资产净贡献相加必须与期末权益变化逐分对账，报告同时保留对账残差和容忍度。收益贡献
是相对初始资金的可加总算术贡献；风险贡献使用每日资产净贡献收益与组合日收益的成分协方差法，在组合
方差有效时归一到 100%。每次 `setHoldings` / `equalWeight` 还记录决策日、次日开盘执行日，以及包含现金
在内的目标、调仓前、调仓后权重，展示半周转口径的配置偏离和最大单项偏离。

资产类别不从 ETF 代码、名称或当前产品元数据猜测，而只读取批准 Panel 报告冻结的资产池；单一 Panel
Factor 和 Panel Composite 使用相同口径，分类冲突时 fail-closed，没有批准研究池的旧内置 Factor 则
继续运行但不生成可能误导的配置归因。Lab 结果概览新增
“多资产配置归因”，按资产类别、具体资产和配置漂移三层展示实际策略结果，并继续与 Factor 研究报告的
Top/Bottom 诊断收益严格分离。

真实浏览器已进一步走通“Panel Composite 发布 → 月度 ETF 回测 → 配置归因 → 部署 → 2026-07-30
今日信号”。回测产生 41 笔 ETF 成交和 25 次调仓，组合盈亏与 9 个资产净贡献完全对账；每日信号读取到
9/9 个有效组合分数，只记录父组合 `momentum_low_vol_panel` 的批准报告和源码包 hash。回归脚本仍为
`apps/web/e2e/factor-panel-composite.mjs`，新增截图
`apps/web/acceptance/factor-panel-composite-attribution.png` 和
`apps/web/acceptance/factor-panel-composite-signal.png`。

**2026-08-09 资产类别滚动相关：**`allocationAnalysis V1` 增加市场收益相关性，但不把策略持仓贡献
误当作资产收益。引擎从批准 Panel 资产池读取类别，对每个交易日具有相邻两日真实复权行情的 ETF 计算
日收益，再在类别内对当日有效 ETF 等权；缺少当日行情时不使用前值制造零收益。报告同时给出 60 日和
120 日窗口，要求至少 2/3 的成对有效观察，并只保存最新矩阵和月末滚动点，避免在回测结果中堆积原始
日线。类别矩阵附带逐格有效样本数，零方差或覆盖不足返回 `null`，不伪造相关系数。

Lab 的“多资产配置归因”新增“相关性”页，可切换 60/120 日窗口，查看最新类别热力图，并选择任意两个
类别观察月末滚动曲线；最高正相关达到 0.75 时提示分散效果可能下降。九资产真实 E2E 形成 5 个类别、
10 个唯一类别对；截至 2025-01-27，60 日矩阵最高非对角相关为 0.33，没有触发预警，60/120 日最低
有效样本门槛分别为 40/80。回归脚本为 `apps/web/e2e/factor-panel-composite.mjs`，新增截图
`apps/web/acceptance/factor-panel-composite-correlation.png`。

**2026-08-09 利率环境分解 V1：**在完整宏观长表和 vintage 尚未落库前，Phase 4 不用最终修订的 PMI、
CPI 等数据伪造“经济四象限”，而是先复用已经通过 PIT 验收的官方国债收益率曲线。每个交易日只读取
`availableDate <= decisionDate` 的曲线点；10 年收益率相对 60 个曲线观测前分为上行/下行，10Y−2Y
利差相对过去 252 个曲线观测的中位数分为较陡/较平，中位数至少需要 120 个同日有效观测。超过 14 个
自然日没有新曲线时停止分类，不把陈旧数据无限前填。

这四种透明状态只用于策略结果的条件表现复盘，不参与当次策略权重，也不发布为 Factor。引擎按批准
Panel Universe 的资产类别市场收益统计状态交易日、阶段数、平均持续时间、条件日均收益、年化均值、
年化波动、正收益比例和最差连续状态段回撤；Lab 新增“利率环境”页，展示最新状态、10 年收益率变化、
期限利差与历史中位数，并明确披露覆盖率和方法。增长、通胀、信用、流动性和外部环境仍须先完成
`MacroSeries` / `MacroObservation`、available date 和 vintage 底座，再进入 Phase 5 的完整宏观状态研究。

九资产真实 E2E 的 2023-01 至 2025-01 策略区间共 502 个交易日，502 日均可分类，四种状态分别出现
13、108、215 和 166 日；截至 2025-01-27 为“利率下行・曲线较平”，10 年收益率 1.65%，60 观察期
下降 48.7bp，10Y−2Y 利差 33.8bp，低于历史中位数 55.6bp。页面默认展示与利率最相关的固定收益，
也可切换中国权益、海外权益、黄金和商品。回归脚本为 `apps/web/e2e/factor-panel-composite.mjs`，新增
截图 `apps/web/acceptance/factor-panel-composite-rate-regime.png`。

**Phase 4 已完成。**专业期货 Carry、库存和完整宏观 PIT/vintage 状态研究归 Phase 5。

### Phase 5：商品专业特征、宏观状态与风险因子

按数据成熟度分两条线推进：

1. **商品因子：**实际月合约期限结构、换月、Carry、仓单和持仓；
2. **宏观状态：**增长、通胀、信用、流动性和外部环境，严格按数据发布日期、available date 和 vintage 使用。

**2026-08-11 Phase 5 实施合同冻结：**本阶段不把所有分析对象继续叫作同一种 Factor。统一协议明确保留
三条不同频率、不同用途的链路：

1. `Alpha Factor` 继续预测未来收益，仍须经过 explore、holdout、发布和策略引用；
2. 日频 `Market Risk Factor` 用权益、国债曲线、信用利差、USD/CNH、美国实际利率、黄金和商品等可交易
   市场驱动估计组合暴露、协方差与风险贡献，不参与 Alpha 排名；
3. 月频 `Macro Risk Axis` 用增长、通胀、信用、流动性和外部环境研究条件收益与组合敏感度，不与日频
   协方差混算。

共享合同位于 `packages/shared/src/risk-research.ts`。所有报告均须携带数据截止、逐序列可得水位、revision
policy、PIT 资格和未来 vintage 数；覆盖不足时字段缺失，不用 0 冒充无风险。Strategy Lab 最终只增加
风险暴露、宏观敏感度、Alpha/Risk 重合和线性情景分析，不新增债券/商品专用回测页，也不开放商品期货交易。

Phase 5 的完成边界是：上述五类日频市场风险驱动与五类月频宏观轴至少各有一条可审计输入；ETF 策略报告
可输出风险暴露、风险贡献、宏观敏感度、Alpha/Risk 重合和预设情景，并通过真实浏览器验收。历史宏观
最终值可以探索但不能伪装成严格 PIT；在本地 vintage 积累不足时，宏观发布/holdout 不作为工程完成的
虚假门槛，而必须保持不可发布。

**2026-08-11 Phase 5 国内流动性与信用底座：**`MacroSeries` / `MacroObservation` 继续作为统一长表，
新增 M1/M2 余额及同比、社融增量/存量、Shibor O/N/1W/1M/3M，使规范目录达到 13 条。日频 Shibor
使用 `YYYYMMDD` observation period，并按官方 11:00 发布时间允许进入当日收盘后的研究；月频货币和
社融在发布日历缺项时使用月末后 20 日的显式保守可得日。真实回填共 21,919 个 vintage，同区间幂等复跑
新增 0 条；bootstrap、weekly maintenance、质量审计和 Agent SQL 文档均已覆盖。首次历史回填仍统一
标记 `latest_value_backfill`，因此这里只完成信用、流动性轴的输入底座，不提前改变现有增长/通胀 Macro
Regime evaluator，也不扩大其发布资格。

**2026-08-11 Phase 5 外部市场底座：**Tushare 美国名义曲线、实际曲线和 USD/CNH 已完成真实全量
回填。两条曲线复用 `YieldCurvePoint`，USD/CNH 用 `FxDaily` 保存原始双边报价；三者都把美国/GMT
源日期映射到严格更晚的首个上交所交易日，禁止中国收盘研究读取尚未完成的同日全球数据。实际覆盖为
61,021 个名义曲线点、25,690 个实际曲线点和 4,382 根 USD/CNH 日线，已进入 bootstrap、daily
maintenance、数据审计和 Agent SQL。它们是 `not_revised` 的日频 Market Risk Factor 输入；本切片只
完成数据与 PIT 契约，不提前计算组合 beta、协方差或黄金/实际利率结论。

**2026-08-11 Phase 5 信用利差底座：**Tushare 优先调研后确认 `yc_cb` 无法在当前权限与目录下
同时提供国债和信用债曲线，因此按数据门槛接入中债官网的正式历史下载。新增
`chinabond_cgb_ytm`、`chinabond_bank_aaa_ytm` 和 `chinabond_cp_note_aaa_ytm`，共回填
106,550 个原始曲线点；三条 5Y 曲线共 13,897 个可审计观测，PIT 与数值检查均通过。
信用利差不作为第四条原始数据落库；后续 Market Risk Factor 在同日、同期限上计算
`(AAA yield - CGB yield) × 100bp`，缺期限时该观测缺失，禁止插值、用 ETF 收益差替代或强行写 0。
daily maintenance、bootstrap、质量审计和 Agent SQL 已纳入这三条曲线；本切片仍只完成风险
驱动的原始数据层，不提前实现组合风险模型。

**2026-08-11 Phase 5 商品排名持仓底座：**Tushare `fut_holding` 已按 AU/CU/M 实际主导合约
回填 8,400 个品种日，三者对完整 FutureDaily 可选代表日的覆盖率分别为 99.89%/99.89%/
98.93%，全量幂等复跑不漂移。代表合约每日按 OI 最大选择，这只是研究数据对齐，不是交易引擎
的主力合约或换月指令。三个榜单的排名子集、前五集中度和 OI 分母均可审计；早期类别汇总行被
显式排除，M 2020-11-06 的唯一双倍异常有精确修正标记。SC/INE 真实探测持续为空，因此保留
缺源状态。这批数据可以在后续生成“排名净头寸/排名集中度”特征，但本提交不会把它们直接声明为
Alpha，也不试图从期货公司名称推断投机/商业交易者身份。

**2026-08-11 Phase 5 商品连续收益与换月台账：**Tushare 主力映射与实际合约结算价已形成可复算的
`CommodityContinuousReturn`。V1 不读取带 `L` 的近月连续代码，也不直接对切换前后的不同合约价格求收益；
主力代码发生变化时，以新合约的前一日结算到当日结算形成 `continuousReturn`，并把旧/新合约前一日价差
单列为 `rollGapLogReturn`，因此原始切换代码收益恰等于连续收益加换月跳口。反号
`rollYieldProxy` 仅解释期限结构，不能称为已实现 P&L。2015-01-05 至 2026-07-30 的 10,462 个映射
品种日形成 10,458 条收益、306 个切换日；AU/CU/SC/M 的交易日映射与可计算区间覆盖均为 100%，
复算和 PIT 审计 PASS。该序列将在下一批作为日频商品 Market Risk Factor 输入，当前仍不参与 Alpha
发布、策略权重或商品期货成交。

**2026-08-11 Phase 5 日频市场风险模型：**九个 `Market Risk Factor` 已形成严格 PIT 的统一日频向量。
权益、国债水平/斜率/曲率、信用利差、USD/CNH、美国实际利率、黄金和商品分别保留 decimal return 或
bp change 单位；信用使用三条中债 5Y 曲线同日精确相减，商品使用 CU/SC/M 完整等权连续收益。
2018-03-26 至 2026-07-30 的 2,026 个候选 SSE 交易日中有 1,938 个九因子完整向量（95.66%），
九条最新水位均到 2026-07-30，readiness 审计 PASS。

估计器使用 252 日滚动多元回归（最低 120 日）和 60 日半衰期 EWMA 因子协方差，输出原始单位 beta、
模型解释度、组合实际 EWMA 年化波动、逐因子年化方差贡献与贡献份额。标准化只服务 QR 数值求解，报告
系数会还原成 return/return 或 return/bp；缺完整向量不填 0，秩不足则不生成 Market Risk 段。
本提交仍不把市场风险驱动注册成可发布 Alpha，也不把风险贡献接入策略调仓；后续 Alpha/Risk 重合、
情景和 Strategy Lab 都复用本协议。

**2026-08-11 Phase 5 五轴宏观风险模型：**原有增长—通胀四象限继续服务 `Macro Regime` 条件收益研究，
不改变既有报告；组合风险侧另建增长、通胀、流动性、信用和外部压力五个连续 `Macro Risk Axis`。
增长沿用 PMI，通胀沿用 CPI/PPI；流动性使用 M1/M2 同比和反向 Shibor 3M；信用使用社融存量同比及
社融当月增量同比，避免把有趋势的存量和强季节性的月流量直接标准化；外部压力使用美国名义/实际
10Y 利率和 USD/CNH，数值越高表示外部金融条件压力越大。每个原始组件分别用 60 个月窗口、至少
24 个月历史计算水平与 3 个月动量 z-score，截断在 ±3；任一冻结组件缺失时整轴缺失，不随时间偷换
成分，也不补 0。

组合敏感度使用五轴状态分数的月度变化，而不是把状态水平塞进日频协方差。估计器采用 60 个完整月
（最低 36 月）的多元回归，并对系数输出自动滞后的 Newey-West t 值；它是同期风险解释，不是宏观
因果或下一期收益预测。2018-03 至 2026-07 的最终值探索口径得到 92 个五轴完整变化月，增长/通胀/
流动性/信用/外部轴分别有 101/101/101/92/101 个变化月，最新完整月为 2026-07。以沪深 300 月收益做
真实链路校验可生成 60 月、lag=3 的完整报告。由于全部国内历史宏观值首次捕获于 2026-08，截止
2026-07 的严格 `as_available` 完整月仍为 0；审计明确 WARN，探索报告携带 6,615 条未来 vintage 并
保持不可发布，绝不伪造历史 PIT。

**2026-08-11 Phase 5 Alpha/Risk 重合诊断：**重合诊断不把 Alpha 的原始 score 与不同单位的风险驱动
硬做相关，而是复用不可变横截面/Panel 报告已经保存的费后多空逐期收益。每个形成日—目标日区间先
整体平移到严格下一 SSE 可得边界，再把同期日频风险驱动聚合到相同周期：收益类复利，bp change 类
累加。每条市场风险驱动独立做 Pearson 相关，至少需要 24 个有效周期；缺数据则该项不输出，不把缺失
解释为低重合。绝对相关低于 0.2、0.2–0.5、不低于 0.5 分别标记 `low`、`material`、`dominant`，负相关
同样可能代表实质对冲暴露。报告同时冻结 `net_long_short` 或 `strategy_attributed` 收益流来源；低相关
只表示没有明显线性风险换皮，不证明 Alpha 因果成立。

真实验收复用冻结的 `cross_asset_momentum_120` Panel 报告，在 2015-08 至 2024-12 得到 113 个费后
多空周期。权益、国债水平/斜率/曲率、信用、USD/CNH、美国实际利率和黄金均有 113 个有效配对，商品
因覆盖较短有 82 个；九项绝对相关均低于 0.12，当前全部归为 `low`。这只是管线验收和该冻结报告的
描述性诊断，不据此提高因子准入结论。时间序列 Alpha 没有单一的报告级多空收益流，后续由 Strategy
Lab 使用实际策略归因流并显式标记 `strategy_attributed`，不从逐资产汇总指标伪造。

**2026-08-11 Phase 5 线性风险情景：**情景引擎只消费已估计的九因子组合 exposure，并使用
`estimated impact = Σ(beta_i × shock_i)`；它不重新估 beta、不模拟价格路径，也不把结果称为预测。
首版冻结 8 个确定性情景：A 股 -10%、国债收益率 ±50bp、信用利差 +50bp、USD/CNH +5%、美国实际
利率 +50bp、商品 -10%，以及同时冲击权益/国债/信用/汇率/实际利率/黄金/商品的 risk-off。shock 单位
必须与 exposure 严格匹配，return 与 bp 不能隐式换算；输入 lineage 非 PIT 时整组不输出。

历史情景使用当前 exposure 乘以历史窗口内的真实累计市场驱动，收益类复利、bp change 类累加，并在
结果中保留原始窗口；任一驱动的有效日少于该窗口最完整驱动的 80% 时，整段不输出。V1 冻结
2018-06-01–2018-10-31、2020-01-02–2020-03-31 和
2022-01-04–2022-10-31 三个 availability-aligned 窗口。以沪深 300 自身作组合的真实金标准得到
权益 beta=1；A 股 -10% 与 risk-off 的估计冲击均为 -10%，三段历史权益 shock/估计冲击分别为
-16.47%、-9.98%、-28.04%，其余因子贡献为数值零，验证单位、符号与累计规则闭合。历史复现说明
“若当前 exposure 遭遇同样因子变化”的线性近似，不代表事件会重演，也不包含 beta 变化、流动性和
二阶定价效应。

**2026-08-09 Phase 5 宏观底座启动：**第一批先实现制造业 PMI、CPI 同比和 PPI 同比的规范系列目录、
观测长表、发布日历与本地 vintage 积累。官方日历只覆盖 2026 年起的发布事件；更早观测使用显式保守
滞后，`releaseDate` 保持为空。历史首次回填统一标记 `latest_value_backfill`，不得在严格 PIT 研究中
伪装为实时 vintage。当前完成的是数据契约、同步、bootstrap 和质量审计，还没有把最终修订历史值接入
宏观状态 evaluator；下一步以明确 revision policy 的 as-of loader 和未来函数测试作为进入 Macro Regime
报告的硬门槛。

宏观 as-of loader 随后已实现 `as_available` 与 `latest_vintage` 两条显式路径。前者同时按可得日和本地
捕获日门控，是真实 PIT 回测的默认且唯一可发布口径；后者允许用最终值历史做信号发现，但报告必须披露
读取的未来 revision 和 `latest_value_backfill` 数量，且不能据此通过发布门。这个区分保留了长历史探索
能力，也避免把“按发布日期滞后最终值”错误命名为实时 vintage 回测。

**2026-08-09 Macro Regime 连续分数 V1：**首个状态模型不把三个宏观值直接硬编码成仓位。增长轴使用
制造业 PMI，通胀轴使用 CPI/PPI 同比；每条系列分别保留水平与 3 个月变化，使用决策日可见历史的
60 个月滚动总体标准差进行 z-score（至少 24 个月，单项截断在 ±3），再等权合成连续轴。四象限仅按
增长轴与通胀轴正负提供“偏强/偏弱、偏高/偏低”的解释标签，报告仍须展示连续值、原始值、最新观察期
和 revision disclosure，不把标签本身当成交易算法。

真实月末探索口径从 2007-01 至 2026-07 得到 235 个可评分月份，最初 24 个月因训练窗不足明确跳过；
截至 2026-08-09 的增长分数为 -0.64、通胀分数为 +0.67，对应“增长偏弱 / 通胀偏高”。同一结果在
`latest_vintage` 历史探索中披露 775 条未来 revision，因此不具 PIT 发布资格；严格 `as_available`
历史在本地首次捕获前返回空，2026-08-09 当日状态点则不含未来 vintage。下一步才是把状态历史与目标
ETF 的未来收益、风险、持续时间和切换频率组合成 Macro Regime Report，而不是直接接入策略权重。

**2026-08-10 Macro Regime Report 后端金标准：**已实现月末状态与目标 ETF 固定交易日 horizon 的后复权
收益对齐，以及纯统计 evaluator。报告按四种状态分别输出样本数、均值、中位数、波动、正收益比例、
10%/90% 分位数和 Newey-West 均值 t 值；同时输出状态频率、连续阶段数、平均/最长持续期、切换次数，
并用前一期状态重新分组给出 lag sensitivity。ETF 在决策日或目标日缺少真实行情时该资产观察缺失，不用
前值制造零收益。每个报告冻结 `featureAvailableDate`、`latestVintageDate`、revision policy 与未来 vintage
数量，状态点、收益观察和目标日期任一不一致即拒绝计算。

真实后端验收使用沪深300、5年国债、黄金和豆粕 ETF，2020-01 至 2026-06 共得到 78 个状态月、310 个
资产观察和 32 次状态切换。同期与滞后分组在部分资产上方向不同，证明 lag sensitivity 不能省略；该结果
使用 `latest_vintage` 并披露 772 条未来 revision，只是探索证据，不具 PIT 发布资格。

**2026-08-10 worker/API 接线：**统一 `/factor/analysis/run` 已可用稳定 key
`china_growth_inflation_regime_v1` 运行冻结的中国增长—通胀四象限模型。API 在创建报告前冻结宏观与目标
ETF 的数据截止日，worker 复用上述 as-of loader 和 evaluator，完成结果通过统一的分型
`researchPayload.analysisKind = macro_regime` 返回。真实 API/worker 运行再次得到 78 个状态月、310 个资产
观察、32 次切换和 772 条未来 revision。发布服务同时增加双重门禁：spec 必须是 `as_available`，payload
还必须证明 `pointInTimeEligible = true` 且 `futureVintageRows = 0`；`latest_vintage` 报告不能发布。

当前只开放冻结的内置模型，不伪造尚未实现的自定义宏观 DSL，也不把状态直接接入策略权重。

**2026-08-10 Macro Regime 研究工作台：**Factor 因子库新增独立的“宏观状态模型”分组，首个冻结模型以
只读定义呈现；参数面板显式选择条件收益 ETF、预测周期、研究区间和 `as_available` / `latest_vintage`
修订口径。报告以四象限为主体，展示状态频率与持续期、各资产同期条件收益、Newey-West t 值、正收益
比例及滞后一期敏感性，不显示发布或“用于策略 Lab”动作。首次真实浏览器运行覆盖 2015-01 至 2025-01，
得到 121 个有效月份、425 条资产观察和 40 次状态切换；720 条未来 revision 在报告顶部明确警告并保持
探索不可发布。验收截图见
[`apps/web/acceptance/macro-regime-report.png`](../../apps/web/acceptance/macro-regime-report.png)。

真实浏览器验收同时发现并修复了多源截止日语义：宏观 `vintageDate` 是采集/修订日期，ETF `tradeDate`
是市场发生日期，不能把两者的最新日期取最小值当作“共同交易日”，否则会错误裁掉合法的最终值宏观
快照。报告现在冻结到各源已观察日期的最大值，各 loader 仍分别执行自身的 available-date、目标 horizon
和行情存在性约束。

宏观 holdout 与自定义模型发布继续留到具备足够本地 vintage 历史后；状态到目标权重、调仓和风险约束
仍应在策略回测中单独冻结与验证，不在状态研究报告里偷渡成交易结论。

**2026-08-10 Commodity Carry V1 数据与特征底座：**商品线从真实交割月合约启动，不从主力连续价格反推
期限结构。首批固定 AU 黄金、CU 铜、SC 原油、M 豆粕，分别对应现有黄金、有色、能化和豆粕 ETF；
底层 `FutureContract` / `FutureDaily` 可同时保存股指与商品合约，但交易引擎仍只读取乘数完整的
IF/IH/IC/IM，商品保持研究只读。Tushare 对四类商品合约的 `multiplier` 实际均返回空，因此 schema
忠实保存为 nullable，不硬编码或伪造合约乘数；Carry 计算不依赖该字段。

V1 每日只使用当日结算价、成交量、持仓量和合约最后交割日：剔除距离交割不足 10 个自然日或无成交/
持仓的合约，按交割日选择最近两个不同月份，并定义
`annualizedLogCarry = ln(F_near / F_far) × 365 / expiryGapDays`。正值表示 backwardation，负值表示
contango；近月合约变化单独标记 `nearContractChanged`，不拼接价格、不把换月价差冒充资产收益。未来日期
新增的合约行情不会改变已生成的历史曲线点。期货结算价在当日收盘后才能确定，因此 `asOfDate` 保留期货
交易日，`availableDate` 固定为其后的下一上交所交易日；研究只能在该日及以后读取特征。缺少下一交易日
日历时直接失败，不回退到同日可用。已有 fixture 同时固定这两条 PIT 边界。

真实小窗口同步覆盖 2026-07-01 至 2026-08-07：保存 934 个历史合约元数据和 1,344 条窗口日线，四个
品种各形成 28 个 Carry 点，并各观察到一次近月切换；同期 AU 以 contango 为主、CU 以 backwardation
为主，SC 两种状态均有出现。

**2026-08-10 Commodity Carry Panel V1：**Factor V2 字段目录新增
`commodity.futures.annualizedLogCarry`，首个受控模板在共同月末横向比较 AU/CU/SC/M，并分别把结果映射
到黄金、有色、能化和豆粕 ETF 的未来总收益。期货实际合约只提供特征，ETF 只提供收益目标；两者不混成
一条伪连续收益。黄金和豆粕接近单品种代理，有色与能化 ETF 并非铜、原油的一一对应敞口，报告必须披露
类别基差，不能把代理收益解释成对应期货收益。特征必须在月末已经可得，超过 7 个自然日未更新即丢弃；ETF 决策日、目标日和 20 日
波动均要求真实行情，API 截止日同时受四个 ETF 与四个期货品种的本地水位约束。

产品继续复用 `analysisKind=panel` 的 Rank IC、ICIR、命中率、换手和成本后多空报告，但参数池只显示四个
商品 ETF，并将方法命名为“Panel 横截面”，避免把研究方法误写成资产类别。该模板不暴露 `strategyKey`、
不进入 Panel Composite，也不显示发布/Lab 动作；自定义定义与发布服务均拒绝该研究专用输入，直到策略
运行时、日常数据维护和可交易性另行验收。同一 Carry 的单品种时间序列纵切见下段；两类研究均不代表
已经开放商品期货下单、连续收益或策略权重。

真实历史同步覆盖 2015-01 至 2025-07 的 469 个重叠合约，共落库 107,385 条日线；真实浏览器从工作台
运行 2015-01 至探索截止 2025-01-27 的报告，得到 294 条观测和 59 个满足最少资产数的共同月份，平均
Rank IC 0.019、年化 ICIR 0.13，10bp 单边成本后的多空年化为 5.10%。弱排序相关、有限月份和正的组合
结果并不构成一致证据，产品因此只陈述候选排序结果，没有把样本内组合收益包装为可交易结论。可重复验收脚本为
`apps/web/e2e/commodity-carry-panel.mjs`，截图见
[`apps/web/acceptance/commodity-carry-panel-report.png`](../../apps/web/acceptance/commodity-carry-panel-report.png)。

**2026-08-10 Commodity Carry 时间序列 V1：**同一受控字段新增独立
`analysisKind=time_series` 模板，逐品种检验 AU/CU/SC/M 在下一交易日可得的实际合约 Carry 与各自映射代理
ETF 未来收益的关系，不做商品间排序。装载器把最近可得 Carry 对齐到 ETF 交易日，最多允许 7 个自然日
陈旧度，并分别冻结特征可得日、ETF 目标日和期货/ETF 共同数据截止；Newey-West 自动滞后至少覆盖 20 日
重叠预测目标。时间序列任务会按定义输入选择期货 Carry 或 ETF/国债数据装载器，受控字段仍不能进入
自定义定义、发布、策略 Lab、每日信号或 Factor Weather。

真实浏览器从 2015-01-01 运行至探索截止 2025-01-27，共得到 2,428 个有效交易日和 6,069 条逐资产
观测。AU、M、CU 代理的相关性分别为 0.079、0.109、0.129，Newey-West t 分别为 2.28、1.48、
1.56；SC/能化代理相关性为 -0.113，t 为 -2.00。AU 与 SC 的单项统计量越过常用双侧 5% 阈值，
但四个代理方向不一致，又同时存在多重检验、样本内探索和类别代理误差，因此当前只形成“值得冻结
holdout 继续验证”的分品种证据，不能与 Panel 结果合并包装成可交易结论。可重复验收脚本为
`apps/web/e2e/commodity-carry-time-series.mjs`；截图见
[`apps/web/acceptance/commodity-carry-time-series-config.png`](../../apps/web/acceptance/commodity-carry-time-series-config.png)
和
[`apps/web/acceptance/commodity-carry-time-series-report.png`](../../apps/web/acceptance/commodity-carry-time-series-report.png)。

**2026-08-10 Commodity Warehouse Receipt 数据层 V1：**Phase 5 已继续接入 Tushare
[仓单日报 `fut_wsr`](https://tushare.pro/document/2?doc_id=140)，但本批只冻结可信原始数据，不提前包装
成库存 Factor。`CommodityWarehouseReceipt` 按 AU/CU/SC/M 与日期保存物理仓库总量、上游变化量、原始
单位、来源行数、下一上交所交易日可得日和采集时间；CLI 按月分页，bootstrap 在覆盖不足时从 2015 年
回填。上游满 1,000 行会继续 offset，重复整页、日期越界、单位漂移或缺失下一交易日均 fail closed。

聚合前必须按精确 `fut_name` 隔离品种并删除“合计/总计/小计”行。真实接口证明 CU 查询会混入
`铜(BC)`；更重要的是 SC 同一天的物理仓库会同时使用桶和吨，缺少密度/品级时不能可靠换算。因此表按
“品种 × 日期 × 单位”分层，SC 两种序列不相加；AU 千克、CU 吨、M 手保持各自单一单位，也不跨单位比较
绝对库存。

完整真实回填覆盖 2015-01-05 至 2026-08-07，共得到 11,158 条单位分层日聚合：AU/CU/M 分别为
2,796/2,816/2,697 条，SC 为 1,868 条桶序列与 981 条吨序列。AU 另有 17 个确定日期把千克错标成吨；
代码只对精确审计清单修正，并同时保存上游 `sourceUnit` 与修正标志。全量数据的可得日均晚于报告日且为
上交所开市日。

**2026-08-10 仓单 maintenance 与 audit 完成：**生产 daily maintenance 每次重拉最近 20 个上交所交易日，
正常数据发布和 signal-only retry 都覆盖；repair 则在整段修复完成后只执行一次，避免重复请求。可得日不晚于报告日、
非交易日、品种名/单位漂移、无来源行或未登记的单位修正都会 fail closed；最新品种水位落后 1–3 个交易日产生
warning，超过 3 日则为 error。同一 finding 已进入 `audit:data` 与 weekly maintenance。真实 20 交易日增量验证共重新聚合
77 条，AU/CU/SC/M 均更新至 2026-08-07，对应可得日 2026-08-10，质量结果为 pass。

**2026-08-10 Commodity Warehouse Receipt 时间序列观测 V1：**Factor V2 新增研究专用原始字段
`commodity.warehouseReceipt.volume`，并由专用 loader 把 AU/CU/M 仓单按 `availableDate` point-in-time 对齐到
各自代理 ETF。loader 只提供原始 level、最多允许 7 个自然日陈旧度并生成未来 ETF 收益目标；冻结的 Factor
代码负责计算
`pressure20(t) = log1p(W_asof(t-20 个 ETF 交易观测)) - log1p(W_asof(t))`，因此“原始数据如何变成
Factor 分数”仍由 Factor 定义表达。零仓单通过 `log1p` 保持有限值，未来发布的数据不会回写更早得分，单位漂移
和 SC 代理都会 fail closed。

该输入仍受研究边界保护：自定义定义、发布、策略消费与每日信号均不能引用。探索样本固定为 2015-01-05 至
2025-01-27，AU/CU/M 分别得到 2,408/1,196/1,209 条观测；`pressure20` 与未来 20 个交易日 ETF 收益的
相关性为 0.017/-0.125/0.049，Newey-West t 为 0.25/-1.44/1.08，命中率为 0.490/0.515/0.522。
方向与强度均不构成一致证据，所以不开放交易消费，也不根据探索结果修改公式；2025-01-28 起的冻结 holdout
保持未查看。

**2026-08-11 Commodity Warehouse Receipt 研究产品收口：**受控模板现在通过通用
`allowedAssets` / `defaultAssets` / `unavailableAssetReasons` 元数据只允许并默认选择 AU/CU/M；SC 仍在设置中
可见，但会解释吨/桶口径不可审计且不能选中。该能力属于研究定义的适用范围，不等于策略可交易 Universe。
API 对模板资产做同样的硬校验，并以所选 ETF 最新行情、所需仓单品种最新 `availableDate` 的共同最早值冻结
`dataCutoff`，从而使前端默认值、直接 API 调用和不可变报告保持同一研究边界。研究专用模板没有
`strategyKey`，报告不显示发布或进入策略 Lab 的动作。

真实浏览器重新运行 2015-01-05 至探索截止 2025-01-27，结果与冻结观测一致：2,408 个有效时期、4,813 条
观测，AU/CU/M 分别为 2,408/1,196/1,209 条；相关性为 0.017/-0.125/0.049，Newey-West t 为
0.25/-1.44/1.08。SC 的直接 API 请求返回 400，2025-01-28 起的 holdout 未打开。可重复验收脚本为
`apps/web/e2e/commodity-warehouse-receipt-time-series.mjs`；配置与报告截图见
[`apps/web/acceptance/commodity-warehouse-receipt-config.png`](../../apps/web/acceptance/commodity-warehouse-receipt-config.png)
和
[`apps/web/acceptance/commodity-warehouse-receipt-report.png`](../../apps/web/acceptance/commodity-warehouse-receipt-report.png)。
5/60 日变化、标准分、仓单 Panel 和持仓因子继续后置，只有预先登记的新假设才能使用冻结 holdout。

随后单独建设风险因子与组合归因：

- 久期、曲线、信用、权益 beta、通胀、美元和商品风险暴露；
- 因子收益归因、风险贡献和情景冲击；
- Alpha Factor 与 Risk Factor 的重合检查。

**验收门：**商品连续收益能解释换月规则；宏观研究能够证明每个观察值在决策日真实可得；风险归因
不被包装成收益预测结论。

### 建议项目拆分

| 里程碑 | 包含阶段 | 用户可见结果 | 相对工作量 | 关键依赖 |
|---|---|---|---|---|
| A：Factor V2 骨架 | Phase 0–1 | 统一报告骨架、不可变已发布 Factor、老股票因子零回归 | L | 现有 Factor/Report |
| B：首个端到端闭环 | Phase 2–3 | 时间序列因子可研究、发布并进入策略和今日信号 | XL | ETF 日线；债券曲线用于第二个样例 |
| C：多资产配置 | Phase 4 | 股票/债券/黄金/商品 ETF 的 panel 因子和配置报告 | XL | 代理池、统一资产分类、数据覆盖 |
| D：专业固收商品与宏观 | Phase 5 | Carry、库存、宏观状态、风险暴露和归因 | 持续演进 | 曲线、实际合约、仓单、PIT 宏观 |

Factor V2 MVP 建议以里程碑 B 为交付边界。只完成 A 会得到漂亮的新架构但没有新增研究能力；完成 B 后，
用户已经能走通“发现时间序列因子 → 样本外验证 → 发布 → ETF 策略 → 每日交易信号”，可以独立产生
产品价值，再决定是否投入 C 和 D。

## 10. 发布门槛

所有 Factor 发布至少满足：

1. 有冻结的因子定义、数据字段和 PIT 规则；
2. 有预先填写的假设、经济逻辑、预期方向和主要判据；
3. explore 报告完成且样本数量达到协议最低要求；
4. `experimental` 可以只有 explore 证据；升级为 `validated` 必须完成并通过正式 holdout；
5. `production` 还必须通过回测/每日信号求值一致性、数据日常维护和成本可交易性验收；
6. 报告包含成本或明确说明该协议为什么不适用成本；
7. 无已知未来泄漏、幸存者偏差或不可解释的数据修订；
8. 发布时在 Factor 上冻结代码、组合定义、方法、horizon、数据依赖和批准报告。

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

- 发布后的 Factor 不可变，归档后不能进入新部署；
- 修改已发布研究通过“复制”为新的独立草稿，key 自动建议 `_v2`、`_v3`；
- 回测与隔离 worker 的信号逐位一致；
- 回测与每日信号在相同数据截止日产生相同预测；
- E2E 覆盖“研究 → 发布 → 策略引用 → 回测 → 部署 → 今日信号”全链路。

## 12. 迁移策略

1. `/factors`、factor key、老 report ID 和分享 URL 保持稳定；
2. 历史报告只在读取层适配为 cross-sectional，不批量改 payload；
3. 现有内置和用户因子默认 `domain = equity`、`outputScope = asset`；
4. `FactorComposite` V1 保持股票横截面语义，新 panel 组合使用新 definition version；
5. `ctx.factor()` 至少跨越 Phase 3 保持兼容；
6. 策略只引用 published `Factor.key`，不保留其他身份语法；
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
3. 因子可发布为不可变实体，策略可显式引用唯一 `Factor.key`；
4. 回测、部署和每日交易信号能追溯到同一 Factor、批准报告、代码 hash 和预测输入；
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

### 14.3 2026-08-11 收口状态

Factor V2 MVP（Phase 0–3）与 Multi-Asset V1（Phase 4）按上述完成定义冻结为已完成。最终回归同时覆盖：

- 商品 Carry 时间序列研究；
- 国债曲线 Factor 到策略回测、部署和每日信号；
- 跨资产 Panel 合成、策略引用、成交及收益/风险归因；
- 仓单压力研究的资产适用范围、共同数据截止、报告与研究/交易隔离。

这次收口不把已探索的 Phase 5 数据切片解释为 Phase 5 完成。5/60 日仓单变体、仓单 Panel、会员持仓、
信用与风险因子、完整宏观状态、校准后的 Factor Signal，以及商品/国债期货交易能力，均留待下一轮重新
确认优先级和验收标准；它们不再反向扩大 Factor V2 MVP 的完成边界。
