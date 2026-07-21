# 因子研究纪律：研究卡、Holdout 与多重检验提示

> 状态：待实施  
> 前置：`docs/design/factor-report-history.md` 已实施  
> 范围：`FactorReport` 的研究语义、正式保留段、结果揭示、研究变体计数  
> 不在范围：新建 `FactorExperiment`、扩充完整 `AnalysisSpec`、Newey-West / Fama-MacBeth

## 1. 结论

下一步不新增 `FactorExperiment`。当前产品中，用户直接选择因子和参数运行，得到一份不可变报告；没有“创建一项实验、给实验命名、在实验中管理多组报告、单独归档或分享实验”的独立操作。因此：

- `FactorReport` 就是一次 experiment；
- `Job` 是生成报告的一次 computation attempt；
- `testKey` 把重复运行归并为同一个研究变体；
- `parentReportId + phase` 表达探索报告与 holdout 报告的关系。

此时加入 `FactorExperiment → FactorReport → Job` 三层只会增加空壳实体。未来同时出现以下需求时，再提炼 `FactorExperiment`：

1. 用户主动创建并命名一项研究；
2. 一项研究包含多种代码或参数变体；
3. 研究需要独立的结论、状态、协作者、归档或分享；
4. 用户需要跨报告比较，并把整组报告作为一个对象管理。

本阶段的目的，是把现有报告历史从“记住跑过什么”提升为“帮助用户在看结果之前写下预期，并诚实地使用一次样本外证据”。

## 2. 用户最终获得什么

### 2.1 探索运行前有一张轻量研究卡

用户第一次用某份因子代码运行时，选择：

- **假设验证**：先写假设、预期方向和主要通过标准；
- **纯探索**：允许直接观察，但明确标记为探索，不能事后把它包装成预先假设。

研究卡随报告冻结，报告完成后不能修改。

### 2.2 默认给最近 18 个月留出保留段

普通探索默认只跑到“最新可用交易日往前 18 个月”的最后交易日。用户仍可以手动跑完整区间，但这样的报告不再具备正式 holdout 资格。

### 2.3 一份合格探索报告只能发起一次正式 holdout

正式 holdout：

- 使用探索报告冻结的代码；
- 复制频率、中性化等非日期参数；
- 日期由服务器根据保留段规则生成，前端不能修改；
- 结果计算完成后先保持封存；
- 用户明确点击“揭示结果”后才第一次看到指标。

“只看一次”不是以后禁止再次打开，而是记录第一次揭示时间：从 `revealedAt` 开始，这段数据已被看过，不能再声称仍是未触碰样本外。

### 2.4 页面告诉用户已经尝试了多少研究变体

因子页显示：

```text
已完成 17 个探索变体；在 5% 显著水平下，纯随机约会出现 0.85 个假阳性。
```

同一代码、同一参数和同一区间的重复运行只计一个变体；失败或中断且没有产生结果的任务不计。报告条数与研究变体数分别展示，不能混为一谈。

## 3. 核心业务规则

### 3.1 Report、variant 与 test 的区别

```text
reportId   = 一次实际运行，永远唯一
variantKey = 一次精确计算输入，包括 dataRevision
testKey    = 一次研究选择，包括预设判据但不包括 dataRevision
```

建议定义：

```text
variantKey = sha256(canonicalJson({ spec, factorCodeHash, dataRevision }))
testKey    = sha256(canonicalJson({ spec, factorCodeHash, claim }))
```

`claim` 只包含结构化的 `mode + expectedDirection + primaryCriterion`，不包含 hypothesis/rationale 自由文本。改变方向、主要指标或阈值代表换了一种结果判据，应计作新的 test；只润色文字不应增加计数。

数据修复后重新计算是新的精确结果版本，但不是用户提出了一个新的研究假设，不应增加多重检验次数。当前 `dataRevision` 为空时，variant 与 test 仍应现在分开，避免以后改变统计口径。

保守规则：代码只要发生任何变化，`factorCodeHash` 就变化并计作新 test。第一阶段不尝试识别“只改注释”或语义等价代码。

### 3.2 哪些报告计入多重检验

全局与单因子分别统计。计数集合为：

- `phase = explore`；
- `status = done`；
- `testKey` 非空；
- 按不同 `testKey` 去重。

以下不增加探索变体数：

- 同一个 `testKey` 的重跑；
- `running/error/stale`；
- `phase = holdout`；
- 旧报告无法回填 testKey 的记录。

旧报告单独显示 `legacyRunCount`，不为了得到一个看似精确的 N 而伪造代码历史。

### 3.3 Holdout 资格

探索报告同时满足以下条件，才显示“验证保留段”：

1. `phase = explore` 且 `status = done`；
2. 有冻结的 `factorCodeSnapshot/factorCodeHash`；
3. 研究卡模式为 `hypothesis`，并已填写预期方向和主要标准；
4. 探索区间 `end <= exploreEnd`；
5. 保留段至少包含足够的调仓期；第一阶段最低 12 个周频期或 6 个月频期；
6. 没有同一父报告下已经完成或正在运行的 holdout；
7. 平台历史中不存在同一 `factorCodeHash` 已经观察过保留段的完成报告。

第 7 条只能约束平台内历史，无法判断用户是否在外部工具看过数据。UI 必须明确说明这是纪律脚手架，不是密码学意义上的盲测。

如果同一父报告的 holdout 因基础设施失败变为 `error/stale`，允许重试；失败记录继续保留。只能有一份 `running` 或 `done` 的正式 holdout。

### 3.4 Holdout 使用冻结代码

发起 holdout 时必须使用父报告的 `factorCodeSnapshot`，不能使用编辑器里的当前代码。否则用户可能在看过探索结果后改代码，再把新代码在保留段的结果错误归到旧假设。

若当前因子代码已变化，仍允许从旧探索报告发起 holdout，但页面应提示“将验证报告当时的代码，不是编辑器当前代码”。

### 3.5 Holdout 日期

日期由服务器根据市场数据计算，不依赖浏览器日期：

```text
latestDate   = Daily 表中的最新交易日
cutoffDate   = latestDate 往前 18 个自然月
exploreEnd   = cutoffDate 当日或之前最近的交易日
holdoutStart = exploreEnd 之后第一个交易日
holdoutEnd   = latestDate
```

父报告的 `start` 保留；holdout 复制父报告除日期以外的 spec，并替换为 `holdoutStart/holdoutEnd`。若数据同步落后，页面显示实际 `latestDate`，不能用系统今天假装数据已更新。

### 3.6 揭示规则

- holdout worker 正常计算并持久化 payload，但列表和详情 API 在 `revealedAt IS NULL` 时不得返回指标或 payload；
- 用户点击“揭示结果”并二次确认后，后端原子写入 `revealedAt`；
- 写入成功后返回报告详情；即使响应途中断开，再次 GET 也能看到结果；
- `revealedAt` 一旦写入不可清空；
- 已揭示报告可以反复查看，但 UI 始终显示首次揭示时间；
- 不提供“删除后再验证一次”的入口。用户显式删除整个自定义因子仍属于现有数据删除语义，但不能因此恢复样本外资格。

## 4. 研究卡

### 4.1 共享类型

```ts
export interface FactorResearchIntentV1 {
  version: 1;
  mode: 'hypothesis' | 'exploratory';
  hypothesis?: string;
  rationale?: string;
  expectedDirection: 'positive' | 'negative' | 'unknown';
  primaryCriterion?: {
    metric: 'rank_ic_mean' | 'rank_icir_annual' | 'net_long_short_annualized';
    operator: 'gt' | 'lt';
    value: number;
  };
}
```

约束：

- `hypothesis` 最长 500 字符；
- `rationale` 最长 1000 字符；
- `mode = exploratory` 时允许 `expectedDirection = unknown`，主要标准可空；
- `mode = hypothesis` 时 hypothesis、明确方向和主要标准必填；
- 正方向默认建议 `operator = gt`，负方向默认建议 `operator = lt`，但最终由用户确认；
- 主要标准只是预先钉住的第一判断，不替代 IC 稳定性、分层、费后和容量等完整证据链。

### 4.2 触发方式

- 某个 `factorCodeHash` 第一次运行时弹研究卡；
- 后续从选中报告重跑时，默认复制其研究卡，可在运行前修改，修改后的卡属于新报告；
- 用户可以明确选择“纯探索”，不能强迫用户编造一个假设；
- holdout 不允许修改研究卡，完整继承父报告。

## 5. 数据模型

不新增数据库 model，只扩展 `FactorReport`：

```prisma
model FactorReport {
  // Existing fields remain.
  phase             String    @default("legacy") // legacy | explore | holdout
  testKey           String?
  researchIntentJson String?
  holdoutPolicyJson String?
  revealedAt        DateTime?

  @@index([userId, testKey])
  @@index([userId, parentReportId, phase])
}
```

`holdoutPolicyJson` 保存创建当时的规则快照：

```ts
export interface FactorHoldoutPolicyV1 {
  version: 1;
  months: 18;
  latestDate: string;
  exploreEnd: string;
  holdoutStart: string;
  holdoutEnd: string;
  checkedAt: string;
}
```

设计说明：

- 不把 `parentReportId` 改成只服务 holdout；现有普通重跑血缘继续保留，通过 `phase` 区分；
- 不做 Prisma 自关联，所有查询继续按 `userId + parentReportId` 显式限定；
- migration 由 Prisma 6 生成，禁止手改；
- 用户研究数据不得加入 agent 的只读 SQL 白名单。

### 5.1 旧报告回填

- 对已有 `phase = explore` 且有 `factorCodeHash/specJson` 的报告，按 `claim = { mode: 'exploratory' }` 回填 `testKey`；
- 不给旧报告伪造研究卡；`researchIntentJson` 保持空，视为历史探索；
- `legacy` 报告只有输入足够完整时才回填 testKey；否则保留为空并计入 legacy 数量；
- 回填脚本必须幂等，不改 payload、variantKey、代码快照或时间。

## 6. API 设计

### 6.1 研究窗口

```http
GET /api/app/factor/research/window
```

返回 `FactorHoldoutPolicyV1`。前端用它设置新探索的默认 end，并展示实际数据截止日。

### 6.2 研究统计

```http
GET /api/app/factor/research/summary?factor=<optionalFactorId>
```

```ts
interface FactorResearchSummary {
  global: FactorResearchCounts;
  factor?: FactorResearchCounts;
}

interface FactorResearchCounts {
  exploreRunCount: number;
  exploreTestCount: number;
  legacyRunCount: number;
  holdoutCount: number;
  revealedHoldoutCount: number;
  expectedFalsePositivesAtFivePercent: number;
}
```

统计必须 owner-scoped。首版用 Prisma 读取必要字段后在应用层按 testKey 去重；数据量变大且实测变慢后再考虑 targeted raw SQL。

### 6.3 普通探索运行

现有：

```http
POST /api/app/factor/analysis/run
```

请求增加：

```ts
{
  factor: string;
  spec: FactorAnalysisSpecV1;
  parentReportId?: string | null;
  researchIntent: FactorResearchIntentV1;
}
```

客户端不能传 `phase`；此接口创建的报告固定为 `explore`。后端计算并写入 `testKey`，冻结 `researchIntentJson`。

### 6.4 查询 holdout 资格

报告详情增加：

```ts
holdout?: {
  eligible: boolean;
  reason?:
    | 'not_explore'
    | 'not_done'
    | 'missing_hypothesis'
    | 'outside_explore_window'
    | 'insufficient_periods'
    | 'already_observed'
    | 'already_exists';
  existingReportId?: string;
  window?: FactorHoldoutPolicyV1;
};
```

资格由后端计算；前端只负责展示，不复制业务判断。

### 6.5 发起 holdout

```http
POST /api/app/factor/reports/:reportId/holdout
```

无参数。后端在事务中：

1. owner-scoped 读取父报告；
2. 重新计算资格与研究窗口；
3. 若已有 running/done holdout，返回现有报告；
4. 使用父报告冻结代码、研究卡和非日期 spec 创建 `phase = holdout` 的新报告与 Job；
5. 写入 `parentReportId` 和 `holdoutPolicyJson`；
6. 启动现有 factor worker。

响应继续使用 `{ reportId, jobId, status, reusedRunning }`，但不能调用普通 run 接口伪造 holdout。

### 6.6 揭示 holdout

```http
POST /api/app/factor/reports/:reportId/reveal
```

仅允许 owner、`phase = holdout`、`status = done`。事务使用“仅当 `revealedAt IS NULL` 才更新”的条件；已揭示时幂等返回详情。

### 6.7 报告列表和详情的脱敏

未揭示 holdout：

- list 不返回 metrics；
- detail 不返回 payload；
- 返回 `sealed = true`、`canReveal` 和计算状态；
- Job 日志不得泄露 IC、收益、通过/失败等结果数字。现有分析日志需审计，结果指标只在 payload 中出现。

## 7. 前端设计

### 7.1 因子页顶部研究提示

在历史报告入口附近增加轻量提示，不做独立 Experiment 页面：

```text
探索变体 17 · 报告 24
随机假阳性预期约 0.85（按 5%）
```

点击可打开说明，解释“重复运行不重复计数、失败任务不计、这只是风险意识提醒”。候选规模较小时不上 q-value 或复杂校正。

### 7.2 研究卡弹窗

使用 antd Modal/Form：

- 首行选择“假设验证 / 纯探索”；
- 假设验证显示假设、逻辑、方向、主要指标、比较符和阈值；
- 纯探索只显示说明，可直接继续；
- 点击确认后才调用普通 run API；
- 文案同时维护 zh/en。

### 7.3 历史列表

每条报告增加标签：

- 探索；
- Holdout · 未揭示；
- Holdout · 已揭示；
- 历史报告。

未揭示 holdout 不显示指标。打开后展示封存卡片和“揭示结果”按钮。

### 7.4 从报告发起 holdout

合格 explore 报告结果区显示“验证保留段”。点击后先展示：

- 冻结的因子代码 hash；
- 父报告参数；
- holdout 日期；
- 预先写下的方向和主要通过标准；
- “这段结果揭示后不能恢复为未观察”的说明。

确认后启动任务。当前编辑器代码或参数不参与 holdout。

### 7.5 揭示与判定

任务完成后只显示“计算完成，结果仍封存”。用户点击揭示并确认后：

- 写入 URL 中当前 holdout reportId；
- 调用 reveal API；
- 展示完整报告；
- 在报告顶部对照预设主要标准显示“达到 / 未达到”，但不替用户下“因子有效”的最终结论；
- 显示首次揭示时间。

## 8. 状态与流程

```text
填写研究卡
    ↓
Explore Report: running → done/error/stale
    ↓ done + eligible
创建 Holdout Report（冻结父报告代码和非日期参数）
    ↓
Holdout: running → done(sealed)/error/stale
    ↓ 用户确认
revealedAt = now → 可反复查看，但不再是未观察数据
```

普通 explore 重跑仍按现有语义创建新报告。holdout 失败重试也创建新报告并保留失败记录，不复用或覆盖旧报告。

## 9. 实施顺序

### Phase A：统计身份和研究卡

1. 增加 shared 类型、`testKey` helper 和单测。
2. Prisma 新字段、迁移和幂等回填。
3. run API 接受并冻结研究卡。
4. summary API 与顶部计数 UI。
5. 研究卡弹窗及中英文文案。

### Phase B：研究窗口和 Holdout

1. 实现市场数据驱动的 research window helper/API。
2. 实现 owner-scoped 资格判断及原因枚举。
3. 实现 holdout 创建，复用现有 report + job + worker 管道。
4. 扩展 phase 类型、历史列表标签和详情 UI。

### Phase C：封存和揭示

1. 未揭示 payload/metrics 脱敏。
2. reveal API 与幂等事务。
3. 揭示确认、预设标准对照和 revealedAt 展示。
4. 审计 Job 日志不泄露结果。

### Phase D：回归与文档

1. 补 API 集成测试和真实服务 E2E。
2. 运行 migration 回填并核对计数。
3. 更新 `factor-report-history.md` 的后续边界和 `ROADMAP.md` 状态。
4. 完成桌面/窄屏截图验收并在实施会话中直接展示截图。

建议三个 Phase 连续完成后再对外标记“正式 holdout 已实现”；不要在只有 UI 标签、结果仍可提前从 API 读到时宣称完成。

## 10. 测试计划

### 10.1 单元测试

- canonical JSON 对字段顺序稳定；
- dataRevision 变化时 variantKey 变化、testKey 不变；
- spec、代码、日期或结构化 claim 变化时 testKey 变化；
- research intent 的 hypothesis/exploratory 校验；
- research window 使用真实最新交易日，正确跨月、跨年和周末对齐；
- 主要标准的正负方向判定。

### 10.2 API 集成测试

- run 只能创建 explore，不能由客户端伪造 holdout；
- summary 按 owner 隔离并按不同 testKey 去重；
- error/stale 和 holdout 不计探索变体；
- 不合格父报告返回稳定 reason；
- holdout 使用父报告代码快照，而非当前 Factor 代码；
- 同一父报告并发只能存在一份 running/done holdout；
- error/stale holdout 可以重试且旧记录保留；
- 未揭示详情/list/job logs 不泄露结果；
- reveal 只允许 done holdout，重复调用幂等；
- 揭示后不能清空 revealedAt。

### 10.3 前端 E2E

- 新代码首次运行出现研究卡，纯探索与假设验证都能创建报告；
- 重跑可复制研究卡但不修改旧报告；
- 默认探索 end 使用服务器返回 cutoff；
- 不合格报告不显示正式 holdout 按钮，并展示原因；
- 修改当前代码后，从旧报告发起 holdout 仍使用旧快照；
- holdout 运行中刷新、切换因子再回来能够续接；
- 完成后刷新仍封存，页面和网络响应都没有结果指标；
- 揭示后显示结果、标准判定和 revealedAt；
- 同一父报告不能再发起第二份正式 holdout；
- 中英文、桌面和窄屏布局通过。

## 11. 验收标准

1. 没有新增 `FactorExperiment` 表或空壳业务层。
2. 每份新 explore 报告冻结合法研究卡和 testKey。
3. 页面同时显示报告次数与唯一探索变体次数。
4. 默认探索窗口保留最近 18 个月，并显示真实数据截止日。
5. 正式 holdout 只能由合格父报告发起，代码和参数来自父报告快照。
6. 未揭示 holdout 的 API、列表、详情和日志均不泄露结果。
7. 揭示是幂等、不可逆且记录时间的明确动作。
8. 同一父报告最多一份 running/done 正式 holdout，失败重试留痕。
9. 所有查询 owner-scoped，旧报告无损回填。
10. Shared/API/Web 检查、集成测试和真实服务 E2E 全部通过。

## 12. 本阶段不做

- 不做命名、归档、分享、协作型 `FactorExperiment`。
- 不实现真正的访问控制盲测；用户拥有本地数据库，产品只提供纪律脚手架。
- 不补完整股票池、异常值、缺失处理和成本参数；这些属于 `ROADMAP 3.6b-A` 的 `AnalysisSpec` 扩展。
- 不上 Benjamini-Hochberg、q-value、Bonferroni 或 deflated Sharpe；候选数扩大后再做。
- 不做 Newey-West、Fama-MacBeth、alpha / GRS。
- 不把 holdout 的单一通过标准包装成自动准入结论。
- 不修改相关性报告和策略回测。

## 13. 预计涉及文件

实施 agent 开始前应重新用 `rg` 定位依赖，至少检查：

- `apps/api/prisma/schema.prisma`
- `apps/api/src/factor/report-spec.ts`
- `apps/api/src/routes/factor.ts`
- `apps/api/src/lib/jobs.ts`
- `packages/shared/src/factor.ts`
- `apps/web/src/api/client.ts`
- `apps/web/src/complex/factor/factor-store.ts`
- `apps/web/src/complex/factor/factor.tsx`
- `apps/web/src/complex/factor/factor.css`
- factor 页 zh/en i18n
- `apps/web/e2e/factor-report-history.mjs`
- `docs/design/factor-report-history.md`
- `ROADMAP.md`

实施前先跑现有 FactorReport 回归；实现后必须用真实 API/Web 服务验证运行中刷新续接、同参数重跑和切换因子续接，不能只依赖 mocked route。
