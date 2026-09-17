# 业务输入类型与校验边界

> 后续共享 HTTP 请求契约已完成实现、人工 review 与验证，当前放置规则见 [共享请求契约](api-request-contracts.md)。本文保留前序提交的实施与验收记录。

## 状态与范围

- 2026-09-17：具名类型整理已完成首轮静态检查。人工 review 指出 Strategy Agent 重复解析，用户随后要求全盘扫描校验边界、补充本文并继续同一提交；扩展实现及静态检查完成后，用户确认人工 review。计划中的 15 个测试文件、222 个用例与 API 构建均已通过。
- 准确提交信息更新为：`refactor(api): clarify business input types and validation boundaries`。原消息 `refactor(api): name schema-derived business input types` 仅覆盖最初的类型整理，扩展实施前已告知用户新消息。
- 一个完整提交：保留已完成的 38 个具名类型、47 处参数引用整理，再调整下文确认的重复解析。原类型整理涉及 5 个 `schema.ts` 和 27 个业务实现文件；新增校验边界改动覆盖路由、Agent 工具、Research 数据集及对应测试/说明。
- 交付给后端维护者，无新增用户入口。HTTP 路径、字段、默认值、转换、权限、事务、SDK 与数据库结构保持现状；格式校验按下文移到对应入口，业务规则与持久化数据解码保留。无需迁移、部署依赖调整或产品帮助/i18n 更新。

## 放置与命名规则

类型紧邻对应 schema 导出，业务函数直接引用业务名称，不再展开 Zod 类型表达式。仅用于类型的依赖显式使用
`import type`；真正读取未知数据的边界保留 schema 值导入。schema 是这类参数的结构来源，不再手写一份
相同的 interface，也不另建 `types.ts` 或总 barrel。

- 外部输入由 HTTP、Agent 工具、SDK 适配等入口解析；业务操作接收 `z.output<typeof schema>`，与 `z.infer` 语义相同。
- 确有消费者需要描述解析前输入时使用 `z.input<typeof schema>`；未知数据解码器也可直接接收 `unknown`。不要因为业务函数原来有 `.parse()` 就机械地沿用原始输入契约。
- `Input` 是业务入参名称，不代表一定选择 `z.input`；分页、筛选和查询参数使用 `Query` 后缀。
- 仅在解析前后类型都有显式消费者时分别命名；不机械地为每个 schema 配置两种类型。
- Signals 的 `SubmitSignalRunInput` 由 body 的输出类型与 `{ deploymentId: string }` 组合，保留路由补入部署 ID 的原有契约。

## 类型与消费者

下列 schema 均位于 `apps/api/src/<模块>/schema.ts`；消费者路径相对同模块目录。38 个业务类型全部使用
`output`。类型名跨文件清晰可辨；现有 schema 校验表达式不变，Agent 路径参数 schema 复用既有 ID 字段规则。

| 模块 | schema → 类型 | 消费者 |
| --- | --- | --- |
| Strategy | `codeConfigSchema` → `StrategyCodeConfigInput` | `backtests/submit.ts` |
| Strategy | `createStrategySchema` → `CreateStrategyInput`；`updateStrategySchema` → `UpdateStrategyInput` | `definitions/drafts.ts` |
| Strategy | `strategyVisibilitySchema` → `StrategyVisibilityInput` | `definitions/visibility.ts` |
| Strategy | `backtestStrategyIdentitySchema` → `StrategyBacktestIdentityQuery`；`backtestJobQuerySchema` → `StrategyBacktestJobQuery` | `backtests/submit.ts`、`backtests/reports.ts` |
| Strategy | `scanStrategyIdentitySchema` → `StrategyScanIdentityQuery`；`scanJobQuerySchema` → `StrategyScanJobQuery` | `scans/submit.ts`、`scans/reports.ts` |
| Strategy | `strategyScanParametersSchema` → `StrategyScanParametersInput`；`submitStrategyScanSchema` → `SubmitStrategyScanInput` | `scans/parameters.ts`、`scans/submit.ts` |
| Strategy | `strategyAgentInputSchema` → `StrategyAgentInput` | `agent/turn.ts` |
| Factor | `createFactorDraftSchema` → `CreateFactorDraftInput`；`updateFactorDraftSchema` → `UpdateFactorDraftInput` | `definitions/drafts.ts` |
| Factor | `factorMetadataInputSchema` → `FactorMetadataInput` | `definitions/metadata.ts` |
| Factor | `factorVisibilitySchema` → `FactorVisibilityInput` | `publication/visibility.ts` |
| Factor | `factorCompositeInputSchema` → `FactorCompositeInput` | `composition/operations.ts` |
| Factor | `submitFactorAnalysisSchema` → `SubmitFactorAnalysisInput` | `evaluations/submit.ts` |
| Factor | `factorCorrelationQuerySchema` → `FactorCorrelationQuery`；`submitFactorCorrelationSchema` → `SubmitFactorCorrelationInput` | `correlations/operations.ts` |
| Factor | `factorJobLogsQuerySchema` → `FactorJobLogsQuery` | `correlations/operations.ts`、`evaluations/read.ts` |
| Factor | `factorReportListQuerySchema` → `FactorReportListQuery`；`factorResearchSummaryQuerySchema` → `FactorResearchSummaryQuery` | `evaluations/read.ts` |
| Factor | `createFactorWeatherPinSchema` → `CreateFactorWeatherPinInput` | `weather/pins.ts` |
| Factor | `factorAgentInputSchema` → `FactorAgentInput` | `agent/turn.ts` |
| Factor | `factorQuestionSchema` → `FactorQuestionInput`；`factorQuestionHistorySchema` → `FactorQuestionHistoryQuery` | `questions/conversations.ts` |
| Research | `researchAgentInputSchema` → `ResearchAgentTurnInput` | `agent/turn.ts`，替代同名手写 interface |
| Research | `updateCellSchema` → `UpdateResearchCellInput` | `documents/cell-operations.ts` |
| Research | `curatorFindingUpdateSchema` → `ResearchCuratorFindingUpdateInput` | `curator/feedback.ts` |
| Research | `embeddedCreateSchema` → `ResearchEmbeddedCreateInput`；`embeddedDeriveSchema` → `ResearchEmbeddedDeriveInput`；`embeddedUpdateSchema` → `ResearchEmbeddedUpdateInput` | `embedded/versions.ts` |
| Research | `embeddedRunSchema` → `ResearchEmbeddedRunInput` | `embedded/submit.ts` |
| Research | `embeddedPageSchema` → `ResearchEmbeddedPageQuery`；`embeddedListSchema` → `ResearchEmbeddedListQuery` | `embedded/read.ts`，替代局部 `Page` 及其交叉类型 |
| Research | `embeddedInputModeSchema` → `ResearchEmbeddedInputModeInput` | `embedded/continuation.ts` |
| Agent | `conversationMessagesQuerySchema` → `ConversationMessagesQuery` | `conversations/read.ts` |
| Signals | `submitSignalRunBodySchema` → `SubmitSignalRunInput`（附加部署 ID） | `runs/submit.ts` |

Strategy 与 Factor 共替换 34 处内联 Zod 参数；Research、Agent、Signals 共统一 13 处手写参数。
最初 7 个 input 类型随校验边界调整改为 output。股票池继续使用已有共享契约 `UniverseSpecV1`，不另造同义类型。

## 保留范围与关键契约

- Agent 的 `dataReferences` 在 HTTP 原始参数中仍可省略，由路由解析时的 `.default([])` 补齐；业务调用必须传入解析后的数组。
- Factor 草稿创建的 `analysisKind`、`language` 是解析后的必填字段；相关性查询的 `keys` 已转换为数组，分页限制也已转换为数字并补齐默认值。
- Research Agent 的 `contextCellIds` 与澄清选择的 `selectedOptionIds` 保持解析后的必填数组，未增加二次校验。
- `ActualExecutionUpdate`、Research 公开版本化类型等共享契约保持原位；`ResearchDataCatalogQuery` 的内部字段、可选参数和业务默认值不强行套用 HTTP schema。
- Market、Auth 主要拆成标量参数调用业务，没有新类型消费者；Web、Docs、sandboxd、shared 无本次同类修改。
- 协议、Job payload、LLM 输出、私有工具辅助和泛型辅助的局部推导保持原位，不扩大成全仓类型分层重构。

## 校验边界全仓审查

扫描 `apps`、`packages`、`scripts` 的生产 TypeScript/TSX/MTS/CTS 文件，排除测试、JSON/Date/Monaco 解析和通用
Job 的回调调用，沿 HTTP 校验、Agent 工具、SDK、持久化和进程通信消费者反查。基线找到 **44 个文件、100 处
Zod parse/safeParse 调用**。其中下列 9 处结构解析值得调整；其余是不同数据边界或带兼容职责的解码器，保留。

| 当前调用链 | 判断与本次修改 |
| --- | --- |
| Strategy / Factor Agent：HTTP `validateJson` → `start*AgentTurn` 再 parse（2 处） | 两个函数唯一生产入口均为所属 Agent 路由。移除业务重复 parse；类型改 output。新增 `strategyAgentParamsSchema` / `factorAgentParamsSchema`，复用 input schema 的 ID 字段并在路由 `validateParam`，避免遗漏原完整 schema 对 ID 的检查。归属、draft 状态、运行互斥和报告权限仍归业务。 |
| Factor 问答：HTTP `validateJson(factorQuestionSchema)` → `startFactorQuestion` 再 parse（1 处） | 改接收 output；HTTP 保留默认值、长度限制及数据引用检查。直接调用的并发测试提供解析后的参数，仍验证原有并发契约。 |
| Research embedded：HTTP 已校验 → create / derive / update / submit 再 parse（4 处） | 四个业务入口改接收 output。Agent 工具还会组合模型字段与宿主/报告/版本上下文，因此在工具适配中用对应业务 schema 解析最终组合参数，再调用业务；保留工具最外层未知参数校验及错误反馈。无需新增解析 service 或绕过校验的布尔开关。 |
| `embedded/versions.ts#createVersion` 对已解析 draft 重复 parse（1 处） | 私有辅助直接接收规范化 draft。derive 没有传入新 draft 时会读取 parent 的数据库 JSON；将 `embeddedDraftSchema.parse` 保留在这个回读分支，先检查再创建新版本。不可因删重复校验而放过存储损坏。 |
| Universe：HTTP / Agent 工具已解析 → `executeUniverseSpec(unknown)` → `parseUniverseSpec` 再解析（1 处） | executor 改接收共享 `UniverseSpecV1`；`datasets/spec.ts` 改为 `validateUniverseSpec`，保留未知 measure、重复 select、非数值谓词等业务规则。`datasets/equity.ts` 从 SDK 参数构造另一种 UniverseSpec 时，在构造处用 schema 校验后传入，保留日期和限额等原有防线。 |

移位不是“业务目录禁止 Zod”。内部调用者负责传递符合契约的值；未知数据、持久化 JSON 或协议解码仍需运行时校验。
TypeScript 类型不能证明数据已经校验，也不引入品牌类型或额外抽象来模拟这一证明。

| 保留的解析类别 | 核对的实现及理由 |
| --- | --- |
| 数据库存储 / 冻结快照 | `strategy/definitions/visibility.ts`、`strategy/factor-inputs/prepare.ts`；`signals/deployments/manage.ts`、`signals/runs/signal-worker.ts`；Factor 的 `definitions/catalog.ts`、`composition/operations.ts`、`composition/panel-source.ts`、`publication/factor.ts`、`publication/panel-composite.ts`、`sources/resolve.ts`、`sources/snapshot.ts`。这些读取配置、报告、组合或序列化来源，当前 HTTP 的类型不能证明历史数据有效。 |
| Job payload / 结果 | Strategy backtest / scan、Factor analysis / correlation、Signals run、Research curator / embedded 的 `job.ts`；包括相关性输出字符串的解析。队列持久化与 Worker 返回分别是独立边界。 |
| Factor 版本兼容与规范化 | `factor/execution/spec.ts` 的两个 normalize 函数同时被 HTTP 提交、工具构造、Job、报告回读、holdout 和 evaluator 使用，承担 unknown 解码、旧版协议包裹及默认值补齐。保留当前契约；不以某条 HTTP 链已解析为依据直接删除其公共校验。若继续拆分，需要统一核对历史协议、调用顺序和评估身份，本次不改变这些业务规则。 |
| Python / SDK | `infra/runtime/python/session.ts` 的信封与业务 frame 校验检查不同层次；`research/sdk/validation.ts` 解析各方法参数和返回行；`research/schema.ts` 检查引用的方法/参数。均保留，不能把“frame 已解析”当成“方法参数已合法”。 |
| Agent 工具 | 只读 SQL、因子分析、时间序列分析、数据覆盖、证券/目录/手册搜索、股票池、嵌入分析、Cell 提案和澄清工具仍解析模型生成的未知参数；给模型 JSON Schema 不构成运行时保证。 |
| LLM 输出 | Factor metadata、Research factor/strategy handoff、Curator 候选输出；生成内容必须校验。 |
| 路由与其他 workspace | Market 的 `assetType` 路径解析属于入口。Auth、通用 Agent、Signals 和其余普通 Research 路由未发现同类业务重复 parse；Web/Docs/sandboxd/shared 无本次同类 Zod 迁移。 |

验收重点是外部无效输入仍在副作用前被拒绝，trim/default/strict/大小限制保持有效；业务归属、冻结、修订、互斥及
股票池语义检查仍执行；继承损坏 parent draft 仍失败且不创建新版本。没有权限、持久化模式或部署拓扑变化。

## 验证计划与记录

扫描阶段已对 12 组不同的手写参数候选执行 TypeScript 双向赋值检查，均兼容，未出现 any；分页类型有两个业务消费者，合计覆盖 13 处参数。

人工 review 前仅执行静态检查：

- `pnpm typecheck`：含后端依赖边界、Research runtime/SDK、Factor SDK 生成一致性和各 workspace 类型检查。
- 改动 TypeScript 文件 ESLint（零警告）、Prettier 与 `git diff --check`。
- 逐一比较修改前后参数：仅三个 Agent 入口的 `dataReferences` 从可省略改为必填数组，其余原有参数类型双向兼容；Universe 从 unknown 收窄为共享规格。核对既有 schema 规则不变、新路径 schema 复用 ID 字段、所有生产调用方均履行解析职责。

人工 review 通过后已执行以下回归与 API 构建；涉及数据库的用例使用测试自己的临时数据库并清理连接和目录。
补充的用例覆盖 HTTP 默认值/拒绝、工具组合参数、损坏的继承 draft 和股票池业务语义；不为别名写重复实现的测试。
未启动开发服务或执行 E2E。

```sh
pnpm --filter api test \
  tests/agent-input-boundaries.test.ts \
  src/agent/tools/run-embedded-analysis.test.ts \
  src/strategy/routes/index.integration.test.ts \
  src/strategy/routes/backtest.test.ts \
  src/factor/routes/index.integration.test.ts \
  src/factor/questions/conversations.integration.test.ts \
  src/factor/definitions/metadata.test.ts \
  src/research/routes/index.integration.test.ts \
  src/research/datasets/universe.test.ts \
  src/research/datasets/equity.test.ts \
  src/research/embedded/lifecycle.integration.test.ts \
  src/research/embedded/data-references.test.ts \
  src/research/curator/runs.test.ts \
  src/agent/routes.integration.test.ts \
  src/signals/routes/index.integration.test.ts
pnpm --filter api build
```

- 首轮仅类型整理的历史结果：全仓 typecheck、生成契约、ESLint、Prettier、diff 检查通过；47 处参数双向兼容，32 个文件的可执行 AST 与运行时 import 集合一致。边界扫描 718 个文件、2,722 条运行时边、632 条类型边，0 违规、0 跨域循环组。这些结果不代替下述扩展实现的验证。
- 校验边界扩展后的静态检查：全仓 `pnpm typecheck`（含三项生成契约一致性）、改动 TypeScript 的 ESLint 零警告、Prettier、`git diff --check` 均通过；最终测试代码调整后已重跑 API typecheck 和相关静态检查。边界扫描 720 个文件、2,725 条运行时边、637 条类型边，0 违规、0 跨域循环组。TypeScript 静态对比确认原 47 处参数中 44 处双向兼容；其余三处仅按计划改接收包含默认数组的 Agent output，没有 any。38 个别名均为 output；5 个 schema 文件中既有校验表达式与 HEAD 一致，仅新增两个复用既有 ID 字段的路径 schema。
- 人工 code review：2026-09-17 用户确认通过，授权执行上述验证并提交。
- 行为验证：15 个测试文件、222 个用例全部通过（Vitest 3.2.6，7.57 秒），无跳过或失败。日志中的 Fixture model/provider failure 为失败持久化回归主动注入的预期错误，相应用例通过。
- 构建：`pnpm --filter api build` 通过；验证过程未修改产品或测试代码，无新增迁移、依赖或生成契约变更。
- 交付：本提交包含具名类型、校验边界调整、回归测试及设计/架构/模块说明，提交信息为 `refactor(api): clarify business input types and validation boundaries`；不推送。
