# 业务执行职责整理

状态：人工代码审查已确认，行为验证与构建通过，按已确认的提交信息交付。

提交信息：`refactor(api): clarify execution roles and naming`

## 最终设计

无状态业务编排使用具名函数，不建立业务基类或统一 Runner/Session 签名。Factor、Research、Agent 保持原目录及接口；Worker 负责消息边界和进程收尾，语言 runtime 负责代码加载与执行。用户确认扫描无需独立 cell 进程，最终结构如下：

| 位置 | 职责 |
| --- | --- |
| strategy/backtests/run.ts | runConfiguredBacktest：准备因子源码、调用模拟并做风险后处理 |
| strategy/scans/run.ts | runStrategyScan：准备一次因子源码，直接循环参数/区间，在扫描 Worker 内串行调用 runSandboxedBacktest 并汇总 |
| strategy/scans/scan.ts | 规格、组合、覆盖值、净值与指标的纯计算；没有执行回调 |
| strategy/scans/worker.ts | 解析输入、调用 runStrategyScan、发送消息、断开 Prisma |
| strategy/scans/job-lifecycle.ts | 普通 Worker + 通用 runWorker，不覆盖 terminate |
| strategy/execution/simulation.ts | 创建策略 runtime 与 FactorHost，初始化并校验因子元数据/冻结血缘，运行 Engine，finally 关闭资源 |
| strategy/factor-inputs/prepare.ts | 权限、发布状态、源码、TS 编译、批准资产范围与组合快照；不启动 runtime |
| strategy/factor-inputs/metadata.ts | 运行定义装配、组合输入/窗口汇总、研究专用字段拒绝；为 Engine 行情加载及报告血缘提供元数据 |
| strategy/factor-inputs/lineage.ts | 从 Signals 原样迁移的冻结血缘解析及比较，比较规则不变 |
| signals/runs/run.ts | 加载部署与运行，将冻结快照交给模拟校验，整理信号及摘要；按部署 locale 翻译错误 |
| signals/runs/worker.ts | IPC 输入与结果、Prisma/IPC 收尾 |

删除初稿全部新增 Runner/Session 类，以及扫描 cell executor、cell worker/boot、cell IPC schema 和 stop 消息。每次模拟都创建自己的 runtime，不跨组合共享策略或因子实例。Signals 部署没有模拟阶段，独立创建一次 FactorHost 做准入并 finally 释放；信号运行在 Engine 开始前严格比较包括 inputs 在内的完整血缘。

## 行为边界与风险

公开 HTTP/SDK、数据库、快照格式、算法、权限、Job 终态与报告事务不变。扫描失败仍整体失败；执行从逐 cell 子进程改成整次扫描共用一个 Worker。正常模拟通过 finally 回收 runtime，任务结束断开 Prisma，异常终止复用普通回测的 Worker 管理。强制终止不承诺执行 finally；连续运行、退出和中断的资源行为必须通过实际入口回归，不能用静态检查代替。

元数据错误在执行初始化时报出。Engine 的国债收益率加载要求、组合输入汇总、研究专用字段拒绝与 Signals 血缘校验保留。没有新增 workspace/package 或跨包构建依赖，API 路径由既有部署规则覆盖，Python 镜像输入不变。

## 审查与验证

按 review-gated-development，产品修改后先执行类型、生成契约、边界、lint/format、diff 和文档链接静态检查，人工审查后才运行测试、构建并提交。

准备的行为回归包括：扫描参数/区间顺序、串行等待、capacity 资金覆盖、sizing 净值、失败停止；prepare 不启动 runtime；TS/Python 模拟初始化一次并复用计算；组合输入、研究字段、Signals 快照及资源释放；真实扫描 Worker 连续执行三个组合并退出（TS/Python 因子），通用生命周期在日志失败时终止扫描线程并等待退出。原 cell 协议测试删除，保留整任务输出校验。

审查通过后运行相关 Engine/Strategy/Signals、Job 生命周期及协议测试，shared/API 构建，并以 JIXIE_TEST_COMPILED=1 验证编译 Worker 入口；部署计划测试和边界检查器自测一并执行。历史已通过结果不能替代本修订验证，临时测试进程与数据库必须清理。

最新静态结果：全仓 pnpm typecheck 通过（838 文件边界扫描、0 violations、生成契约一致），受影响 TS/MJS 的 ESLint/Prettier、git diff --check、文档链接检查通过。apps/scripts 无 cell 子进程或专用控制协议残留引用。日志：/tmp/jixie-scan-single-worker-typecheck.log、/tmp/jixie-scan-single-worker-static.log。该静态检查记录对应审查前状态；人工确认后的结果见下方。

## 人工确认后的验证结果

- 回归：27 个测试文件通过，324 项通过；覆盖 Strategy 准备/模拟/扫描/路由、TS/Python runtime、Engine 因子、Signals、Job 生命周期及协议。
- 原有 accounting/flow.integration.test.ts 默认要求 ACCOUNTING_INTEGRATION=1，1 项保持跳过。本次没有修改会计业务；Signals HTTP 与持久化集成测试已运行并通过。
- 源码 Worker 14 项、编译 Worker 14 项通过；包含扫描同线程连续三个组合（TS/Python 因子）、正常退出、通用生命周期异常终止、正式回测与 Signals 真实入口。测试使用独立 SQLite 并清理，不修改用户数据库。
- 部署计划与后端边界检查器自测 41 项通过；shared/API 构建通过。合计 393 项测试通过，1 项默认跳过。
- git diff --check、文档链接检查通过；进程检查确认本次 Worker、Python 因子和 Vitest 无残留。
- 日志：/tmp/jixie-execution-regression.log、/tmp/jixie-execution-source-workers.log、/tmp/jixie-execution-compiled-workers.log、/tmp/jixie-execution-checker-tests.log、/tmp/jixie-execution-build.log。
- 按人工确认提交 refactor(api): clarify execution roles and naming，不推送。

## 2026-09-24 任务文件命名统一

提交信息：`refactor(api): standardize job lifecycle and worker filenames`。

目录表达业务归属，文件表达局部职责，导出符号保留完整业务语义。Strategy backtests/scans、Factor evaluations/correlations、Signals runs、Research embedded/curator 的七个任务入口统一为 `job-lifecycle.ts`；Scans 和 Signals 的 Worker 文件组统一为 `worker.ts`、`worker.boot.mjs`、既有 `worker-protocol.ts`。注册、启动 URL、测试入口与当前文档同步更新，任务 kind、协议、业务逻辑和导出符号不变。

限定词仅在提供目录之外的职责信息时保留，例如 Market 的 `reference-worker.ts`。不批量缩短其他文件，不要求不同业务复制相同目录，也不改变前端命名约定。历史基线与旧提交记录保留当时路径，当前入口以运行清单为准。

状态：范围与人工代码审查均已确认，静态检查、行为验证和干净构建全部通过，按约定提交。

静态结果：全仓 `pnpm typecheck` 通过（838 文件边界扫描，0 violations，SDK 生成物一致，全部 workspace 类型通过）；变更 TS/MJS 的 ESLint、Prettier 与 `git diff --check` 通过。逐项比对 11 个重命名文件，内容仅改变预期资源路径及启动注释；新增或更新的本地 Markdown 链接目标和两个 bootstrap 源码目标均存在。类型检查日志：`/tmp/jixie-job-filenames-typecheck.log`。

审查后验证：Job 生命周期、输入及 Worker 协议、Research embedded/curator 相关回归；Shared/API 干净编译，并通过既有 Worker 集成测试分别验证源码与编译入口。验证使用隔离数据库，完成后检查临时进程清理。


人工审查后验证结果：

- Job 生命周期、payload、Worker 协议、通用 Worker、Research embedded/curator：6 个文件、105 项通过。
- 真实 Worker：源码 14 项、编译 14 项通过，覆盖启动恢复、TS/Python 回测、扫描连续模拟/异常终止、Signals IPC 与退出；合计 133 项通过，无跳过。
- Shared/API 从空 dist 构建通过，编译输出无退役入口文件，旧构建保存在 `/tmp/jixie-job-filenames-dist-wp5cdi_y`。
- 测试使用隔离临时数据库；测试结束进程检查无 Vitest、Worker 或 Python runner 残留。未启动额外开发服务。
- 日志：`/tmp/jixie-job-filenames-regression.log`、`/tmp/jixie-job-filenames-source-workers.log`、`/tmp/jixie-job-filenames-compiled-workers.log`、`/tmp/jixie-job-filenames-build.log`。


## 2026-09-28 策略执行对象与因子输入统一（审查与验证通过）

计划提交：`refactor(strategy): unify prepared factors and execution ownership`。

当前入口为 `strategy/execution/execution.ts` 的 StrategyExecution：create 启动策略和因子并解析元数据，run 内部调用宿主 Engine，close 幂等释放资源。每个对象只运行一次，调用方使用 try/finally；初始化失败自行清理。Backtests、Scans、Signals 全部迁移，扫描每个参数及样本区间创建独立对象，串行执行。

Strategy 的 factor-inputs 目录更名为 factors。因子准备返回 `StrategyFactor[]` 类实例，执行入口只接收一组 factors，共有字段不再在 module/lineage 中重复。factors/factor.ts 集中因子状态、resolveMetadata、toEngineModule 和 toDependency；resolveAll 匹配整组定义并检查输入准入。原 metadata.ts 及测试并入类和 factor.test.ts。元数据解析返回新对象，不修改扫描多个区间共享的准备对象；Engine 输出配置复制数据，报告输出显式提取血缘，避免持久化源码。数据库准备、纯源码引用提取及快照解析/比较也统一为 StrategyFactor 的静态方法；prepare、references、lineage 生产文件删除，内部准备与规范化辅助实现改为私有方法。数据库与编译器按需加载，纯读取操作保持无数据库副作用。运行 inputs 从 assetSeries 派生。执行对象通过 factorDependencies getter 返回脱离内部状态的来源快照，并保留报告结果中的原有字段。扫描也传入完整因子；扫描汇总及对外报告格式不变。

冻结快照比较由 Signals 负责：部署时比较报告与当前解析结果；运行时先核对部署和运行快照，再核对执行对象的实际血缘。两份快照非空才相互比较，否则选择剩余快照；都缺失时保留跳过比较的旧行为。校验在 try/finally 中、Engine 启动前完成，拒绝时关闭执行资源。执行对象不再接受 factorDependencySnapshots，不包含部署/运行记录规则。

保留来源字段、历史兼容、报告与数据库快照格式。风险分析、利率准入、展示、扫描汇总、信号整理继续由原有业务消费。Engine 算法、语言 runtime、公开 HTTP/SDK、数据库及部署组件边界不变。部署计划测试更新文件路径，现有 API 前缀覆盖新路径，无需修改组件清单。

测试辅助函数放各自 .test.ts，不新增 testing 目录。准备与元数据测试适配合并结构；执行测试覆盖一次性运行、初始化失败与关闭、只读血缘副本；Signals 运行测试覆盖各类快照漂移、空集合和缺省兼容，并验证拒绝时不运行 Engine 且关闭资源。

审查前只运行静态检查；审查通过后运行相关因子准备/元数据/执行、TS/Python、扫描、Signals、源码及编译 Worker 回归和构建，通过后提交，不推送。测试和构建尚未运行，修改未提交。

前一轮静态检查通过：全仓 `pnpm typecheck`（839 文件边界扫描，0 violations；SDK 生成物一致；全部 workspace 类型通过）、受影响 TS/MJS 的 ESLint/Prettier、git diff --check，以及 221 个本地 Markdown 链接。日志：`/tmp/jixie-strategy-execution-typecheck.log`。尚未运行行为测试或构建，等待人工代码审查。

扁平 StrategyFactor 修订后静态检查通过：全仓 typecheck（841 文件边界扫描、0 violations、SDK 生成物一致、全部 workspace 类型通过），受影响文件 ESLint/Prettier、git diff --check 与 223 个本地文档链接。增加投影测试确保报告不包含源码/运行配置、输入来自运行元数据，并保持既有 macro_regime 到 Engine 类型的适配。测试与构建仍未运行，修改未提交。

目录与类修订：所有生产、测试导入和文档链接已迁移到 strategy/factors；StrategyFactor 类不持有 runtime 或数据库资源。增加多次解析和返回配置修改的隔离测试，保留组合窗口、研究输入拒绝和血缘兼容覆盖。提交信息保持 `refactor(strategy): unify prepared factors and execution ownership`；待静态复核和人工审查。

目录与类修订后的静态结果：全仓 typecheck 通过（839 文件边界扫描，0 violations，SDK 生成物一致，全部 workspace 类型通过），受影响 TS/MJS 的 ESLint/Prettier 与 git diff --check 通过。扫描 423 个本地文档链接；本次迁移链接有效，core-business-internal-structure.md 中 5 个历史失效链接在 HEAD 中已存在，未扩大范围修改。行为测试和构建未运行，修改未提交，等待人工代码审查。

模块整体收拢修订：factors 仅保留 factor.ts 一个生产实现，FactorUsage / StrategyFactorInput 类型同文件。单因子与组合的批准资产范围校验复用私有方法；外部调用直接使用 StrategyFactor 静态方法，不保留旧接口或转发层。测试按行为保留四个文件，准备替身改为 spyOn 类的静态方法，保留真实元数据与快照逻辑；新增纯引用/空准备禁止加载数据库及编译器的回归。Signals 的业务快照选择仍由 Signals 自己实现。本次修订需重新通过静态检查并提交人工审查，行为测试尚未运行。

整体收拢后的静态结果：全仓 pnpm typecheck 通过（836 文件边界扫描、0 violations、SDK 生成物一致、所有 workspace 类型通过）；受影响 TS/MJS 的 ESLint / Prettier 及 git diff --check 通过。421 个本地 Markdown 链接中，本次修改引用均有效，仍只有前述 5 个既存历史失效链接。行为测试、构建尚未运行，修改未提交，等待本轮人工代码审查。

测试文件进一步合并：prepare / references / lineage 的测试全部并入 factors/factor.test.ts，保留按行为分组和全部既有断言。准备查询替身仅在准备组重置，无数据库/编译器加载检查先于准备组执行；生产代码未改动。其余文档测试入口同步，行为验证仍等待上一轮产品代码审查通过。

测试合并后静态检查通过：全仓 typecheck（833 文件、0 边界违规、SDK 一致及所有 workspace 类型通过）、factor.test.ts 的 ESLint / Prettier、git diff --check。合并文件保留 26 个用例；未执行行为测试，未提交。


人工审查通过后验证完成，保留用户将回测入口准备结果命名为 factors 的修改：

- 业务与运行时回归：15 个文件、255 项通过，覆盖 StrategyFactor、StrategyExecution、扫描、策略路由、Signals 快照准入与路由、TS/Python 运行及因子隔离。
- 真实 Worker：源码 14 项、编译 14 项通过，覆盖 TS/Python 回测、连续扫描、Signals IPC、异常退出和启动恢复。
- 部署计划：11 项通过。以上共 294 项，无失败或跳过。
- Shared/API 从空 dist 构建通过，编译输出无退役的 simulation / factor-inputs 入口。旧 dist 备份位于 /tmp/jixie-strategy-execution-dist-mlfvjmw5。
- 最终受影响 TS/MJS 的 ESLint / Prettier 与 git diff --check 通过；此前全仓 typecheck、后端边界及 SDK 一致性检查通过。
- 日志：/tmp/jixie-strategy-execution-regression.log、/tmp/jixie-strategy-execution-source-workers.log、/tmp/jixie-strategy-execution-compiled-workers.log、/tmp/jixie-strategy-execution-deploy.log、/tmp/jixie-strategy-execution-build.log。

本次不改变数据库 schema 或公开 SDK。测试使用隔离临时数据库；进程检查未发现 Vitest、Worker boot 或 Python runner 残留，没有启动额外开发服务。按已确认信息提交，不推送；原有未跟踪的 docs/design/engine-refactor-notes.md 不纳入本次提交。


## 2026-09-28 因子宿主与 Engine 输入收敛（待人工代码审查）

计划提交：`refactor(strategy): unify factor hosting around strategy factors`。

FactorHost 从 engine/adapters 移到 strategy/execution，构造函数直接接收 StrategyFactor[]；策略执行和 Signals 部署均不再转换源码模块。删除 CustomFactorModule 与 toEngineModule；StrategyFactorInput 在 Strategy 内定义输入，私有准备方法返回该输入的局部字段，组合组件也使用 StrategyFactor。组件的身份、名称、源码哈希来自冻结组件，批准关系仍由父组合报告承载，不查询当前组件或新增独立批准语义。复制集合与元数据时保留不可变组件实例，避免 structuredClone 丢失类方法。保留用户已改的 fromStrategySource 命名，同步旧测试替身。

EngineConfig 删除 customFactors，只接收 FactorExecutionPort。运行开始读取一次 FactorDefinition[]，再加载行情；辅助历史、单因子/组合 inputs 和批准资产范围从该快照派生。资产序列定义补充可选 assetUniverse，保留单 Panel 因子的批准范围。顶层重复 ID、声明缺失与缺少执行端口在加载数据前拒绝；没有源码配置列表，因此删除与另一份列表的重复一致性比较。计算请求、PIT、标准化/合成、交易与归因算法保持。Signals 冻结血缘准入及报告/数据库/公开 SDK 格式不变，无迁移或新部署组件。

测试随 FactorHost 搬迁，原因子语义/隔离测试使用测试内工厂创建 StrategyFactor；Engine 独立端口测试不导入宿主或用户源码，覆盖元数据先于数据读取、仅凭端口计算、重复/缺失定义、基础面历史及单/组合利率输入。补充单 Panel 资产归因与组合对象复制隔离用例。审查前仅静态检查；审查后运行相关单测、TS/Python/组合集成、回测/扫描/Signals 真实源码及编译 Worker 和 Shared/API 构建，通过后提交，不推送。

审查前静态检查通过：全仓 pnpm typecheck（834 文件、0 边界违规、SDK 生成物一致、全部 workspace 类型通过），受影响 TS/MJS 的 ESLint / Prettier、git diff --check，以及 50 个本地文档链接。日志：/tmp/jixie-factor-host-typecheck.log。测试与构建尚未运行，修改未提交，等待本轮人工代码审查。

审查反馈命名修订：StrategyFactor 的静态 resolveAll 与实例 resolveMetadata 统一改为 withRuntimeMetadata，明确返回带运行元数据的新实例；调用处先读取 factorDefinitions，再生成 factorsWithMetadata。同步执行、部署、测试和当前 README；准入及不可变语义保持。此前执行宿主成员和局部变量已改为 factorHost。其余扫描命名候选未修改。

后续审查修订：删除静态及实例 withRuntimeMetadata 和 factorsWithMetadata 中间对象。StrategyFactor.validateRuntimeMetadata 只校验定义完整性与研究输入准入；toDependency(definition) 结合原因子身份和实际运行 inputs 生成报告快照。StrategyExecution 只保留该快照，Signals 部署直接用该快照核对冻结依赖，不复制或回写 StrategyFactor。测试同步覆盖组合 inputs 去重、缺失定义、研究输入拒绝、定义身份匹配及快照隔离；报告格式保持不变。

移除中间因子副本后的静态检查通过：全仓 pnpm typecheck（后端边界、SDK 生成物和全部 workspace 类型）、本轮四个 TS 文件 ESLint / Prettier、git diff --check。日志：/tmp/jixie-factor-metadata-validation-typecheck.log。行为测试和构建仍未运行，当前修改未提交，等待重新审查。

审查反馈：统一执行返回结构并分离信号业务。当前计划提交更新为 `refactor(strategy): unify factor hosting and execution results`。StrategyExecution.run 与 Engine.runStrategy 始终返回 { result, finalState }；删除重载、captureSignals、runStrategyWithSignals 和 SignalBacktestOutput。retainFinalState 按需保留独立末日快照，包含复权仓位、待执行目标／订单／条件单、对应行情及末日因子观测。Signals/runs/projection.ts 从快照生成真实股数、参考价、条件单信号及模型账户；不访问数据库或重跑策略。回测与扫描取 result，报告／HTTP／数据库格式不变。期货默认执行保持，请求末日状态时明确拒绝；无新部署组件。测试同步迁移并补充 Engine 可选状态与 Signals 投影用例，审查前仍只运行静态检查。

统一结果修订的静态检查已通过：全仓 pnpm typecheck（837 个后端文件、0 边界违规、SDK 生成物一致及所有 workspace 类型通过）、全部受影响 TS/MJS 的 ESLint / Prettier、git diff --check。额外扫描并适配两个不受 TypeScript 覆盖的 .mjs Worker 入口。日志：/tmp/jixie-unified-execution-typecheck.log。行为测试和构建尚未运行，修改未提交；审查后验证因子／Engine 股票 ETF 期货规则、末日状态／Signals 投影、执行资源生命周期、TS/Python、扫描、Signals、源码与编译 Worker、部署计划及 Shared/API 构建。

人工审查通过后验证完成：

- 27 个业务／运行时测试文件、341 项通过，覆盖 StrategyFactor、FactorHost、执行生命周期、Engine 端口与股票／ETF／期货规则、末日状态、Signals 投影与准入、TS/Python、扫描及路由集成。
- 真实 Worker 源码 14 项、编译 14 项通过，包含回测、连续扫描、Signals IPC、启动恢复及错误退出。
- 部署计划 11 项、历史运行时 watch / dynamic 对比 2 项通过。合计 382 项，无失败或跳过。
- 历史基准夹具首次运行暴露旧 FactorHost 路径失效；仅修正测试夹具：空因子宿主引用当前路径，旧墙内 Engine 与旧入口共同固定在 f276bfbd，当前入口提取统一返回值中的 result。修正后所有历史／当前变体的结果哈希一致，原有传输量断言通过；未改生产代码。
- Shared/API 从空 dist 构建通过；旧 dist 备份在 /tmp/jixie-execution-results-dist-cuily7gb。编译输出中旧 engine/adapters/factor-host 已消失，新 strategy/execution/factor-host 存在。
- 全仓类型、后端边界、SDK 一致性、受影响文件 ESLint / Prettier 和 git diff --check 通过；89 个本地文档链接有效。
- 测试使用隔离数据库，未启动额外开发服务；进程检查未发现 Vitest、Worker boot、沙箱或 Python runner 残留，历史基准临时目录已清理。
- 日志：/tmp/jixie-execution-results-regression.log、/tmp/jixie-execution-results-source-workers.log、/tmp/jixie-execution-results-compiled-workers.log、/tmp/jixie-execution-results-deploy.log、/tmp/jixie-execution-results-build.log、/tmp/jixie-execution-results-benchmark.log。

按已确认信息提交，不推送；保留用户原有 runBacktest 重命名及未跟踪的 docs/design/engine-refactor-notes.md，不纳入本次提交。
