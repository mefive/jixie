# Ingestion 诊断包导出 CLI

状态：修正版已通过人工审阅、40 项相关测试、完整工作区构建、36 项后端边界自测与真实已结束 Run 的只读导出验证。分析 Prompt 独立存放于 [docs/prompts](../prompts/ingestion-issue-repair.md)，正文按用户要求使用中文。

职责：CLI 在一个一致的数据库读快照中导出问题及必要上下文；Agent 读取文件、给出分析与 SQL 提案，维护者按既有流程审阅后执行。

现有 `pnpm data issues RUN_ID` 返回全部历史诊断及部分批次信息，保持兼容。新增：

```bash
pnpm data issues export RUN_ID --out /absolute/path/diagnostics.json
pnpm data issues export RUN_ID --issue ISSUE_ID --out /absolute/path/one-issue.json
```

`--out` 必填，接受相对或绝对路径；`--issue` 仅缩小导出范围，须属于指定 Run 的当前有效问题。输出文件排他创建、权限 0600，已存在则报错，不覆盖旧证据。CLI 成功仅打印路径与摘要；有 error／warning 仍算导出成功，不触发采集或来源请求。

## CLI 应导出什么

导出一个 JSON 文件即可，不需要导出整库或建设新的问题管理平台。以同一个数据库读快照生成，并明确导出的完整性。

| 内容 | 必需信息 |
| --- | --- |
| 导出身份 | 导出格式版本、时间、代码 commit、数据库 schema／迁移标识、市场数据 revision；不含凭证或用户登录数据 |
| Run | `id`、目标、状态、起止时间、摘要、当前有效计划及阻塞项；运行中的摘要须标明可能过期 |
| 问题范围 | 默认当前计划中每个 `dataset + scope + period` 最近尝试的诊断；记录级、批次级和无 `batchId` 的 Run 级问题分别说明 |
| 有效性说明 | 当前／历史／已被后续尝试替代及依据；成功收据的字段覆盖也须核对，不能仅靠状态判断；Run 级问题无法判定时明确保留为未知 |
| Batch | ID、逻辑键、API、实际请求、日期范围、状态、响应完整性、四类计数和起止时间 |
| Issue | 全字段，包括 `severity`、`reasonCode`、`businessKey`、`field` 和未截断的原始 `payload`；保留冲突双方 |
| 业务表结构 | 仅涉及表的实际 SQLite DDL、列类型、默认值、可空性、主键、唯一约束、索引及必要外键上下文 |
| 当前业务数据 | 受影响业务键的现有完整行、必要的相邻／同事件记录、精确查询范围和匹配数；未入库须明确写出“未找到”，查询不完整须说明 |
| 当前接纳口径 | 相关映射、身份／hash、来源优先级、空值、PIT、warning 规则及代码位置；需插入记录时提供经正式映射计算的候选行与 ID／指纹，不能由 Agent 猜造 |
| 数量核对 | 有效 error／warning、partial／failed 批次及未接纳记录数分别统计；历史诊断单列，不混入待处理数 |

包中不默认包含所有成功批次或无关业务数据；提供足够解释筛选结果的计划与收据事实即可。`payload` 只是来源事实，不等于数据库中已经存在的业务行。导出缺项时，后续补充仍由 CLI 的明确范围查询完成，不退回 Agent 任意 SQL 读库。

## 实现范围

- 入口扩展 `ingestion/cli/data.ts`、`cli/execute.ts`；导出编排和后端专用输入／导出格式 schema 归 Ingestion。
- 业务行上下文由 Market 按明确数据集和业务键查询，使用显式 Prisma delegate；覆盖现有日历、目录、历史名称、股票／ETF／指数日数据、指数成分、财报、指标、分红和 ETF 选取诊断。来源身份不明确或无法定位时输出缺项，不能误称业务行不存在。
- Ingestion 复用当前计划、逻辑键、最近尝试及分红字段收据规则。历史／旧粒度／已替代诊断计数和身份单列。无批次诊断保留并注明是否能判断有效性，不凭文案猜测已经解决。
- 使用独立 CLI 连接和一致查询事务，限制为只读查询；业务数据通过 ORM 读取。实际 SQLite DDL、列和索引等系统元数据使用必要的只读 SQL，不对外开放任意 SQL 查询能力。
- 导出全量原始问题 payload，业务上下文只查询可确定的相关业务键；每项上下文最多返回 5000 行，检测超限并明确 `contextComplete=false` 及原因，不能静默截断伪装完整。缺少定位字段、未知数据集或无法计算正式候选行也明确记录，不猜 ID／hash 或修复值。
- 口径说明包含代码位置和可核实规则；不调用会下载、诊断写入或改变状态的采集准备／写入函数来构造导出。导出 JSON 有独立格式版本，不进入公开 Research SDK。
- 不增加数据库表、迁移、依赖、HTTP 接口、SQL 执行器或自动修复，不修改数据接纳和采集状态，不读取认证表、凭证、策略或用户研究内容。

## 验证与提交

计划提交：`feat(ingestion): export diagnostic bundles for issue repair`。

静态检查：根级 typecheck、改动代码 ESLint／Prettier、依赖边界静态扫描和 diff 检查。产品代码人工审阅通过后，再运行相关测试、构建与隔离库 CLI 验证，通过即按既定流程提交。

行为验证包括：

- 当前计划、最近尝试、已修复旧错误／旧财务粒度、无批次问题，以及分红旧字段成功收据的准确分类。
- 天铁现金金额冲突、科林零／空值差异和 OHLC warning 的完整 payload、业务行、实际表结构及数量核对。
- 请求失败、身份缺失、未知数据集、过多上下文和已变更／未入库业务行均有明确导出状态。
- 单事务一致性、导出不改变业务数据／执行记录／revision、无来源请求、无认证数据或凭证泄露。
- 全量／单 Issue 导出，非法参数、未知 Run／Issue、已有输出文件保护、写文件失败及连接／临时文件清理。
- 审阅后用真实已结束 Run 生成本地诊断包，核对有效 3 条 error、8 条 warning、2 个 partial 和 6 条未接纳；历史诊断单列。本条仅授权导出，不执行修复。

如果实际 schema 与代码不一致，或诊断无法提供必要身份／PIT 证据，导出应标明局限；若需要修改产品接纳语义或扩展持久化模型，再返回范围确认。


## 导出格式与使用说明

CLI 入口 `apps/api/src/ingestion/cli/data.ts` 的注释和 `--help` 均包含命令、参数及示例。`--out` 相对路径按 CLI 工作目录解析，完成后打印最终绝对路径；父目录须已存在。输出先写权限 0600 的临时文件，再排他发布，已有文件不覆盖。导出有数据问题仍返回 0，参数错误返回 2，运行／文件错误返回 1。

JSON 格式为 `jixie-ingestion-diagnostics`、版本 1，主要部分：

| 字段 | 内容 |
| --- | --- |
| `manifest` | 代码 commit 与源码改动标记、导出时间、市场 revision、迁移记录及所导出表的 schema 指纹；Git／迁移信息不可得时明确说明 |
| `run` | 原 Run 事实；运行中摘要标记 `summaryMayBeStale` |
| `selection` | 已保存的有效计划、最近尝试排序及判断依据；批次数不包含其他 Run 复用的成功收据 |
| `counts` | 整个 Run、当前、未知／字段不足、历史、单次选取诊断分别计数；批次未接纳记录另计 |
| `items` | 当前或无法确认有效性的 Issue、完整批次、计划单元和 Market 上下文 |
| `historicalIssues` | 已替代尝试／旧计划单元的 Issue 身份及分类依据，不携带无关历史 payload |
| `tableSchemas` | 涉及表的实际 SQLite DDL、列、索引、主键和外键；不包含认证表 |
| `limitations` | 整包已知局限，单项业务上下文缺项另在 `context.limitations` |

`current` 表示当前计划最近尝试；`superseded_attempt`、`obsolete_unit` 为历史。`run_level_unknown`、`unknown_plan` 和 `incomplete_dividend_receipt` 保留在包内供判断，不冒充已解决。正式补写候选行不会自动生成：当前上下文能说明数据库事实，但修复值、ID／指纹和捕获可得性仍须按实际来源合同确定；`mappedCandidates.available=false` 明示该边界。

业务行中的 DateTime 由 Prisma 读取并在 JSON 中序列化为 ISO 时间；不能把它未经核对当成可直接执行的 SQLite 字面值。`schemaFingerprint` 的范围是已导出的表结构与已应用迁移，单 Issue 和整包可能涉及不同表。

仅查询可以解释的身份；缺少身份、未知数据集或实际业务 schema 不匹配时标注上下文不完整。每项最多定位 100 个身份，每次业务查询最多返回 5000 行；超限提供匹配数量下界与返回数，`matchedCount=null`，不将截断当成“没有其他记录”。完整 Issue payload 仅做凭证脱敏，不按上下文上限截断。


导出 commit 标识当前导出工作区，源码存在未提交改动时会标记；它不冒充历史每次采集尝试的代码版本，现有 Batch 并未保存这种信息。只读保护结束后恢复调用前的连接设置。真实工作库的诊断包已在人工代码审阅通过后生成，验证结果见下文。


首次审阅前静态结果：根级 typecheck（含依赖边界静态扫描与 SDK 生成物一致性）、改动 TypeScript 的 ESLint／Prettier、文档本地链接与代码围栏检查及 diff 检查通过。已准备参数解析、诊断筛选／数量、业务上下文、实际 schema、缺项／上限、只读保护、凭证脱敏、排他文件发布和隔离库 CLI 用例。当时尚未运行行为测试、构建或真实库导出，也未提交；后续验证与修正见下文。已有副本草案和其他工作区文档改动保留。


首次人工审阅后验证：5 个相关测试文件共 28 项用例，23 项通过，5 项因同一元数据 SQL 别名 `notNull` 未引用而失败；完整工作区构建及 36 项后端边界自测通过。现已给元数据查询中的别名统一加双引号，避免 SQLite 关键字冲突，属于产品代码修正。当时按 review-gated-development 返回 Gate 2；修正版重新通过人工审阅后的验证结果见下文。

Prompt 已增加 Agent 自行调用 `data runs`、按指定范围或最新 Run 选择 ID，再调用诊断包导出命令的流程；已有诊断包优先使用。运行中快照、命令版本不足、输出文件已存在等情况均有明确说明，不退回 Agent 直接读库。


## 精简运行目录

用户确认 `pnpm data runs` 仅返回 `id`、`status`、`startedAt`、`finishedAt`，保持 JSON 数组，不再展开 `scopeSnapshot`、`summary` 或其他字段。默认最近 5 条，`--limit N` 允许 1–100，按 `startedAt DESC, id DESC` 排序；未结束的 `finishedAt` 为 null。时间为逻辑 Run 起止时间，JSON 使用 ISO 格式。

命令入口注释、帮助与 Prompt 均同步。Agent 默认用 `runs --limit 1` 选最新 Run，再从导出包取得目标与详情；仅给目标日期但包内目标不匹配时要求明确 Run ID，不根据列表时间猜测目标。本次仍使用原定提交信息，元数据 SQL 引号修正与精简 runs 的实现合并复审并通过验证。


## 最终验证记录（2026-11-04）

- 6 个相关测试文件共 40 项用例全部通过，覆盖真实 CLI 子进程、隔离数据库、有效／历史诊断筛选、实际表结构、业务上下文与上限、凭证脱敏、只读保护及恢复、排他私有文件、数据库路径保护、runs 四字段与数量限制。
- 完整 `pnpm build` 通过；36 项后端边界检查器自测及项目扫描通过，无违规。根级 typecheck、改动代码 ESLint／Prettier、文档链接／围栏与 diff 检查通过。
- 编译后 CLI 对真实已结束 Run `01M6F8ZGFR17X3ZMAX5Z7GD1DY` 完成完整诊断包与科林电气单 Issue 导出。有效诊断为 3 条 error、8 条 warning，历史错误 10 条单列；当前 Run 有效批次 32312，其中成功 32310、partial 2、failed 0、未接纳 6，完整计划 39036 单元，差额为跨 Run 复用收据。
- 包含实际 `Daily`、`Dividend`、`StockBasic`、`StockCodeChange` 及 4 张执行／revision 表的 DDL、列、索引和外键；Daily 为 11 列，Dividend 为 21 列。天铁两种现金金额与科林零／空值冲突的双方 16 字段 payload 均保留；8 条 warning 均定位到已入库 Daily 行，科林对应报告期分红明确为未找到。
- 完整包 11 项上下文均完整，单 Issue 导出只包含该问题但保留全 Run 数量口径；输出权限均为 0600。诊断包不包含认证表，不自动生成正式修复候选行。
- 导出前后，对 Run、37759 条 Batch 尝试、21 条 Issue、market revision、相关 3 条 Dividend 和 8 条 Daily 的只读内容摘要比对全部一致。未启动采集、未请求第三方数据、未执行修复 SQL，也未改变接纳规则。

复审前的失败验证仅为上述已修正的 SQLite 别名问题；最终测试不存在遗留失败。本次真实导出仅验证诊断能力，问题事实仍留待后续 Agent／人工按独立 Prompt 交叉查证。


## 后续问题处理状态扩展

[问题处理设计](ingestion-issue-resolution.md)新增独立处理表与前端可见状态；原导出阶段“不增加迁移／HTTP”的范围仅描述前述 CLI 提交，不限制这个已单独批准的扩展。诊断包保留原采集事实，另附 resolution、handling 和 counts.handling，供 Agent 区分 pending、resolved 与 accepted；不通过重写原 Run 清空问题。
