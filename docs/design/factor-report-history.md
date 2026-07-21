# 因子报告历史化与任务续接设计（已实施）

> 状态：已实施（2026-07-14）
>
> 范围：因子分析报告、后台任务、前端报告历史
> 实现提交：`b365be8 feat: add factor report history`
> 维护入口：后续修改应先完整阅读根目录 `CLAUDE.md`、`apps/web/CLAUDE.md` 与本文，再检查当前代码；本文记录已经落地的契约，`ROADMAP.md` 只保留高层目标。

## 0. 实施结论与确认差异

本次改造已经完成从“参数复合键缓存”到“不可变报告历史”的切换：新报告使用稳定 ULID，`FactorReport` 与 `Job` 一一对应，URL、详情加载和运行中续接均围绕 `reportId/jobId`，旧复合 ID 报告由幂等脚本无损回填。

最终实现与原设计主体一致，以下细节以实际代码为准：

- 历史入口使用 antd Modal + List，而不是 Select；默认仍打开当前因子的最新报告。
- 从已选报告再次运行时，前端会把该报告 ID 作为 `parentReportId`，但本阶段不展示血缘关系。
- 参数或编辑器代码与选中报告不一致时，页面保留报告并显示“已过时”警告；打开其他历史报告、切换因子或离开页面前有丢弃草稿确认。
- `dataRevision` 字段与 hash 输入已经预留，当前运行固定为空；在数据 revision 机制落地前，不能宣称报告能够逐位复现市场数据修订前的结果。
- `FactorExperiment` 没有落库；报告是一次研究运行，`variantKey` 是研究变体分组身份。

### 代码变更后的报告规则（已确认）

实施前曾讨论过“代码变化后按当前 codeHash 清空报告视图”的简化方案，最终提交没有采用该方案，而是采用更保守的不可变快照：

- 每份新报告保存 `factorCodeSnapshot` 与 `factorCodeHash`；
- 自定义因子或内置因子代码变化时不删除、不隐藏旧报告；
- 新代码重新运行会生成新报告和新 `variantKey`；
- 打开旧报告时仍能看到当次结果，当前代码与历史快照不一致时由前端明确提示；
- 不新增 `FactorRevision`，代码快照直接归属于报告。

该差异已接受。后续不得在没有数据迁移和产品确认的情况下，重新改成编辑代码即物理删除报告。

### 当前验证结果

2026-07-14 复核提交后已通过：

- `@jixie/shared` build；
- API typecheck；
- API Vitest：23 个测试文件、156 项测试全部通过；
- Web typecheck + production build。

仓库已提供 `apps/web/e2e/factor-report-history.mjs`，覆盖稳定 reportId 恢复、历史切换、参数/代码过时提示、草稿丢弃保护和窄屏布局。真实耗时任务的刷新续接、切换因子续接和同参数重跑仍应在运行 API/Web 服务的验收环境中保留为回归场景。

## 1. 改造目的

把“按参数命中一份缓存”改成“用户每运行一次，就保存一份可追溯的研究报告”。

用户选择一个因子后，应当看到这个因子历次运行产生的报告列表：

- 默认打开最近一次报告；
- 可以选择任意历史报告，并恢复当时使用的参数；
- 同一组参数可以反复运行，每次完成后都形成独立历史记录；
- 报告正在运行、失败或服务器重启后中断时，也仍然出现在列表中；
- 刷新页面或切换因子再切回来，仍能通过稳定的报告 ID 找回任务状态；
- 修改因子代码不会删除旧报告，旧报告保留当时的参数和代码快照。

这不是给现有报告“再加一道验证”，也不新增独立的 `FactorExperiment` 业务对象。新的定义是：

- `FactorReport`：一次用户发起的研究运行，也是用户看到的一条历史记录；
- `Job`：生成这份报告的后台计算任务，保存执行状态和日志；
- 二者一一对应；报告负责研究结果，任务负责计算过程。

## 2. 当前问题

当前实现用 `factor + freq + start + end + neutral` 拼接报告 ID 和任务 key，并把它们同时当作缓存身份、任务身份和页面恢复身份。这会带来以下问题：

1. 参数结构一变，所有拼 key、查询、兼容逻辑都必须一起修改。
2. 相同参数再次运行会覆盖原报告，无法形成历史。
3. 页面刷新时，前端必须重新拼出完全相同的参数才能找到正在运行的任务。
4. 前端切换因子会自动套用最近缓存参数，可能覆盖 URL 或当前运行参数，导致刷新后看不到正在执行。
5. URL 没有稳定的报告身份；部分参数（目前包括 `neutral`）没有完整进入路由恢复链路。
6. 修改自定义因子代码或更新内置因子代码时会删除旧报告，失去研究轨迹。

本次改造不再修补参数 key，而是把“运行记录”提升为独立、稳定的实体。

## 3. 核心设计决策

### 3.1 每次运行生成新报告

用户显式点击“运行”后，后端立即创建一个 ULID `reportId`，并同步创建一个 ULID `jobId`。报告初始状态为 `running`，接口立即返回二者，不等待计算完成。

同样参数在上一份报告结束后再次运行：

- 新建不同的 `reportId`；
- 新建不同的 `jobId`；
- 历史列表新增一条记录；
- 两份报告可以具有相同的 `variantKey`，但互不覆盖。

为防止双击或网络重试制造并发重复，在“同一用户、同一因子、同一 `variantKey` 已有 `running` 报告”时，后端返回现有 `reportId/jobId`。任务终止后再点击则正常新建报告。这只是运行中的并发保护，不是结果缓存。

### 3.2 报告参数使用版本化快照

新建 `AnalysisSpec`，由后端统一规范化并保存为 JSON。第一版只覆盖当前已有参数：

```ts
interface FactorAnalysisSpecV1 {
  version: 1;
  freq: string;
  start: string;
  end: string;
  neutral: string;
}
```

以后增加股票池、去极值、标准化、行业/市值中性化等参数时，只扩展或升级 `AnalysisSpec`，不再修改报告 ID、任务 ID 或页面恢复机制。

报告创建后，`specJson` 和代码快照视为不可变输入；计算过程只更新状态、日志引用、结果和错误。

### 3.3 `variantKey` 只用于研究口径分组

后端用唯一的公共函数计算：

```text
variantKey = sha256(canonicalJson({ spec, factorCodeHash, dataRevision }))
```

- `canonicalJson` 必须保证字段顺序和默认值稳定；
- `factorCodeHash` 来自本次运行的代码快照；
- `dataRevision` 第一阶段允许为空，后续接入数据版本时不改身份模型；
- 前端不得自行生成或解析 `variantKey`；
- 数据库不得对 `variantKey` 加唯一约束。

`variantKey` 的意义是“这几份报告是否属于同一个研究变体”。以后统计多重检验次数时，应统计有效的唯一研究变体，而不是用户点击运行的次数。

### 3.4 状态以报告 ID 为中心

报告状态采用：

```text
running -> done
running -> error
running -> stale
```

`stale` 表示服务重启或异常退出后，原任务已无法继续。第一阶段不实现取消和恢复计算；用户可以从该报告参数再次运行，产生新报告。

前端不再根据参数查询“有没有正在运行”，而是：

1. 通过 `reportId` 获取报告详情；
2. 详情中取得关联的 `jobId`；
3. 报告仍为 `running` 时，通过 `jobId` 继续轮询任务。

## 4. 数据模型

在 `apps/api/prisma/schema.prisma` 中演进现有模型。字段名称可根据 Prisma 关系约束微调，但语义必须保持：

```prisma
model FactorReport {
  id                 String    @id
  userId             String
  factor             String
  status             String    @default("done")
  phase              String    @default("legacy")

  // Kept as queryable columns for list display and legacy compatibility.
  freq               String
  neutral            String    @default("none")
  start              String
  end                String

  specJson           String?
  variantKey         String?
  factorCodeSnapshot String?
  factorCodeHash     String?
  dataRevision       String?

  payload            String?
  error              String?
  parentReportId     String?
  createdAt          DateTime  @default(now())
  computedAt         DateTime?

  job                Job?

  @@index([userId, factor, createdAt])
  @@index([userId, variantKey])
}

model Job {
  // Existing fields remain unchanged.
  factorReportId String?       @unique
  factorReport   FactorReport? @relation(fields: [factorReportId], references: [id], onDelete: Cascade)
}
```

实施注意事项：

- 旧 `FactorReport.id` 保留，不做破坏性的主键重写；新报告才使用 ULID。
- `payload` 和 `computedAt` 改为可空，以容纳 `running/error/stale` 报告。
- 新报告创建时显式写 `phase = "explore"`；旧数据默认 `legacy`。
- `parentReportId` 记录从当前选中报告发起新运行的血缘，本阶段不做自关联查询或 UI 展示。
- 用户数据表不得加入 agent 的只读 SQL 白名单。
- Migration SQL 必须由 Prisma 6 生成，禁止手改已生成 migration。

### 4.1 旧数据迁移

旧数据量预计有限，优先使用 Prisma 写一个幂等回填脚本，不为这条冷路径引入原生 SQL：

1. 逐批读取 `specJson IS NULL` 的旧报告；
2. 从 `freq/start/end/neutral` 生成 `FactorAnalysisSpecV1`；
3. 将 `createdAt` 回填为原 `computedAt`；
4. 写入 `status = done`、`phase = legacy`；
5. 若能取得当前代码可写代码快照，否则保留为空，并明确旧报告不可完全复现；
6. 重复执行不得改变已迁移记录。

迁移前按项目数据库备份流程备份；迁移后核对总行数、非空 payload 数和抽样报告内容。不要删除旧报告。

## 5. 后端 API

目标接口如下。实际路径继续位于 factor 路由下，并沿用现有鉴权与 i18n 错误格式。

### 5.1 报告列表

```http
GET /api/app/factor/reports?factor=<factorId>&limit=50&cursor=<cursor>
```

返回按 `createdAt` 倒序排列的摘要：

```ts
interface FactorReportSummary {
  id: string;
  factor: string;
  status: 'running' | 'done' | 'error' | 'stale';
  phase: 'legacy' | 'explore';
  spec: FactorAnalysisSpecV1;
  variantKey?: string;
  jobId?: string;
  createdAt: string;
  computedAt?: string;
  error?: string;
  metrics?: {
    ic?: number;
    rankIc?: number;
  };
}
```

列表接口不返回完整大 payload，只返回足以展示历史列表的状态、参数和关键摘要。所有查询必须限定当前 `userId`。

### 5.2 报告详情

```http
GET /api/app/factor/reports/:reportId
```

返回摘要字段、完整 payload、代码快照和关联 `jobId`。报告不存在或不属于当前用户时使用统一的 not-found 响应，避免泄露他人 ID。

### 5.3 发起运行

```http
POST /api/app/factor/analysis/run
Content-Type: application/json

{
  "factor": "momentum_20d",
  "spec": {
    "version": 1,
    "freq": "weekly",
    "start": "2020-01-01",
    "end": "2025-12-31",
    "neutral": "none"
  },
  "parentReportId": null
}
```

响应固定为：

```ts
{
  reportId: string;
  jobId: string;
  status: 'running';
  reusedRunning: boolean;
}
```

后端在同一事务内完成：

1. 校验并规范化 spec；
2. 读取并冻结当前因子代码；
3. 计算代码 hash 和 `variantKey`；
4. 检查是否已有相同变体正在运行；
5. 若没有，创建 `FactorReport(running)` 和关联 `Job(pending/running)`；
6. 提交事务后启动 worker。

接口不再接受 `refresh`，也不再因命中旧结果而直接返回旧报告。

### 5.4 任务查询

保留现有按 `jobId` 查询任务的接口，用于进度和日志。任务响应中加入 `factorReportId`，报告详情中也返回 `jobId`。

### 5.5 淘汰旧接口

前端切换完成并通过测试后，删除以下参数身份逻辑：

- 按完整参数 GET analysis；
- 按完整参数 GET running analysis；
- `refresh` 参数；
- `reportId(...)` 和 `jobKey(...)` 的参数拼接函数；
- 以 `FactorRun` 为核心的 `/runs` 读写语义。

如需短暂兼容旧页面，只允许保留只读适配，且最终仍解析到 `reportId`；不要长期双写两套模型。

## 6. Worker 与异常处理

当前 worker 不能再按复合 ID `upsert` 报告。改为围绕父进程创建好的 `reportId` 工作：

1. `workerData` 带入 `reportId`、规范化 spec 和必要的计算输入；
2. worker 计算完成后向父进程返回 payload；
3. 父进程按 `reportId` 更新报告为 `done`，写 payload 和 `computedAt`；
4. 同时把对应 Job 标记完成；
5. 计算或持久化失败时，把 Job 和 FactorReport 都标记为 `error`，并保存面向用户的安全错误摘要；
6. 详细执行日志继续留在 Job，不复制进报告 payload。

服务启动时，现有的“将遗留 running Job 标为 stale”逻辑必须同步把其关联的 `FactorReport(running)` 标为 `stale`。状态更新应尽可能放在事务中，避免出现 Job 已结束但报告仍显示运行。

## 7. 前端交互与状态

### 7.1 URL

页面身份改为：

```text
/factors?factor=<factorId>&report=<reportId>
```

参数表单不再承担页面身份。选择历史报告时，前端从报告 `spec` 恢复表单。旧参数 URL 可以在过渡期读一次，但新 URL 只写 `factor` 和 `report`。

### 7.2 Store

在现有 factor complex 内完成，不新增另一套页面架构：

- 用 `reportsLoader` 加载当前因子的报告摘要；
- 用 `reportLoader` 按 ID 加载选中报告详情；
- 保留 `PollingModel`，但轮询目标改为选中报告关联的 `jobId`；
- 移除 `runsLoader`、按完整参数取 analysis、`isCached` 等旧缓存语义；
- 增加稳定的 `selectedReportId`；
- 参数编辑值是 draft，与历史报告实体分开。

关键流程：

**选择因子**

1. 加载因子信息和报告列表；
2. 若 URL 指定了属于该因子的 report，则打开它；
3. 否则默认打开列表中最新报告；
4. 没有历史时只显示默认参数表单和空状态；
5. 不得再无条件套用“最近缓存参数”覆盖指定报告。

**打开历史报告**

1. 设置 `selectedReportId`；
2. 加载详情；
3. 用详情里的 spec 覆盖参数 draft；
4. 更新 URL；
5. 若状态为 running，使用详情返回的 jobId 开始轮询。

**运行新报告**

1. 自定义因子若有未保存代码，沿用当前保存/提交约束先保存；
2. 复制当前参数 draft，POST run；
3. 立即把 running 摘要插入列表顶部；
4. 选中新的 reportId，并立即写入 URL；
5. 用返回的 jobId 开始轮询；
6. 完成后按 reportId 重载详情和报告列表。

**刷新或切换因子**

- 页面刷新后直接按 URL reportId 恢复，不重建参数 key；
- 切换到其他因子只停止本页面对旧任务的本地轮询，不取消后台任务；
- 再切回来时，报告列表会显示 running 状态并重新接上轮询；
- 页面卸载同样只清理前端轮询。

### 7.3 页面表现

把当前以参数标识的历史 chips 改成一个清晰的历史报告选择器，可使用 antd `Select` 或 `Dropdown + List`，首版不需要做复杂时间轴。

每条记录至少显示：

- 创建日期和时间；
- 状态（运行中、已完成、失败、已中断）；
- 主要参数摘要；
- 已完成时可显示 IC / Rank IC 等一个或两个关键指标。

参数被用户修改后，可继续显示当前历史报告，但在表单附近提示“参数已修改，运行后将生成新报告”。点击运行永远表示生成新报告，不表示覆盖当前报告。

同一变体正在运行时，运行按钮应禁用或接回已有任务；终态报告允许无限重跑。运行中报告显示进度/日志和结果占位，失败/中断报告显示错误及“按此参数重新运行”。

所有新增 UI 文案同时加入 factor 页的中英文 i18n 资源；样式遵循具名 `jx-` BEM class、CSS `@apply`、antd 组件和 FontAwesome 约定。

## 8. 因子代码变更的历史保留规则

必须删除以下行为：

- 编辑自定义因子代码后删除该因子的旧 `FactorReport`；
- 内置因子种子代码 hash 变化后删除旧 `FactorReport`。

原因是旧报告已经保存代码快照，它代表当时真实发生过的研究，不应因当前代码变化而消失。新代码再次运行会产生新的代码 hash 和 `variantKey`。

用户显式删除整个自定义因子时，可以保留当前“连同其报告一起删除”的产品语义，但必须继续有明确确认；这与编辑代码不是同一种操作。本阶段不增加单份报告删除 UI。

## 9. 共享类型

在 `packages/shared` 中新增或调整：

- `FactorAnalysisSpecV1`；
- `FactorReportStatus`；
- `FactorReportSummary`；
- `FactorReportDetail`；
- 发起运行的请求与响应类型。

逐步淘汰把缓存参数身份当成报告本身的 `FactorRun`。后端和前端都引用共享类型，spec 规范化与 `variantKey` 计算只放在后端。改完共享类型先构建 `@jixie/shared`。

## 10. 实施记录

以下四个阶段已在提交 `b365be8` 中完成；保留步骤作为后续维护和排障索引。

### 阶段 A：数据模型与共享契约

1. 修改 Prisma schema 并用 Prisma 6 生成 migration。
2. 增加共享类型和后端 spec 规范化、canonical JSON、hash helper。
3. 编写并验证旧报告幂等回填脚本。
4. 先备份开发数据库，再迁移和抽样核对。

### 阶段 B：后端运行链路

1. 实现报告列表和详情 API。
2. 将 run API 改为事务创建 report + job。
3. 将 worker 持久化改为按 reportId 更新。
4. 补齐 error/stale 的双状态更新。
5. 停止因代码更新而删除报告。

### 阶段 C：前端切换

1. 修改路由为 factorId + reportId。
2. 重构 factor store 的 loaders、选中状态和轮询恢复。
3. 实现历史报告选择器、状态展示和参数恢复。
4. 更新中英文 i18n 与样式。
5. 删除前端参数拼 key 和缓存命中语义。

### 阶段 D：清理与文档

1. 删除不再使用的旧接口和 helper。
2. 调整 E2E 清理方式，不再把产品 `/runs DELETE` 当作通用测试清库接口。
3. 更新 `ROADMAP.md` 和相关设计文档中的旧表述。
4. 检查没有遗留 `FactorExperiment` 或“同参数只有一份报告”的假设。

不要长期维持新旧两条写入链路；允许短暂只读兼容，但应在同一改造中完成前端切换和旧写入删除。

## 11. 测试与回归契约

### 11.1 后端

- 相同参数第一次完成后再次运行，得到不同 reportId、不同 jobId、相同 variantKey。
- 相同变体仍在 running 时重复提交，返回原 reportId/jobId 且 `reusedRunning = true`。
- 参数或因子代码变化后，variantKey 变化。
- 报告按用户隔离，不能读取或轮询他人的报告/任务。
- 状态正确经历 running → done/error。
- 服务启动清理遗留任务时，关联报告同步变为 stale。
- 修改自定义因子代码、更新内置因子代码均不删除旧报告。
- 旧复合 ID 报告迁移后可正常出现在列表并打开。
- 事务失败时不会只留下孤立 report 或孤立 job。

### 11.2 前端 E2E

- 启动一个耗时报告，尚未完成时刷新页面，仍显示同一 reportId 的运行状态和日志。
- 运行中切换到另一因子再切回来，能够重新接上任务。
- 同参数完成后重跑，历史列表增加第二条，旧报告仍可打开。
- 打开旧报告会恢复当时全部参数和结果，包括 `neutral`。
- 默认打开当前因子的最新报告；URL 指定旧报告时不得被最新报告覆盖。
- 失败或 stale 报告仍在历史列表，可按其参数重新运行。
- 修改因子代码后旧报告仍在，随后新运行产生新记录。
- 中英文新增文案均可切换。
- 按 `apps/web/CLAUDE.md` 要求完成桌面与窄屏截图检查，确认下拉层、运行状态和报告长内容无布局问题。

### 11.3 必跑检查

至少执行受影响包的：

- shared build；
- API typecheck 与相关测试；
- Web typecheck/build 与 factor E2E；
- Prisma migration 状态检查；
- 格式化和 lint。

测试临时启动的 API/Web 服务必须在验证结束后关闭，并确认端口释放。

## 12. 验收标准

满足以下条件才算改造完成：

1. 每次终态后的显式运行都会新增一份报告，绝不覆盖旧报告。
2. 因子页能查看该因子的报告历史，默认最新，也能打开任意旧报告。
3. 历史报告能准确恢复当时参数和结果。
4. 运行开始后立即获得并写入稳定 reportId；刷新和切换因子不会丢失运行状态。
5. running、done、error、stale 都是可见且可恢复的历史状态。
6. 报告和 Job 建立明确的一一对应关系，不再依赖参数拼接身份。
7. 因子代码更新不会删除历史报告；报告保存代码快照和 hash。
8. 相同参数可以无限重跑；报告次数与唯一研究变体次数可以分别统计。
9. 旧报告无损迁移，现有用户数据没有被清空。
10. 新旧缓存写入机制没有长期并存，相关测试全部通过。

## 13. 本阶段不做

- 不新建独立 `FactorExperiment` 模型。
- 不实现正式的样本外 holdout 工作流；只预留 `phase` 和 `parentReportId`。后续详设见 `docs/design/factor-research-discipline.md`。
- 不在本次扩展股票池、去极值、标准化等完整研究参数；但新增参数必须进入版本化 spec。
- 不实现运行中任务取消、断点续算或跨进程恢复。
- 不实现单份报告删除、标签、备注、收藏和报告对比。
- 不改相关性分析报告；后续可以复用同一“报告历史 + Job”模式。

## 14. 主要实现文件

后续维护时以实际搜索结果为准，至少检查：

- `apps/api/prisma/schema.prisma`
- `apps/api/src/routes/factor.ts`
- `apps/api/src/routes/factors.ts`
- `apps/api/src/factor/factor-worker.ts`
- `apps/api/src/factor/builtin-factors.ts`
- `apps/api/src/lib/jobs.ts`
- `packages/shared/src/factor.ts`
- `apps/web/src/complex/factor/factor-store.ts`
- `apps/web/src/complex/factor/factor.tsx`
- `apps/web/src/complex/factor/factor.css`
- `apps/web/src/app-routes.tsx`
- factor 页中英文 i18n 资源
- `apps/web/e2e/screener.mjs`
- `ROADMAP.md`

后续改动前，应先用 `rg` 重新定位所有 `FactorReport`、`FactorRun`、`reportId`、`jobKey`、`analysis/running`、`refresh` 和报告删除调用，避免只修改上述已知文件而遗漏隐含依赖。
