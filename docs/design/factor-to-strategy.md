# 设计:因子线(研究方法论 · 分析深化 · 历史窗口 → 因子→策略接入 → 合成)

> 2026-07-06 设计,对应 `ROADMAP.md` 主线三。目标:打通「因子页验证 edge → 策略里直接使用」的闭环,并把个人研究者的方法论纪律固化进工具。
> 前置知识:因子数据模型定论 ——**存报告、不存值;因子=函数现场算**(FactorValue 表已删,报告入 `FactorReport`)。

## 现状(2026-07-06)

- 预置因子 9 个(mom/rev/vol 价格派生 + ep/bp/dv/size 基本面 + mf_net_main/total 资金流),分析时现场算。
- 自定义因子(方案 A,已完成):`defineFactor({ name, compute(bar) })`,`bar` = `FactorBar`(当天单股横截面:pe/pb/ps/dv/totalMv/circMv/turnoverRate 等,来自 daily_basic)。**没有价格历史** → 写不了自定义动量/波动率。
- 策略侧 `ctx.factor(key)`:只支持预置 key(读 Moneyflow 表等),as-of 前填**一刀切**——对 moneyflow(流量数据)语义是错的(与其「当日缺则 null」的文档、与 `ctx.lhbNet` 的精确当天行为不自洽)。
- `compileFactor` 复用 `compileStrategy` 沙箱(esbuild 剥类型 + new Function + 禁 require)。

---

> **2026-07-06 Step 1 + Step 1b 已于 2026-07-07 一次实施完成**(moneyflow-into-context 以 FactorBar
> 加 netMain/netTotal 形态提前落地,凑齐能力超集后 9 个预置一次代码化;builtin 用系统 userId 哨兵,
> 零 schema 迁移)。实况与验收见 `ROADMAP.md` 3.1/3.1b;本文保留为设计依据。

## Step 1 · 因子编写 B:历史窗口(ROADMAP 3.1)

### API

```ts
export default defineFactor({
  name: '20日动量',
  window: 20,                      // 声明所需历史长度(交易日),引擎据此预载
  compute(bar, ctx) {
    const closes = ctx.history(20); // 后复权收盘价,末位=当天,长度不足返回 []
    if (closes.length < 20) return null;      // null = 该股当期剔除
    return closes[19] / closes[0] - 1;
  },
});
```

- `ctx.history(n)`:**后复权收盘价窗口**(`close × adj_factor`),`[最旧 … 当天]`,与策略侧 `ctx.history` 同复权口径。v1 只给 close;high/low/vol 等字段等需求拉动再扩(`ctx.history(n, 'high')`)。
- `window` 是**声明属性**:分析器看到它才走「逐股加载价格序列」的慢路径;没有 `window` 的因子保持现有快路径(纯横截面,ep 级 ~6s)。**不做隐式检测**(运行时才发现要历史 → 无法批量预载,性能崩)。
- `compute` 返回 `null`/抛错 → 该股当期剔除(沿用现有 custom 分支行为)。

### 实现要点

- `computeFactorSeries` custom 分支:若因子声明 `window`,复用预置价格因子(mom/rev/vol)已有的逐股价格加载路径(分块 300/批),按调仓日切窗口喂 `ctx.history`。
- 性能预期与预置价格因子同级(月度全区间 ~2 分钟级,报告缓存后秒开)——已有流式日志/worker/Job 管道,无新工程。
- 类型:`FactorCtx` 进因子 dts(Monaco 补全)与 `defineFactor` 运行时,`compileFactor` 无需改(沙箱边界不变)。

### 验收

自定义「20日动量」因子分析结果与预置 `mom`(同参数)IC/分层一致;无 `window` 的既有因子路径零回归(速度不变)。

---

## Step 1b · 统一预置与自定义因子(预置代码化,2026-07-06 用户提)

**命题**:预置因子不应是内置黑箱,而应和自定义因子**同一机制**——也是库里的一行代码、走同一条 `compileFactor + compute` 路径运行,只是标记为**只读不可改**。这是 code-first(代码即唯一真相)在因子侧的贯彻。

### 为什么现在不能直接做:能力前置

`computeFactorSeries` 现有 4 条岔路,预置分三类,只有一类今天能表达成 `compute` 代码:

| 类 | 预置 | 现算法 | 能否写成 `compute`? |
|---|---|---|---|
| fundamental | ep/bp/dv/size | 纯 daily_basic 函数 | ✅ 现在就能(`compute:(bar)=>1/bar.peTtm`,与自定义一字不差) |
| price | mom/rev/vol | 逐股价格窗口函数 | ❌ 需 **Step 1 的 `ctx.history`** |
| moneyflow | mf_net_main/total | 读 Moneyflow 表 | ❌ compute 拿不到 moneyflow,需 moneyflow-into-context(见 Step 2 注册表) |

**所以:只迁基本面 4 个 = 1.5 套机制**(价格/资金流仍硬编码),比「两套干净」和「一套干净」都糟。**正确姿势 = 当作因子闭环的收口一次做完**:等 `compute(bar, ctx)` 的能力成为**所有预置所需的超集**(Step 1 的 history + moneyflow-into-context 落地后),一次性把 9 个预置全迁成只读代码行,删掉 `factors.ts` 的 `FACTORS`/`FUNDAMENTAL_FACTORS` 注册表 + `computeFactorSeries` 的 3 条硬编码分支 → **compute 只剩一条路径**。

### 收益:fork 预置成变体(顺带兑现研究路径②)

预置变成**可读代码**后,「一键复制为自定义 → 改参数」即可:把「动量 60/5」fork 成「动量 120/10」变体——这正是本文档方法论**路径②「A 股变体」**的操作形态。现在预置是黑箱 TS,用户看不到也 fork 不了。**这个 UX 收益单独就值得做**,是统一机制最直接的用户价值。

### 三个必须钉死的设计点

1. **key / 缓存稳定性**:预置现在的 key 是 `ep`/`mom`(URL `?factor=`、`FactorReport` 缓存键都用它)。迁成 `Factor` 行后 id **必须仍是这些稳定 slug**,否则老报告全 orphan、分享链接全断。→ 预置用**固定 slug**(`ep`/`mom`…),不用 ULID;自定义继续用 ULID。
2. **只读强制**:`Factor` 行加 `builtin Boolean @default(false)`(或系统 `userId`);`/custom/:id` 的改/删路由对 `builtin` 行拒绝(明确报错,不静默)。目录里仍标 `kind`(preset 语义),只是 `source` 变代码。fork 时把 builtin 的 code 复制进一行新的可改自定义因子(新 ULID、当前 userId)。
3. **seed 机制**:预置代码在**仓库里**编写(`.ts`,能 type-check),经幂等 `upsert`(按固定 slug)注入库,每次 deploy 保证存在。**真相仍在 git**,DB 只是物化——与现在对待自定义因子一致。价格/moneyflow 预置的 `compute` 用到 `ctx.history`/moneyflow-into-context,依赖 Step 1 + Step 2 的上下文能力。

### 一处代价(非 blocker)

基本面走硬编码原生函数(`fundFn(r)`)比走编译沙箱 `compute()` 略快:ep 全市场月度 ~5000 股 ×~130 期 ≈ 65 万次 sandbox 调用。自定义分支已这么跑、实测可接受,但迁完 ep 会比现在慢几秒(缓存后秒开,可忽略)。

### 验收

- 9 个预置全部从 `Factor` 表(builtin 行)读代码运行,`factors.ts` 的两个注册表 + 3 条硬编码分支删除,`computeFactorSeries` 只剩一条 compile+compute 路径。
- 迁移前后同因子同参数 IC/分层逐位一致;老 `FactorReport` 缓存(按 `ep`/`mom` 键)不 orphan。
- builtin 因子在 UI 只读(改/删被拒),但可「复制为自定义」得到可改副本。

---

## Step 2 · 因子→策略接入(ROADMAP 3.2,闭环关键)

### 核心设计:因子注册表 + 时间语义声明

**时间语义是因子的声明属性,不是调用参数。** `ctx.factor(key)` 永远无 date 参数(ctx 恒为「今天」,防未来函数);但 as-of 行为按因子声明走:

```ts
interface FactorDef {
  key: string;                 // 'mf_net_main' | 'custom:<factorId>' | …
  label: string;               // 中文名(UI/日志)
  kind: 'flow' | 'level';      // 流量=精确当天、缺则 null、不前填;存量=as-of 往前填
  freq: 'daily' | 'monthly';   // 数据固有频率(决定 as-of 回看上限)
  source: 'column' | 'derived' | 'custom'; // 读表列 / 价格现场算 / 用户代码
}
```

- **flow(流量)**:moneyflow、龙虎榜——「昨天净流入」不能当「今天净流入」用。精确当天,当日无数据返 null。
- **level(存量)**:估值、财务、月度因子——「最近一期已公布的值」语义正确。as-of 前填(回看上限按 freq,如 monthly 回看 ≤35 天)。
- **顺手修 bug**:现在 `ctx.factor('mf_net_main')` 被一刀切 as-of 前填,按上表改为 flow 精确当天,与 `ctx.lhbNet` 一致。这是行为变更,改完跑一次用到 moneyflow 的既有策略确认影响面。

### 自定义因子接入

- 策略声明 `factors: ['custom:<factorId>']`(沿用现有 factors 数组作为统一读取口)→ 引擎 worker 启动时按 id 加载 Factor 表代码、`compileFactor` 编译一次。
- **现场算零存储**:`ctx.factor('custom:x')` 对当天该股跑 `compute`;声明了 `window` 的因子,复用策略侧已有的 bars 缓存(策略要用该因子的股票本就 `ensureBars` 过)。
- **贵且反复用的才惰性物化**:per-run 内存 LRU(有界,比如 10 万值),**不落库**。真到撑不住再谈 DuckDB/Parquet(见数据模型定论,别提前)。
- 权限:只能引用自己 userId 的因子;策略保存时校验因子存在,跑时因子被删 → 明确报错(不静默 null)。

### DX:key 自动生成 dts

因子注册表(预置 + 该用户自定义)生成字符串字面量联合类型 + JSDoc:

```ts
/** 主力净流入(万元)· flow·daily · 当日无数据返回 null */
type FactorKey = 'mf_net_main' | 'mf_net_total' | 'custom:01H…' | …
```

注入 Monaco dts(自定义因子部分按用户动态拼)+ codegen prompt(LLM 知道有哪些因子可用)。**依赖 ROADMAP 4.4(SDK 单一来源)先行**则最省,否则先只生成 dts、prompt 手动同步。

### 与因子分析的关系(勿混)

- **策略里的 factor ≠ 因子分析**:日级策略要「当天」值 → 现场算(像 `ctx.sma`,永远新鲜);因子分析要「全市场月末」截面 → 走 analyzeFactor 管道。两者共享因子定义(注册表/代码),**不共享计算路径**。

### 验收

- 因子页新建自定义因子 → 分析确认有 edge → lab 里 `ctx.factor('custom:…')` 直接用于打分选股,回测跑通。
- moneyflow flow 语义修正后,`ctx.factor('mf_net_main')` 当日无数据返 null(与文档一致)。
- Monaco 里 `ctx.factor(` 有全部 key 补全 + 中文 JSDoc。

---

## Step 3 · 多因子合成(ROADMAP 3.3,远期)

- 因子页加「组合因子」:选 2~5 个因子 + 权重(等权 / IC 加权二选一),每期截面先标准化(rank 或 zscore,rank 更稳)再加权合成 → 走现有 `analyzeFactor` 管道出同款报告(IC/分层/衰减)。
- **只进因子页不进引擎**:策略里要组合因子,用户代码自己拼(`0.5 * rankOf(ep) + 0.5 * rankOf(mom)`),平台不预设合成方式(中性工具原则)。
- 缓存键扩展:组合定义(因子列表+权重+标准化方式)序列化进 `FactorReport` key。
- 前置:Step 1/2 落地、用户在因子页积累了使用体感之后再动。

---

## 研究方法论:个人怎么研究因子(2026-07-06,ROADMAP 3.4~3.7 的依据)

**定位:验证者/实现者,不是发现者。** 发明新定价异象对个人不现实也不必要——产业界主业同样是验证、本地化、组合、控成本。因子发表后收益平均衰减过半(McLean & Pontiff, 2016),且许多在 A 股 T+1/涨跌停/散户结构下不成立;「在我的市场、我的股票池、我的成本下还活着吗」只有自己的引擎能回答,**这个回答本身就是研究**。

三条现实路径(工具逐条支撑):

1. **经典因子本地验证** → 3.5 预置因子库(菜单化,带出处与预期方向);
2. **A 股变体**:已知因子家族 × A 股特有数据(资金流/龙虎榜/涨停行为/换手拥挤)× 定义/参数变体。样板:微盘吃反转不吃动量(同框架追涨 −33% vs 接超跌 −7.7%,本平台实测)→ defineFactor + 3.1 历史窗口;
3. **假设驱动**:先有经济逻辑再检验(多重检验风险低一个量级)→ 3.6 台账让「挖了多少」可见。

组合(3.3/3.7)是研究的后半段,前提是筛出**彼此低相关、费后存活**的因子——所以 3.4 排在 3.3 前面。

## 下一批认领:分析深化(2026-07-08 与用户对比业界后排序)

> 对比结论:单因子检验管道已到 Alphalens 核心水准,AI 写因子/对话研究是独有项;**落后集中在
> 「中性化三件套」(聚宽/Qlib 标配)**——不中性化,A 股"新因子"多半是市值换皮,验证成色打折。
> 实施顺序拍定:**① 3.4 三件套(中性化/相关性矩阵/费后,~2-3 人日;`stats.linearRegression`
> 已备)→ ② FactorBar 接财务字段(见下)→ ③ 3.5 预置逐个过三道门(依赖①②)→ ④ 3.2 策略侧
> 接入 → ⑤ 3.6 台账(便宜,业界没有,与纪律哲学最搭)**。3.3/3.7 保持远期。

### 新设计点:FactorBar 财务字段(as-of 语义,3.5 质量因子的前置)✅(2026-07-08)

**已实现**:`FactorBar` 新增 `roe / grossprofitMargin / debtToAssets` 三列(PIT as-of),`analysis.ts`
`loadFinaIndex` 一次性预载 fina_indicator(annDate 非空,按 annDate 升序分组)+ 逐股 `finaAsOf` 二分
(镜像 `EngineData.roeAsOf`)。SDK dts 双语文档 + codegen prompt 字段表/能力边界同步(ROE/毛利率/负债率
不再是「无数据」,营收利润增速等仍在边界外)。实测 roe 因子 6 个月产 30607 个非空值。

fina_indicator 七列已落库(2026-07-07 波次一),因子 `compute` 的 bar 现可读到上述三列。这是 FactorBar
**第一类 as-of 前填字段**,与既有两类语义并列:

| 语义 | 字段 | 规则 |
|---|---|---|
| 当日快照 | pe/pb/…/turnoverRate | daily_basic 当日行,缺则 null |
| 流量(精确当日) | netMain/netTotal | moneyflow 当日行,**绝不前填** |
| **存量(as-of)** | roe/grossprofitMargin/… (新增) | **最近一份 annDate ≤ 当日的报告**,PIT 门控,90 天?回看上限待定 |

实现参照:引擎侧 `EngineData.roeAsOf`(annDate 二分)已是同款逻辑,factor 侧在 `loadBars` 的
截面装配处加一次 fina 预载 + 逐股二分;dts/prompt/SQL_TABLE_DOCS 同步(镜像规则见 CLAUDE.md)。
字段选择:v1 只上 roe + grossprofitMargin + debtToAssets(3.5 头三个因子所需),其余按需。

## 3.4 分析深化:中性化 + 相关性 + 费后

> 详设拍定 2026-07-08。三件事共享一个原则:**都是 `computeFactorSeries` 产出的截面序列之后的
> 纯函数变换/统计**,不碰因子计算路径(isolate 墙内不变),数学都进 `lib/stats.ts` + vitest。

### 市值/行业中性化

- **Why**:A 股小盘效应极强,因子值与市值普遍纠缠;不中性化,测出的「新因子」常是市值换皮(检验:该因子与 size 的截面相关高、中性化后 IC 消失)。市值加权视图只是缓解,残差化才是解决。
- **How**:每个调仓日,因子值对 `log(totalMv)`(+行业哑变量)做截面 OLS,**取残差作为中性化因子值**,后续 IC/分层/费后管道完全不变。实现为 `analyzeFactor` 里 `computeFactorSeries` 之后的一步逐日变换。
- **数学实现(FWL,免矩阵求逆)**:「市值+行业」= 因子值与 log 市值**各自行业内去均值**,再做一元回归取残差(Frisch–Waugh–Lovell 定理保证与完整多元 OLS 残差相同)——只需 `groupDemean` + 现有 `linearRegression`,不引矩阵库。「仅市值」= 直接一元回归取残差。
- **行业分类:申万一级(SW2021,31 个),以此为准**。前置需一次数据同步(2026-07-08 拍定):
  - 新表 `SwIndustryMember`(市场数据表,进 SQL 白名单):`tsCode / l1Code / l1Name / inDate / outDate(可空)`,主键 `tsCode|l1Code|inDate`。**只存申万一级层**(二/三级此需求用不上,不同步)。
  - 同步脚本 `scripts/sync-sw-industry.ts`:`index_member_all` 按 31 个 `l1_code` 逐个拉全成分(不加 `is_new` 过滤,要**全历史**含 `out_date`),幂等 `deleteMany`+`createMany`。数据量 ~1 万行,一次拉完。
  - **PIT 归属**:每个调仓日 D,某股行业 = 满足 `inDate ≤ D < (outDate || 今天)` 的那条 `l1Name`(股票换行业罕见但 in/out_date 让历史归属精确,非快照套历史)。实现为一次全表预载 + 逐股按 D 二分/线性选段(参照 `EngineData.roeAsOf` 的 as-of 手法)。
- **缺失处理**:缺 totalMv 或 totalMv≤0 的股票在中性化模式下**当期剔除**;查不到申万归属的股票(未上市成分/新股)归入 `unknown` 桶,该桶 <5 只时并入最大桶再去均值。
- **接口/缓存**:参数 `neutral: 'none' | 'size' | 'size_industry'`(默认 none),进 `reportId` + `jobKey` + `FactorReport` payload;UI 分析参数条第三个选择器。旧缓存报告 = neutral:none,键不变,天然兼容。
- **验收**:size 因子自身 `neutral=size` 后 IC≈0(自检);Amihud/换手类高市值相关因子中性化前后 IC 对比可见;vitest 覆盖 groupDemean/residualize 及「因子=log 市值时残差全零」。

### 因子相关性矩阵

- **Why**:组合(3.3/3.7)的前提是「彼此低相关」;与市值列的相关就是「换皮检测器」。
- **How**:选 2~8 个因子 + (freq, start, end) → 同一组调仓日各自 `computeFactorSeries`(复用,含 isolate 编译)→ 每个调仓日在**两两股票交集**上算 Spearman → 按日取均值(样本 <100 只的日剔除)→ 因子×因子对称矩阵。`log(totalMv)` 作为固定伪因子列「市值」永远加入(数据就在 rebalance snaps 里)。
- **架构**:新路由 `POST /factor/correlation/run`(worker job,同 analysis 的 jobId/日志模式);缓存新 Prisma model `FactorCorrelation`(id = hash(userId + sorted keys + freq + range),payload JSON)——不塞 `FactorReport`(payload 形状不同,且会污染 runs 列表)。
- **UI**:/factors 页新「相关性」tab:因子多选(预置+自定义混选)→ 热力图(echarts,红正蓝负,格内标数值)。
- **验收**:ep 与 bp 高相关、mom 与 rev 负相关(教科书关系);Amihud 与市值列强负相关。

### 费后视角

- **Why**:高换手因子(短反转/资金流)纸面 IC 好看,费后可能归零——这是「可交易性」的第一道闸。多空组合 A 股不可完整实现(融券受限),费后线的用途是**因子间比生存力**,不是照单交易。
- **How**:分层循环里补记**底仓 decile 的换手**(现只记 top);每期成本 = (top 换手 + bottom 换手) × 单股替换成本,替换成本 = 卖(佣金+印花+滑点)+ 买(佣金+滑点),默认佣金 2.5bp/边 + 印花 5bp 卖出 + 滑点 10bp/边 ≈ 30bp/次替换(常数配置于 analysis.ts,UI 脚注展示);首期建仓计双边买入成本。费后收益 = 名义多空收益 − 每期成本,等权/市值权两套都算。
- **报告扩展(可选字段,旧缓存兼容)**:`longShortNet` / `longShortNetMktcap`(费后 LongShortStat)+ `lsNav: { dates, gross[], net[] }`(逐期净值序列——现报告只有 navEnd,补上序列才画得出双线图)。
- **UI**:报告页新增多空净值折线图(echarts,lazy,费前/费后两条线)+ 费后指标行。
- **验收**:mf_net_main(高换手)费后显著缩水、ep(低换手)费后基本不动,两者排序可能反转——正是这个视角的意义。

### 实施顺序(一个 PR 一件事)

1. ✅ **中性化**(2026-07-08):stats.groupDemean/residualize + 申万一级 PIT 表 + 中性化贯通(API 参数→worker→UI 选择器→e2e)。commit `f8e325f`。
2. ✅ **费后**(2026-07-08):底仓 decile 换手 + `lsNav` 逐期净值序列 + 前端多空净值双线图 + 费后指标行。成本常数在 `analysis.ts`(往返 ≈ 30bp)。实测高换手因子费后大幅缩水(mf_net_main 8.76%→2.97%)。e2e 7d。
3. ✅ **相关性**(2026-07-08):新表 `FactorCorrelation` + worker(复用 computeFactorSeries)+ /factors 因子库 tab 触发的模态框(因子多选 + echarts 热力图,含固定「市值」列)。自检 ep~bp/dv 正、bp~市值 弱负。e2e 7e。

## 3.5 预置因子库扩充(经典因子菜单)

把「个人无法发明因子」翻成「一张可逐个本地检验的菜单」。每个预置因子带:定义、预期方向、一句出处、A 股注意事项。候选清单(按数据可得性排;**状态列 = 台账**,验证数字为 2015–2026 月度全区间,IC/ICIR(年化)/费后年化取「市值+行业中性化」口径除非注明):

| 因子 | 定义 | 预期方向 | 数据 | 状态 | 验证结果(中性化口径) |
|---|---|---|---|---|---|
| ROE 质量 | 最新已披露报告 ROE(annDate PIT) | 正 | fina_indicator ✓ | **已收录(2026-07-08)** | IC 0.0220 · ICIR 1.02 · IC>0 61% · 费后 3.15%/Sharpe 0.33;中性化后 ICIR 反升(0.77→1.02)=非市值换皮 |
| 毛利率 | 最新已披露报告毛利率(annDate PIT) | 正(质量) | fina_indicator ✓(wave-1) | **已收录(2026-07-08)** | 原始 IC 仅 0.008(行业结构掩盖)→ 行业中性后 0.0128 · ICIR 0.73 · 费后 2.89%/Sharpe 0.39——「毛利率必须行业中性看」实证 |
| 12-1 动量 | 过去12月剔近1月收益(window 245) | 学术正,A股弱/失效 | 已有 | **已收录(2026-07-08)** | IC −0.0044 · ICIR −0.16 · IC>0 50%——截面无信号;原始口径多空费后 4.88% 中性化后仅剩 1.19% = 几乎全是市值/行业暴露。「A股 12-1 动量失效」本地实证,收录价值即证伪示范 |
| 低波动 | 120日收益波动率(low-vol anomaly 周期) | 低波占优(IC 负) | 已有 | **已收录(2026-07-08)** | IC −0.0787 · ICIR −2.12 · IC>0 仅27% · 费后多空(做多高波口径)−17.65%/Sharpe −1.07;中性化后 ICIR 反增(−1.40→−2.12)——低波异象 A 股显著,非市值/行业换皮 |
| Amihud 非流动性 | \|日收益\|/成交额均值 | 高非流动溢价 | 需 ctx.history 扩 'amount' | 待 SDK | 与 size 高相关,必配中性化 |
| 换手率(拥挤) | 近N日换手均值 | 高换手负(彩票偏好) | 需 ctx.history 扩 'turnover' | 待 SDK | A 股散户特色,预期显著 |
| 应计 accruals | (净利−经营现金流)/资产 | 高应计负 | 需资产负债+现金流表 | 待数据 | 进 4.2 需求清单 |
| 北向持股变化 | 陆股通持股比例变动 | 正(聪明钱) | 需 hk_hold 同步 | 待数据 | 进 4.2 需求清单 |

- 实现:纯增量——注册表加条目 + 各自 source(column/derived),有数据的先上,缺数据的进 4.2 数据扩展的需求清单。
- **不做成「推荐」**:菜单只陈述文献结论,验证结论由用户自己的引擎给(中性工具原则)。

### 纳入机制:上百个因子怎么进系统(2026-07-06 用户问,拍定)

**不批量导入。** 学术界的 factor zoo(数百个已发表因子)三个特征决定了批量导入是错的:① **高度冗余**——数百个因子聚类后只有十几个主题(价值/动量/反转/低波/质量/投资/规模/流动性/换手·彩票/分红/应计/季节性…),同主题内互相是变体;② **多数复现失败**(Hou-Xue-Zhang 大规模复现:约半数在严格检验下消失),发表后又衰减过半;③ **相当部分依赖我们没有的数据**(分析师预期、日内微观结构、文本)。批量导入 = 把多重检验的坑批发进系统。

**正确姿势:按主题精选 + 三道门准入,菜单靠验证生长,不靠导入。**

1. **按主题不按论文**:每个主题先收 1 个代表性定义(上表 8 个候选就是这个逻辑),同主题变体等代表性因子验证出结果后再按需加。
2. **三道门,过完才升「预置因子」**:
   - 门一 · 数据可得:Tushare 现有表能算(缺数据 → 进 4.2 需求清单排队,不硬凑);
   - 门二 · A 股逻辑成立:经济逻辑在 T+1/涨跌停/散户结构下讲得通(讲不通的直接否决,省一次检验额度);
   - 门三 · 本地验证:中性化(3.4)后 IC/分层/费后过关 + 保留段(3.6)确认。
3. **台账记录一切**:被否决/验证失败的因子也留在台账(3.6)里标「已否决 + 原因」——防止半年后忘了又测一遍,也让多重检验计数诚实。
4. **长尾走 code-first**:平台预置菜单只保留「验证过的精选」;任何没进菜单的因子,用户随时 defineFactor 手写检验(这正是 code-first 的意义)——**平台不需要穷举 factor zoo,只需要让检验任何因子的成本足够低**。
5. **规模预期:最终预置库 20~40 个,不是上百。** 覆盖十几个主题 × 每主题 1~3 个 A 股存活变体,就是 A 股日频可用 factor zoo 的全部有效信息量。

维护形态:候选清单直接列在本文档(上表),带状态列(待数据/待验证/已收录/已否决),执行模型每验证一个更新一行——不建新表不写代码,文档即台账的前身(正式台账 = 3.6 的 FactorReport 聚合视图)。

## 3.6 研究纪律:台账 + 保留期 + 多重检验提示

- **台账**:`FactorReport` 表本就一行一次分析 → 台账视图(因子×参数×区间全列表、IC/多空摘要、时间线),加一个聚合查询即可,**零新表**。价值:让「我到底挖了多少次」可见——多重检验的第一道防线是意识到自己在多重检验。
- **默认保留期**:分析参数默认 `end = 今天 − 18 个月`;因子选中后一键「在保留段验证」(start=默认 end,end=今天,单独跑一次)。保留段结果**只看一次**的纪律写进文案(看多次就不再是样本外)。不做强制(工具给纪律脚手架,不当家长)。
- **多重检验提示**:台账顶部按累计检验数 N 提示:「已检验 N 个因子/参数组合;5% 显著水平下纯随机预期 ~N/20 个假阳性」。不上 Bonferroni/deflated Sharpe 等重型工具(单人研究,意识到位即可,别过度工程)。同款提示复用到参数扫描(1.2)结果页。

## 3.7 ML 因子合成(远期,唯一推荐姿势)

- **角色定义**:ML = 因子的非线性组合器(业界主流即 LightGBM/GRU 吃因子特征吐打分,Qlib 默认范式),不是新东西的发现机。
- **架构**:特征 = 各因子标准化暴露(3.4 中性化后),标签 = 下期超额收益 rank;**walk-forward 逐年重训**(训练窗滚动,严防前视);**模型输出 = 一个因子**,塞回 analyzeFactor 同一条管道(IC/分层/费后/保留期),不享受任何评估特权。
- **可解释性**:输出 feature importance(必要时 SHAP top-k)——黑箱与执行纪律冲突(回撤中无法回答「系统坏了吗」),对个人交易者可解释性是生存问题。
- **触发条件**:3.3 线性合成先做且证明有价值。线性是 ML 的对照基线:线性做不出的 ML 救不了;线性能做出的,ML 的增益要拿数字证明值得复杂度。
- **明确不做**:深度学习端到端预测价格序列(数据饥渴+非平稳,个人零优势);文本/NLP 因子(数据基建重,远期的远期)。
- **实现注意**:Node 生态无成熟 GBDT 训练库,届时评估 Python sidecar(单脚本、stdin/stdout JSON)vs ONNX 推理 + 离线训练,**现在不定、不预埋**。

---

## 业界参照

Quantopian Pipeline + Alphalens(/factors 原型)、Qlib 表达式因子(definition 模型、不预计算——我们走的就是这个)+ Qlib 的 GBDT 合成范式(3.7 参照)、聚宽 `weight_method`/因子中性化 + Alphalens `periods`(已借鉴)、McLean & Pontiff (2016) 发表后衰减。
