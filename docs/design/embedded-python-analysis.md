# Factor / Strategy 嵌入式 Python 分析

> 状态：2026-09-14 规划已提交（`74567ccd`）；Commit 2 已提交（`c883dae3`）；Commit 3 问答持久化已通过人工审查与全部验证，按预告信息提交。嵌入分析 Agent / UI 尚未接入，旧工具尚未退出。
> 本文是[响应式量化研究工作台](reactive-quant-research-workbench.md)的嵌入式分析扩展。
> 现状以代码为准；下文的目标行为、接口和验收项不能当作已上线能力。

## 1. 最初的问题与本次目标

最初的问题是：Screen 移除之后，对话内统计计算工具是否仍有价值，应该由哪个产品场景负责？
代码确认 Factor、Strategy 仍可调用统计和绘图工具。用户在编写因子、策略时需要即时验证数据；这些计算也需要
让用户检查、保存和继续研究。实际使用频率尚未确认，不能用“工具已注册”证明有人使用，也不能用“Screen 已移除”推断无人使用。

本次目标：用户在 Factor、Strategy 中提出分析问题，就地得到表格、图表和解释；计算复用 Research 能力，
结果有固定版本，用户可以从选定结果继续进入可编辑的 Research 文档。

本次统一 Python 执行、数据接口和输出格式，同时保留三种工作方式。无须让每次分析都变成独立研究文档，
也不在 Factor、Strategy 中再建设一套完整 Notebook 编辑器。

## 2. 已确认事实、产品判断与证据缺口

| 已确认事实 | 当前代码证据 | 对规划的影响 |
| --- | --- | --- |
| Factor、Strategy、因子问答仍有统计和图表工具 | [defaultTools](../../apps/api/src/agent/tools/index.ts)、[Factor profile](../../apps/api/src/agent/profiles/factor.ts)、[Strategy profile](../../apps/api/src/agent/profiles/strategy.ts)、[问答 profile](../../apps/api/src/agent/profiles/qa.ts) | 不能因 Screen 移除直接删除其余场景的计算入口 |
| analyzeData 提交 SQL 与 JS/TS，向模型返回有界结果 | [analyze-data.ts](../../apps/api/src/agent/tools/analyze-data.ts) | 保留数据直接进入沙箱、完整明细不进入模型的优点 |
| 旧计算图表保存查询与代码，查看时可以重新计算 | [render-computed-chart.ts](../../apps/api/src/agent/tools/charts/render-computed-chart.ts)、[ChatChart](../../apps/web/src/components/chat-chart.tsx) | 旧卡片需要兼容，不能把重新查询的结果冒充历史快照 |
| Research 分别保存当前 Cell、单次执行、干净全文执行和产物 | [schema.prisma](../../apps/api/prisma/schema.prisma)、[run-cell.ts](../../apps/api/src/research/execution/run-cell.ts)、[run-document.ts](../../apps/api/src/research/execution/run-document.ts) | 复用现有概念；单 Cell 尝试不自动等价于封存研究 |
| 当前 Cell、执行与图片均绑定 ResearchDocument | [共享类型](../../packages/shared/src/research.ts)、[文档管理](../../apps/api/src/research/documents/document-operations.ts) | 需要明确嵌入模式、归属及生命周期，不能只禁用编辑器 |
| FactorReport、BacktestReport 已能进入 Research | [因子报告读取](../../apps/api/src/research/datasets/results/factor-report.ts)、[回测报告读取](../../apps/api/src/research/datasets/results/backtest-report.ts)、[回测提交](../../apps/api/src/strategy/backtest/submit.ts) | 复用报告及其权限，不新建第二套正式报告 |
| 初始调研时只读因子问答没有持久化实体；Commit 3 新增私有持久化路径 | [问答入口](../../apps/api/src/factor/questions/conversations.ts)、[turn runner](../../apps/api/src/agent/turns/run.ts)、[Factor store](../../apps/web/src/complex/factor/factor-store.ts) | 用户与稳定因子身份关联会话，每轮固定报告上下文，刷新恢复；已通过审查与验证 |
| STATS_DOC 服务于 analyzeData，stats.ts 另有业务调用方 | [生成脚本](../../apps/api/scripts/generators/gen-stats-doc.ts)、[统计库](../../apps/api/src/math/stats.ts)、[因子评估](../../apps/api/src/factor/analysis/cross-sectional.ts)、[模拟引擎](../../apps/api/src/engine/simulation/run.ts) | 删除工具及其文档生成链，保留业务统计库 |

产品判断：保留工作台内的即时分析入口，复用 Research 的计算与输出，比继续维护两套分析体验更符合本次目标。
冻结版本用于保护结论依据，不能代替对方法和数据的判断。

待验证假设：各场景的调用频率、分析耗时可接受程度、用户查看代码/历史及进入 Research 的比例。
有安全可读的调用记录时统计工具名、状态、耗时等必要信息；没有可用记录时保留证据缺口，不将没有埋点当作零使用。
本次不新建使用统计后台或跨用户内容分析。

旧工具中的每查询 10,000 行、计算 10 秒、结果 8,000 字符是各自实现中的预算配置，不是端到端服务保证。
SQL 实际取数、计算、持久化及 UI 预览需要分别核对；旧 SQL 的 LIMIT 处理不能直接视为已证明的硬行数边界。
“简单聚合用 SQL、正式检验去工作台”等是提示词指导，不能据此声称自由代码无法自行编写类似计算。

## 3. 产品分工

| 场景 | 用户主要任务 | 分析能力与正式产物 |
| --- | --- | --- |
| Research | 自由组织问题、实验、方法比较和结论 | 可编辑 Markdown / Python、多 Cell 依赖、丰富输出及明确封存的完整执行 |
| Factor | 编写、理解和检验指标或信号 | 对话内检查数据、解释报告；正式代码输出逐资产、逐时点因子值，FactorReport 承担评估 |
| Strategy | 编写仓位与交易规则，检查回测 | 对话内验证数据假设、分析选中报告；正式产物是策略代码及回测报告，当前不以接入实盘为目标 |
| 预设/只读因子问答 | 理解当前因子和报告 | 可做只读嵌入分析，保存私有问答记录，不改公共或已发布因子定义 |

标的查询、覆盖检查和简单聚合仍可直接回答，无须生成 Cell。需要计算或绘图的探索使用嵌入式分析。
正式 IC、分层、衰减、Holdout 和交易模拟复用既有工作台及报告，不另写评估或撮合入口。
Factor 现有受约束探索工具不因本次改动退出；Strategy 回测仍由用户显式发起。

Factor / Strategy 运行时不读取可变的“最新 Research Cell”作为信号或交易依赖。研究转成正式代码时，
仍遵循已有 SDK、编译、验证与交接规则。嵌入分析成功不会自动封存研究、发布因子或启动回测。

## 4. 分析卡、版本与运行记录

三个名称描述用户需要分清的对象，不预设必须增加三张独立表：分析卡聚合一个问题；分析版本保存一版代码、
显式参数和输入范围；运行记录保存执行该版本的一次尝试，包括实际输入、环境、输出或错误。

| 状态或操作 | 目标行为 |
| --- | --- |
| 未运行 | 用户或 Agent 可以修改草稿 |
| 已提交执行 | 固定本次代码、参数和来源；运行中不能改写此次输入 |
| 失败、取消或中断 | 保留记录；成功前允许在同一卡片内修复、重试，历史尝试默认折叠 |
| 第一次成功 | 固定这一版代码和结果；成功要求正常结束、输出通过契约校验并完成必要记录保存 |
| 成功后修改 | 通过“修改并重新分析”派生新版，保留父版本；允许用户直接修改复制的代码 |
| 原代码再次运行 | 新增运行记录，保留原结果，不强制从头生成代码 |
| 后来发现方法错误 | 追加“已纠正”标记及新版链接，不覆盖原代码和结果 |

一次失败也必须有记录。Agent 可以在预算内修复失败，不能因第一版已成功而原地改写它。
终态后的更正标签属于附加说明，不改变已经固定的执行证据。

每条聊天消息的分析卡固定引用当时的版本与运行 ID。用户可以主动查看其他版本；旧文字不能自动配上新版图表。
分析管理视图可以默认展示最新结果。宿主代码或选中报告变化时，旧分析保留并提示来源，不自动重算或替换引用。
普通 Research Cell 保持当前可编辑行为，其历史执行同样不应被覆盖。

## 5. 执行、数据与可信度

### 5.1 共同设施与独立执行

复用现有 Research Python runtime、SDK Contract、数据目录、结果读取、输出契约和渲染组件。
嵌入式是使用模式，代码 Cell 仍为 Python，不增加平行的语言、库清单或 Notebook 引擎。
每次嵌入分析独立执行，不依赖前一个分析留下的变量；需要组合多个实验时进入完整 Research。

数据通过 SDK 从后端进入沙箱。模型接收有界的结果摘要、诊断及精确执行引用；用户读取完整的受控输出。
Agent 写 Python 前仍须查询 runtime 与相关数据能力，不猜测包或 SDK 方法。

资源控制覆盖取数、计算、输入留存、输出及模型观察，不能只限定代码 CPU 时间。具体行数、字节数、时间、
请求次数和取消方式在执行实现的 Gate 1 中列明，沿用现有 SDK / runtime 限制并补齐累计预算，不静默缩短样本。
UI 预览截断需要与参与计算的完整输入区分。

### 5.2 输入与来源

每次执行保存问题、代码、参数、宿主代码快照或 hash、选中报告、数据请求、实际输入、环境和输出。
请求至少保留方法、参数、范围、条数、来源/版本及可用诊断，不能只保存自然语言摘要。

- 已有不可变报告按报告 ID 与内容指纹引用，复用当前用户权限及未揭示 Holdout 保护。
- 可变市场数据保存本次 SDK 实际返回的输入与元数据，受明确的累计存储上限约束。
- 报告引用需要可保留、可读取；若来源删除会破坏留存，应保存当次响应或采用受保护的引用，不能依靠悬空 ID 承诺复现。
- 输入留存超限或失败时记录失败原因，不能把不完整输入的结果标成完整成功。
- 仅保存执行实际使用的输入，不引入全市场数据复制、行情版本库或全局研究档案。

固定代码和数据可以复查计算依据，不证明方法正确，也不承诺任意随机算法跨环境逐位相同。
重新取当前数据属于新的运行，必须显示新的数据时点，不能冒充历史重放。

### 5.3 数据处理和权限

卡片展示可用的来源、请求/实际范围、样本量、频率、复权、币种及缺失/截断诊断。
Agent 说明日期对齐、缺失值和样本筛选方法；平台不能自动识别自由 Python 中所有统计错误。
验证不连续日期、多市场交易日、缺失数值、空样本、常数序列和非有限结果，避免把未定义结果当成零。

权限、冻结、并发冲突、资源上限、SDK 访问和报告保护由后端执行；方法选择及工具用途通过提示词和场景测试约束。
不给嵌入工具正式回测、报告揭示、发布或账户操作接口，同时不把提示词当成任意代码的能力证明。

只读问答和分析归当前用户；复制或公开因子/策略不能附带他人的私有分析和数据。
归档、删除和交接的引用规则随模型实现；删除可编辑副本不得误删仍被引用的原分析证据。

## 6. 用户路径与 Research 交接

| 用户问题 | 发起位置与直接行为 | 后续动作或失败处理 |
| --- | --- | --- |
| “有没有这个标的数据？覆盖几年？” | Factor / Strategy 直接查询覆盖 | 未同步或不受支持时说明缺口，不创建无意义的分析卡 |
| “两个资产的收益相关性随时间怎么变化？” | 当前对话生成 Python，展示滚动图、样本和对齐说明 | 关键日期/口径不清时澄清；成功后换窗口产生新版 |
| “这个因子报告的 IC 为什么不稳定？按年份看看。” | 因子问答固定引用当前 FactorReport，读取已有结果再分析 | 缺报告或明细时说明；需要重新检验则进入正式因子流程 |
| “这次回测的亏损集中在哪些月份？” | Strategy 固定引用当前 BacktestReport，展示分组结果 | 新回测不改变旧分析；改规则后由用户显式回测 |
| “继续比较不同样本和方法，整理结论。” | 从选定版本进入 Research | 创建可编辑文档，带入问题、代码、必要输入及原结果引用 |

明确的只读分析请求允许 Agent 在预算内直接执行。缺少关键范围、需要代理资产或发生实质口径变化时再澄清，
不在每次分析前机械增加一次确认。

“继续到 Research”由用户主动发起，带入选定版本而非可变的最新 Cell；保留原结果的只读来源链接。
新文档可以增加 Cell、修改方法并运行，原分析不变。必要输入随交接保留；修改范围或请求刷新数据时生成新运行，
不能静默使用当期数据替代旧输入。没有封存的完整执行时，不跳过现有正式交接门槛。

嵌入分析不自动出现在普通 Research 文档列表。创建研究副本后，原卡可以打开该副本，来源与副本仍可区分。
普通文档的编辑、删除和运行 API 也不能绕过嵌入版本的冻结规则。

## 7. 模块、接口与配套

| 模块 | 实施范围 |
| --- | --- |
| `packages/shared` | 状态、版本、运行引用、输入元数据及聊天 part；复用输出类型，公开 SDK 变化遵循现有唯一 Contract |
| Prisma | 归属、嵌入模式、版本/来源和输入留存的增量模型；优先复用 Cell、执行与产物，不重建正式报告 |
| `research` | 嵌入入口、执行、输入留存、历史、派生版本和文档交接，沿用 documents / execution / evidence / sdk 职责 |
| `agent` | 上下文绑定的分析工具、按 profile 配置、摘要与运行引用、SSE/持久化 part，清理旧注册 |
| `factor` / `strategy` | 提交稳定宿主身份、代码及选中报告，保持正式计算边界 |
| Factor 问答 | 按用户与因子保存会话及每轮报告上下文，刷新恢复；不写公共/已发布定义或创作消息 |
| `apps/web` | 共用卡片和 Research 输出、编辑/重试/历史/版本提示/交接/恢复，沿用 MobX、Monaco、ECharts 和 i18n |
| `apps/docs` / 内部文档 | 双语操作说明、限制和 SDK 指引；同步职责、工具目录、验收及开发记录 |

接口拟统一位于 `/api/app/research/embedded-analyses`，覆盖创建、读取、草稿修改、执行、派生版本、历史和继续研究。
Commit 2 已实现执行与历史等 12 个接口，继续研究的交接入口属于 Commit 4。权限依据服务端用户与宿主，不相信模型提交的 userId 或报告归属。
物理字段、路由方法与执行预算在对应提交 Gate 1 固定，不由历史设计自动推导。

profile 审计覆盖策略、自定义因子、全部只读问答，以及 Research 生成 Factor / Strategy 草稿等非页面调用方。
没有有效宿主上下文时，不因复用 profile 而获得创建嵌入分析的副作用。

trace 记录分析 ID、版本、运行 ID、状态与耗时，便于后续评估，不新增统计后台。
UI 提供中文/英文，工具说明保持英文，Agent 回复跟随用户语言。公开帮助随可见功能交付，不将待实现操作写成已上线。

## 8. 旧工具退出与兼容

用户明确确认：本次完成后删除 `analyzeDataTool` 和 `apps/api/scripts/generators/gen-stats-doc.ts`。
这两项是交付验收要求，不能只取消注册后留下无调用方的完整实现。

| 内容 | 最终处理 |
| --- | --- |
| `agent/tools/analyze-data.ts` / `analyzeDataTool` | 嵌入路径完整接替后删除实现、注册与专用引用 |
| `renderChart` / `renderComputedChart` | 退出新对话工具注册；保留或提取历史 ChartSpec 所需执行函数 |
| `gen-stats-doc.ts` | 删除生成脚本 |
| `math/stats-doc.ts`、`math/stats-doc-gen.ts`、`math/stats-doc.test.ts` | 删除旧工具专用生成物、生成逻辑和漂移测试 |
| `gen:stats-doc` 命令及脚本目录说明 | 同步删除或更新 |
| `math/stats.ts` 及业务测试 | 保留因子、引擎和审计调用；清理不再适用的工具说明注释 |
| JS 分析沙箱及图表重跑接口 | 历史计算图表依赖的部分继续保留 |
| `sqlQuery`、标的/覆盖/Universe 工具 | 保留简单查询、聚合等职责 |

退出前核对旧 SQL 数据能力与 Research SDK，验证收益相关性、回归、波动率、分位数、滚动序列、财务数据和报告读取。
缺口明确补齐或调整范围，不悄悄减少能力；不通过任意 SQL、Prisma 表名或模型猜测绕过 SDK Contract。

旧 ChartSpec 不伪造冻结输入或历史点位，不批量执行历史查询制造“当时结果”。需要重新查询的卡片标注其行为，
缺数据时诚实反馈。旧设计保留当时决策并标注替代状态；运行期过期注释随代码清理，不误删仍有效的 Universe 等能力。

## 9. 验收与迁移

### 9.1 用户与行为验收

- Factor 对话贯通报告分析、失败修复、首次成功、新版和旧版查看。
- 预设及只读问答刷新恢复；切换因子或报告不混用数据、不修改公共定义。
- Strategy 分析精确指定回测；后续回测或代码编辑不改变旧卡片与解释引用。
- 从选定版本进入 Research，继续编辑运行，原始输入/结果与后续计算可区分。
- 新分析覆盖标量、表格、图表与错误；中文/英文均可完成操作并理解限制。
- 分析成功但 Agent 最后解释失败、取消或断线时，执行仍可找回，不只在最终回复成功后才持久化。
- 重跑、重复提交、并发编辑、取消和进程中断不覆盖旧终态或产生无法识别的重复记录。
- 跨用户访问拒绝，未揭示 Holdout 不可读，普通文档 API 不绕过冻结，发布/复制不泄露私有分析。
- 日期错位、缺失/空样本、常数序列、非有限结果、超时及取数/存储/输出超限有明确反馈。
- 历史 SQL 与计算图表仍可打开，界面区分重新查询与固定结果。
- 有效 profile 不再注册三个旧计算/绘图工具；`analyzeDataTool` 及统计文档生成链确实删除，正式统计库仍正常使用。

### 9.2 验证与发布顺序

按 review-gated-development，每个提交先确认范围及准确提交信息。产品代码完成后先做格式、ESLint、类型、
生成契约一致性、Prisma schema 和架构边界静态检查，再交人工审查；通过后执行相关单元/集成、真实 Python、
隔离数据库、构建及浏览器验收。测试和文档随功能提交；修复涉及产品实现时重新审查再验证。

迁移由 Prisma 生成，不手写历史 SQL；审查前只生成和静态核对，不应用迁移。行为验证使用隔离库及受控模型，
不执行真实供应商同步或付费模型调用。浏览器截图实际查看并展示，验证后清理服务、连接及监听。
未通过或未运行的检查不得写成成功。

API/Web 的新消息和接口需要协调发布；迁移保持旧记录可读，不提前删除旧数据。
不新增部署包或跨包构建依赖；如确需变更，同一变更更新 `deploy/component-impact.json` 及对应部署计划测试。
工具退出以前述新路径、数据覆盖和兼容验证完成为前提。五个提交属于同一交付范围，完整闭环完成后再发布。

## 10. 提交顺序与开发记录

| 顺序 | 提交信息 | 范围与依赖 | 当前状态 |
| --- | --- | --- | --- |
| 1 | `docs(research): define the embedded analysis workflow` | 固化目标、版本、输入、交接、工具退出和验收，修正过期现状 | 已提交 `74567ccd` |
| 2 | `feat(research): add versioned embedded analysis execution` | 契约、迁移、归属、执行与输入、冻结、历史和 API；依赖 1 | 已提交 `c883dae3` |
| 3 | `feat(factor): persist question conversations and report context` | 问答持久化、报告上下文和刷新恢复，为分析提供可靠归属 | 已提交 `d31f048f` |
| 4 | `feat(agent): integrate embedded analysis into factor and strategy` | profile/工具、卡片、修改/历史、Research 交接、双语帮助与端到端验证；依赖 2、3 | 两次审查及最终验证通过，随本变更提交 |
| 5 | `refactor(agent): retire legacy chat computation tools` | 覆盖核对、旧工具及生成链删除、图表兼容和切换回归；依赖 4 | 未开始 |

### Commit 1：规划文档

- 范围：本文、根开发约定、路线图、Research 总体设计和相关旧工具设计的状态说明。
- 交付：供维护者及实现使用的内部规划，不增加 UI、API、数据库模型或运行能力。
- 静态核对通过（2026-09-14）：7 份 Markdown 改动、29 个新增本地链接均有效；五条候选提交信息通过仓库格式检查；`git diff --check` 及新增文档空白/标题/代码块检查通过。
- 现状核对：Factor / Backtest 报告读取、回测创建与最新结果缓存已按代码核对；旧工具设计顶部标注历史及替代计划，产品完成状态未提前改变。
- 行为验证：文档提交不运行应用测试、构建、服务或迁移，不修改公开帮助为尚未实现的功能。
- 审阅重点：首次成功固定版本；每次尝试留存；旧消息固定引用；输入留存范围；工具删除且兼容设施保留。
- 2026-09-14 用户确认文档及预告提交信息，按上述文档检查范围完成本提交；产品实现尚未开始。

若 SDK 缺口需要新增数据域、正式报告语义改变、存量删除破坏证据，或需要新增 Python 包/运行时版本，
在相关 Gate 1 说明并确认，不将范围扩大藏在实现中。实际测试结果和提交进度逐项更新，不提前勾选完成。


### Commit 2：嵌入式分析执行后端

- 预告提交信息：`feat(research): add versioned embedded analysis execution`。用户已确认本提交范围及代码审查；行为验证通过，按预告信息提交。
- 交付：`/api/app/research/embedded-analyses` 下的 12 个接口，覆盖创建/列表、版本读取/修改/派生、提交运行、历史/详情、取消和单条完整输入读取。运行返回 202 及精确 runId/jobId；Agent 工具、消息卡和 Research 交接仍属于 Commit 4。
- 模型：新增 `ResearchEmbeddedAnalysis`、`ResearchEmbeddedAnalysisVersion`、`ResearchExecutionInput`；每版关联一份内部单 Cell 文档，复用 `ResearchExecution`、`ResearchCellExecution`、产物与 Job。宿主标识/快照不通过级联删除绑定，普通 Research 路径排除嵌入文档。
- 事务：提交时留存代码/参数/来源/限制快照并领取 activeRunId；同版 requestId 唯一。成功输出与首次冻结在 Job 完成事务内提交；失败、取消、恢复不会覆盖旧终态。旧聊天后续可固定引用 analysisId/versionId/runId。
- 执行：每次独立 Python 会话，显式 parameters 字典与源码一起传入运行时并分别留存；不改写用户源码，因此保留 Python 行号与 future import 语义。SDK 请求与响应在送入 Python 前保存，统计结果不会因输入留存失败而被标为成功；摘要带条数、SDK 现有诊断/口径及可获得的实际范围。
- 限制：源代码 20,000 字符，parameters JSON 16 KiB，每次 16 个 SDK 请求、参数与响应累计 32 MiB、执行预算 30 秒（排队与最终数据库提交另计）。限制随运行快照保存；沿用现有单次 SDK、连续 Python 执行和输出预算。摘要过大时明确标记预览省略，完整响应仍在预算内保存。
- 来源：支持用户因子、公开已发布因子、数据库内预设及代码模板、用户策略；选中报告验证归属/宿主及 Holdout 状态。来源是当次已保存定义，不冒充尚未保存的编辑器代码；后续接入时需向用户显示这一口径。
- 兼容：普通文档编辑/运行语义不变；其列表、编辑、删除、归档、提案、Agent、固化/正式交接不能操作嵌入版本。旧统计/图表工具保持现状，统计库和 SDK 公开方法没有变更。
- 迁移：增量 SQL 由 Prisma schema diff 生成，增加三表，并按 SQLite 方式重建 Job / ResearchExecution 保留原字段；已在隔离临时库验证全量迁移及旧数据升级保留，未应用至开发或生产数据库。
- 静态检查通过（2026-09-14）：50 个 TS 文件的格式/ESLint、API（直接解析 shared 源码）及 shared 的 noEmit 类型检查、后端边界（0 violations）、三项 SDK/runtime 生成契约一致性、Python AST 语法检查、Prisma schema 校验、迁移 SQL 与 schema diff 一致性及 `git diff --check`。未构建 shared 产物，避免审查前运行构建。
- 2026-09-14 用户确认代码审查后完成行为验证：相关测试共 26 文件 / 204 用例通过（含嵌入执行、迁移、SDK、普通 Research、Curator、Job 和 bootstrap）；重复运行的同一用例不重复计数。真实 CPython 3.13 及全部固定包版本校验通过。
- 验证期间只修正测试夹具：预创建临时 SQLite 文件；Curator 使用当前 Prisma schema 建测试库并补充内部文档排除用例；文档过滤及 Job 注册预期补齐。无产品代码修正。
- Shared、API、sandboxd 构建通过。编译 API 在 production 环境、不启用 development 解析条件，经独立编译 sandboxd 的 Unix socket 连接真实本地 Python，完成 HTTP → Job → 执行 → 输入/图表/冻结持久化；同时验证重复请求、全新环境重跑、权限、取消、启动恢复和报告删除后的已用输入保留。
- 运行验证的边界：sandboxd 使用 local 模式，因此不等于生产 Podman 容器隔离验收；没有请求真实行情、LLM 或执行前端 E2E。本提交没有 UI 改动。测试数据库均为隔离临时库，未应用开发/生产库迁移；临时进程、socket 和数据库已清理。
- 提交前复核：最终 52 个 TS 文件格式/ESLint、API 类型及构建、后端边界与三项生成契约检查、`git diff --check` 均通过。
- 验证日志：`/tmp/jixie-embedded-integration.log`、`/tmp/jixie-embedded-regression.log`、`/tmp/jixie-embedded-regression-retry.log`、`/tmp/jixie-embedded-verification/compiled-smoke.log`；其中初次回归日志保留失败记录，修复后的三组结果见 retry。
- 运行时兼容：API 与 Python 沙箱需协调发布。新增可选能力协商，旧 API 仍接收原有启动响应；新 API 连接旧沙箱时，普通 Research 仍可用，嵌入执行明确失败，不允许沙箱悄悄忽略参数。没有新增 Python 包、公开 SDK 数据方法或跨包构建依赖。
- 当前不更新公开帮助：页面功能尚未交付。API 操作错误已提供中英双语，内部入口说明已同步。


### Commit 3：只读因子问答历史与来源

- 预告提交信息：`feat(factor): persist question conversations and report context`。用户已确认范围、产品代码审查及来源文字颜色修正；必要验证全部通过，按预告信息提交。
- 交付：预设、组合、模板及已发布等只读因子的私有问答，按用户与稳定因子身份保留。每轮选“当前报告”或“仅因子定义”，展示固定来源，刷新恢复并重连后台回答，保留失败/取消/中断状态，支持更早消息分页。
- 模型：AgentConversation 增加 questionFactorKey 和用户/因子唯一索引；AgentTurn 增加 contextSnapshot。来源无级联外键，私有问答不写 Factor.messages，不随因子发布/复制，不加入 SQL 白名单。迁移仅增加两列和索引，由 Prisma 生成；仅在隔离测试库验证，未应用开发或生产数据库。
- 接口：POST `/api/app/factors/questions` 接受 factorKey/message/reportId，GET `/:factorId/questions` 返回消息、activeTurnId/nextBefore。问题最多 2,000 字符；单轮上下文最多 64 KiB，超限拒绝。历史每页默认 40、最多 100 条；模型接收最近 60 条及来源标签。旧 factorName/history 请求要求刷新，旧临时记录不能回补。
- 保存范围：当次已保存的定义/代码、报告摘要、内容指纹与报告代码（如有），不是报告全部明细。只允许当前用户已完成且已揭示的报告；不把快照等同于新检验或完整市场数据复现。普通代码模板和组合沿用其定义来源。
- 前端：来源详情默认折叠，用户展开后可核对提交时的摘要和代码；切换报告不改变旧问题的来源。来源说明继承气泡的文字颜色，代码预览维持自身前景/背景。界面、错误与公开帮助提供中英双语。
- 静态检查通过（2026-09-14）：范围内格式与适用的 ESLint，shared/API/Web 类型检查，后端边界（最终 677 文件、0 违规）、三项 SDK/runtime 生成契约一致性、Prisma schema 校验、迁移 SQL 与 schema diff 一致性、文档链接、提交信息格式及 diff 空白检查。最终范围为 37 个文件。
- 审查后行为验证通过：相关 Factor/Agent 测试共 9 文件 / 106 个不同用例，包含 13 个新增隔离库场景；覆盖提交前保存、报告切换、跨用户/私有数据、Holdout、取消/失败/中断、并发、分页及来源删除。独立升级测试覆盖旧会话/消息/轨迹保留。shared/API/Web 构建通过，Web 保留既有大 chunk 警告。
- 用户指出原浏览器脚本没有围绕真实用户任务组织，随后重写验收：`apps/web/e2e/factor-questions.mjs` 验证“打开历史报告 → 提问理解 Rank IC → 刷新后返回 → 切换报告追问比较”。真实 Web、API、鉴权、Agent、SSE 与独立 SQLite 贯通，只替换外部模型端点；同时检查实际模型请求里的报告/历史、数据库中的两轮消息和调用次数。中英两条完整流程均通过。
- 合成报告包含完整图表/指标；本地模型替身根据实际收到的摘要生成确定回复。主测试验证已有报告的问答链路，不验证因子报告计算或真实模型的分析质量，没有调用真实 LLM、行情或开发数据库。
- `apps/web/e2e/factor-question-recovery.mjs` 单独保留前端状态回归，使用 HTTP/SSE 夹具。9 个独立场景均通过：回答中刷新、报告来源/仅定义、切换因子、供应商失败后重试、取消、断线重连、提交响应丢失、历史分页和创作响应迟到。用户输入均为正常研究问题，故障由测试设施注入。
- 验证期间只修正测试设施：补齐无 User 级联的夹具清理；按实际页签操作；退出测试服务器时清理已完成回答的回放计时器；截图等待编辑器/图表就绪；提交响应丢失时等待维护遮罩恢复与页面自动刷新；86 条消息按每页 40 条实际加载两次。没有弱化产品契约或跳过失败。
- 最终四张主流程截图 `apps/web/acceptance/factor-questions-report-{zh,en}.png` 与 `factor-questions-compare-{zh,en}.png` 已逐张查看，报告图表、回答与折叠来源显示正常。原 `factor-questions-{zh,en}.png` 仅是旧夹具截图，不作为当前验收证据。恢复脚本只输出失败诊断截图，不用于产品展示。
- 最终浏览器日志：`/tmp/jixie-factor-questions-journey-final.log`、`/tmp/jixie-factor-question-recovery-final.log`。后端测试日志：`/tmp/jixie-factor-questions-verification.log` 保留初次夹具失败，修复后的问答测试见 `/tmp/jixie-factor-questions-retry.log`。最终前端构建日志为 `/tmp/jixie-factor-questions-web-build-final.log`。
- 主测试正常退出并确认临时 API/模型端口释放，关闭 Prisma 连接、清理隔离库；另行启动的 Vite preview 已关闭并核对 4179 端口释放。没有应用开发/生产数据库迁移。
- 本提交不接入嵌入分析工具/卡片或 Research 交接，不退出旧工具；这两部分分别由 Commit 4、5 完成。当前问答来源快照不能冒充 Python 输入绑定。后续仍需真正执行 Python，验收输出、首次成功冻结、派生版本和 Research 交接。
- 工作区 maintenance/data-audit.ts 与 data-audit.test.ts 属于无关改动，不纳入本提交。用户确认先完成本需求 Commit 3–5，再开始 DeepSeek V4.1 Flash 迁移；本提交未修改模型配置。


### Commit 4：对话中的嵌入式分析与 Research 接续（2026-09-14）

- 预告提交信息：`feat(agent): integrate embedded analysis into factor and strategy`。用户已确认实现范围及首轮代码审查；已运行下面记录的验证。验收发现的三处产品修正亦已获复审确认，最终验证通过，随本变更提交。
- 当前交付：Factor 草稿、只读因子问答、Strategy 对话接入 `runEmbeddedAnalysis` / `readEmbeddedAnalysis`。页面 profile 不再选择旧临时计算/绘图工具；历史工具代码、统计文档生成链和兼容路由留待 Commit 5 删除/核对。正式因子报告与回测流程保持现有边界。
- 页面默认引用所选已完成报告，可关闭或通过共用 Research 数据目录补充引用；引用以结构化消息保存，不等于已取数。共用选择规则，Research 插入 Python，Factor/Strategy 随问题引用。顺带修正目录生成的部分 Python 变量以数字开头的问题。
- 新卡片和详情显示本次源码/参数/修订、表格/图表/数值、实际 SDK 输入、诊断/指纹、错误、环境与限制；失败可修改，首次成功固定版本，之后修改派生新版。详情选择其他记录不改写原聊天消息；对已改变的旧草稿重跑也按原运行另建版本。
- Agent 工具绑定认证用户及本轮服务端宿主/报告快照，每轮最多四次提交。提交后先将精确 run/version 引用写入 assistant 消息，再等待 Python 和最终解释；完成时合并同一条消息。SSE 实时事件与快照回放均传输已保存引用，取消或错误不丢已提交卡片。历史列表提供额外找回入口。
- Research 接续为一次成功运行创建一个幂等的可编辑副本。默认根据原 SDK 方法、参数和校验和回放留存响应；缺失、歧义或校验失败不会读取当前数据。用户显式切换为当前数据时，更新文档/Cell 修订、标记 stale、关闭解释器；执行快照及 Agent 尝试保留数据模式和原运行来源。原分析不随副本删除，原数据源删除后已留存输入仍可回放。
- 内部迁移 `20260914110000_research_embedded_continuation` 仅增加 ResearchDocument 的来源/幂等键及 ResearchCellExecution 的输入来源字段，由 Prisma schema diff 生成。没有新增公开 SDK 方法、Python 包、SQL 白名单、部署包或跨包构建依赖。API/Web/shared 需要协调更新，迁移未应用到开发库。
- 公开帮助新增中英 `research/embedded-analysis`，并从因子 Agent、回测介绍、数据目录和 Research 记录页链接。说明取数与引用的区别、30 秒/16 请求/32 MiB、冻结与修订、回放和当前数据、预览限制及正式验证边界。
- 准备的验证：扩展真实 Python 集成测试验证继续研究、原报告变更/删除、输入回放与当前模式、指纹校验、私有归属、失败拒绝、提前保存及完成合并；升级测试覆盖旧证据保留；消息/引用和目录契约回归；中英真实 Web/API/SQLite/Python 用户流程 `apps/web/e2e/embedded-analysis.mjs`，包括因子报告→表图与差值→改参数新版→Research 回放→从目录引用另一报告比较→Strategy 已存回测分析。外部模型与报告样本受控，不代表真实模型质量或正式评估器验收。
- 初次交审时未运行行为验证；审查后的实际结果见下文。用户的 maintenance/data-audit 两处修改保持独立。

- 初次交审前静态检查（2026-09-14）：范围内 Prettier 与 ESLint（无警告）、shared/API/Web/Docs 类型检查、后端边界（684 文件，0 违规）、三项 SDK/runtime 生成契约检查、Prisma schema 校验、迁移 SQL 与 schema diff 完全一致、41 个公开帮助链接和 diff 空白检查通过。为避免审查前构建应用，Web 类型检查使用 shared 的临时声明输出；没有启动服务、运行测试、构建应用或应用数据库迁移。


#### Commit 4 首轮验证与复审修正（2026-09-14）

- 用户批准首轮代码审查后，Shared、API、Web、Docs、sandboxd 构建通过；Web/Docs 有大 chunk 警告，Web 另提示嵌入卡片同时静态/动态导入，因此该卡片没有被拆成独立 chunk。没有应用开发或生产数据库迁移。
- 后端相关验证合计 22 文件 / 179 个不同用例通过，前端消息与数据目录共 2 文件 / 16 用例通过。覆盖隔离库升级、旧证据保留、Agent 持久化/恢复、Research 文档和 SDK、真实 Python 输入回放与切换等。重复执行不重复计数；真实 Python 使用项目 CPython 3.13 环境，全部固定依赖版本已核对。
- 首轮测试设施修正：SDK 分派与两个报告 runtime 单测补齐留存输入边界的隔离；Python 断言输出实际错误。最初系统 Python 缺 pandas，后续显式使用项目解释器；报告 runtime 测试的 5 秒默认预算改为 30 秒，容纳固定环境冷启动。未修改生产执行预算或弱化断言。
- E2E 夹具原先误用 Jupyter 的 display()，现按 jixie 的真实输出约定返回 DataFrame 并收集 Matplotlib 图像；值由实际表格结果读取。测试策略 ID 改为接口允许的字母数字；失败日志保留原始错误；清理补充 Python 语言服务 dispose。外部模型仍为受控替身，数据为合成已存报告，没有调用真实模型、同步行情或正式评估器。
- 中英文各一条完整浏览器流程均通过：因子报告计算差值 0.108；修改参数派生新版得到 0.096、原聊天仍显示 0.108；继续 Research 并用原输入重现 0.096；引用另一报告比较得到 0.045；Strategy 已存回测分析得到 0.1。最后一次测试正常退出，并验证 API/模型监听端口释放；另核对没有遗留本轮 Python/浏览器测试服务进程。
- 第一轮十张截图已逐张检查并用于发现下述问题；同名文件后来由最终验收覆盖，当前截图以末尾最终记录为准。
- 截图发现并修正三处产品问题：聊天卡片的小表格不再使用 Research 正文的 720px 最小宽度；继续研究的服务端双语模板采用现有单花括号参数规则；详情取得新运行状态后同步历史列表，避免详情成功、下拉框仍显示运行中。Research 正文与详情表格保留原展示宽度，数据、计算与冻结语义未变。
- 为三处修正补充 E2E 断言：结果列确实位于聊天卡片可视宽度内、历史选项显示最终成功状态、Research 标题与来源没有多余花括号。产品修改后暂停行为验证，等待复审；尚未重新构建或生成修正后的截图。
- 首轮日志：/tmp/jixie-embedded-commit4-tests.log 保留初次失败；修复后的 Python/分派为 /tmp/jixie-embedded-commit4-python-final.log；额外路由/文档回归为 /tmp/jixie-embedded-commit4-regression.log；报告 runtime 为 /tmp/jixie-embedded-commit4-sdk-runtime-final.log；最终浏览器日志为 /tmp/jixie-embedded-commit4-e2e-reviewed.log。首轮已通过不等于最新修正已经完成复验。
- 复审通过后计划：重跑受影响 Python/SDK 测试、Web 消息/目录测试、API/Web 构建及增强后的中英 E2E；核对小表格、最终状态与来源说明的新截图，清理资源，完成提交。提交信息仍为 feat(agent): integrate embedded analysis into factor and strategy。

- 三处产品修正后的静态检查通过：79 个范围内源码/样式文件的 Prettier 和适用 ESLint、API/Web 类型检查、git diff --check。修正后没有运行测试或构建，等待第二次代码审查。


#### Commit 4 最终验证与提交（2026-09-14）

- 用户批准三处产品修正后，API/Web 构建通过；受影响的真实 Python、SDK 分派及两个报告桥接测试共 4 文件 / 17 用例通过；Web 消息及数据目录共 2 文件 / 16 用例通过。与前轮合计的 22 个后端文件 / 179 用例为同一组覆盖，重跑不重复计数。
- 增强后的中英 E2E 全部通过：结果列位于聊天卡片可见宽度内；详情和历史下拉框同步显示成功；Research 新文档标题、运行来源及范围没有多余花括号。原分析、派生新版、另一报告比较、Research 回放和 Strategy 结果保持预期。复验只修正了一处测试选择器（不再依赖旧版 antd 内部 class），未再修改产品行为。
- 本轮十张最终截图已逐张查看，文件为 apps/web/acceptance/embedded-analysis-{factor,version,research,reference,strategy}-{zh,en}.png；旧故障诊断图不是验收结果。浏览器测试正常退出，脚本核对 API/模型端口释放，额外进程核对确认无遗留本轮测试服务或 Python 进程。
- 最终日志：/tmp/jixie-embedded-commit4-reapproved-tests.log、/tmp/jixie-embedded-commit4-reapproved-web-tests.log、/tmp/jixie-embedded-commit4-reapproved-api-build.log、/tmp/jixie-embedded-commit4-reapproved-web-build.log、/tmp/jixie-embedded-commit4-final-e2e.log。首次复验的选择器失败保留在 reapproved-e2e.log，不覆盖为成功记录。
- 首次完整静态检查与复审后受影响的格式、ESLint、API/Web 类型及 diff 检查均通过。构建分包警告如前述。只使用隔离测试数据，未应用开发/生产库迁移、未调用真实模型，也不将受控模型流程视为模型分析质量评估。
- 按已确认信息 feat(agent): integrate embedded analysis into factor and strategy 提交本轮全部 94 个范围内文件；maintenance/data-audit.ts 和 data-audit.test.ts 保持未纳入。下一提交负责旧工具/统计文档生成链删除、历史图表兼容及能力覆盖核对，完成后才启动 DeepSeek 迁移。
