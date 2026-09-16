# 核心业务模块内部结构整理计划

## 状态与目标

- 基线：`fd0ab69f`（`refactor(api): organize business module entry points`）。该轮入口整理已完成，见[记录](core-business-entry-points.md)。其中的验证结果只证明上一轮，不作为本计划的验收结果。
- 当前阶段：2026-09-16 用户确认「定版开工」；方案、提交拆分及准确提交信息已批准。计划已提交 `b3afcbe2`，Factor 已交付 `6947b4e6`；用户追加批准拆分 Factor Job kind，在 Strategy 之前插入一个独立提交，目前实现与静态检查已完成，等待人工代码 review。
- 工作流：review-gated-development；每个实现 commit 先确认范围和准确提交信息，再实现、静态检查、人工代码 review、行为验证、提交。不推送。
- 目标：根据业务问题能够找到实现，目录和文件名称能够说明职责，减少无意义层级；不要求五个核心模块具有相同结构。
- 交付对象：后端维护者与后续开发任务。没有新增用户页面、HTTP 接口或 CLI 命令。

## 1. 为什么要改

上一轮统一了根级 schema、路由入口、Agent 与 Job 归属，但未系统整理内部目录。本轮按“业务流程、状态与产物、实际共享能力”检查五个模块：

| 模块 | 当前证据 | 本轮决策与收益 |
| --- | --- | --- |
| Factor | 正式评估生命周期分散在 `analysis/` 与 `reports/`；评估算法、相关性任务和共享 Worker 又混在 `analysis/`。天气复用评估 Worker，却并不创建正式报告。Python 因子求值、统计评估与报告记录容易被误认为同一件事。 | 以正式评估、相关性、天气三个业务流程组织状态；提取真实共用的执行计算能力，纯来源与指纹独立归属。每个业务明确自己的输入、产物及事务。 |
| Strategy | 回测与扫描已有独立报告和 Job，但完整回测编排位于 `execution/`、回测 Worker 位于 Engine；扫描实际直接调用墙内模拟，并不执行同一套风险后处理。 | 回测编排及 Worker 归入 `backtests/`；真实共用的因子准备归 `factor-inputs/`，风险能力归 `risk/`；保留扫描独立流程及底层 runtime 复用。 |
| Market | 同一数据领域的同步、读取、质量审计分散；外部美债/外汇混在 rates，Signals 的利率输入解析与新鲜度规则也在 Market。反过来，维护所需的日期判断却在 Signals。 | 以数据领域及产物为主聚合同步/读取/审计；基础日历与数据可得性归 Market，消费者的输入要求与准入政策归消费者。 |
| Research | 普通文档、嵌入分析、提案尝试、整理有不同状态与产物。现有 `execution/` 同时放文档运行编排和被 embedded/dependencies 等复用的 Python 会话管理。 | 文档运行归 `document-runs/`，共用 Python 会话归 `runtime/`；embedded/proposals/curator/evidence 等现有业务边界保留。 |
| Signals | 部署、运行、记账和每日流程已有清楚边界；运行 Worker 只服务单次 SignalRun，手动/每日入口最终汇入同一运行流程。 | 保持主体目录与事务。将利率输入及就绪政策收回 `factor-inputs/`，向 Market 让出共用日历能力；不新增 execution/report 层。 |

### 结构取舍

1. Factor 以业务流程及产物归属为主：`evaluations/` 拥有正式评估与报告，`correlations/` 拥有相关性任务与缓存，`weather/` 拥有持续观察。`execution/` 服务已有的跨流程计算复用，不因出现 Worker 就新增执行层；四种评估方法属于计算实现，不分别建立业务生命周期。
2. Market 股指与商品期货共用合约写入和日行情同步实现。整个 `sync/futures.ts` 迁入 `futures/sync.ts`，保留共享实现；商品品种配置、仓单、持仓、carry 等仍在 `commodity/`。不为追求领域独立而复制数据库写入代码。
3. 美债与外汇现在共用按年取数、SSE 可得日映射和结果汇总流程。本轮整体迁入 `cross-market/external-drivers.ts`，不拆成独立同步事务，不改取数顺序、错误或日志语义。
4. `registry/` 继续集中纯静态清单，并接受既有纯依赖门禁；`providers/` 表达数据通道，`instruments/` 表达证券身份。现有 `quality/` 三份实现分别只审计 ETF 或市场风险驱动，因此归回对应领域；整轮发布门禁仍由 Maintenance 组合，不移入数据领域。
5. `questions/` 保留 Factor 私有问答的历史、授权上下文及记录流程。使用 Agent 不等于只能放在 `agent/`；`agent/turn.ts` 继续负责草稿编辑对话启动。
6. 目录名不预设统一执行模型：Strategy 的完整回测编排只有回测使用，归 backtests；Research 的 Python 会话有实际跨流程复用，归 runtime；Signals 手动/每日只是同一 SignalRun 业务的不同发起入口，不另抽一个 execution 业务层。

## 2. 改前、改后目录对比

以下路径均相对 `apps/api/src`。树只展开受影响部分，省略号表示其他文件保持；测试随实现移动，具体拆分见说明。改后路径是批准的实现目标；实际进度见执行记录。

### 2.1 Factor

#### 组织依据：谁发起、计算什么、保存什么

| 业务流程 | 发起与生命周期 | 计算能力 | 持久化产物 |
| --- | --- | --- | --- |
| 正式评估（探索 / holdout） | 提交、校验与冻结、Report + Job 事务、失败/恢复、holdout 资格与揭示 | 共享评估执行入口，按类型选择评估器 | `FactorReport`：研究配置、来源快照、状态、结果和证据关联 |
| 因子相关性 | 选择因子集合、查缓存/活动任务、提交、完成缓存写入 | 相关性算法，复用横截面数据准备与因子序列计算 | `FactorCorrelation` 缓存 + Job，不创建 `FactorReport` |
| 因子天气 | 固定版本、刷新/增量区间、进程内并发控制、启动恢复 | 共享评估执行入口，以固定横截面方法取得按期结果 | `FactorWeatherPin` + `FactorWeatherPoint`，不转成正式报告或通用 Job |

Report 在这里表示可追溯的正式评估记录和结果。Python/TS 因子运行时主要返回因子值，评估器计算统计指标及序列，业务流程决定保存为何种产物。共享类型中既有的 `FactorReport` 也用于表达横截面计算结果，本轮不改公共类型或 Prisma 命名；内部通过返回类型和调用边界区分计算结果与数据库报告记录。

Research 的嵌入式 Python 分析保留自己的版本、执行和产物模型，不并入正式评估，也不自动变成发布证据。

#### 改前

```text
factor/
├── analysis/
│   ├── submit.ts
│   ├── job.ts
│   ├── job-dispatch.ts
│   ├── job-queries.ts
│   ├── factor-worker.ts
│   ├── factor-worker.boot.mjs
│   ├── cross-sectional.ts
│   ├── cross-sectional-evaluator.ts
│   ├── cross-sectional-inference.ts
│   ├── time-series-evaluator.ts
│   ├── panel-evaluator.ts
│   ├── macro-regime-evaluator.ts
│   ├── evaluation-scope.ts
│   ├── policy.test.ts
│   ├── correlation.ts
│   ├── correlation-operations.ts
│   ├── correlation-job.ts
│   ├── correlation-worker.ts
│   ├── correlation-worker.boot.mjs
│   ├── source-snapshot.ts
│   └── sources.ts
├── reports/
│   ├── read.ts
│   ├── views.ts
│   ├── holdout.ts
│   ├── holdout-policy.ts
│   ├── research-policy.ts
│   └── spec.ts
├── weather/
│   ├── pins.ts
│   └── refresh.ts
└── 其他目录与相邻测试
```

#### 改后

```text
factor/
├── evaluations/
│   ├── submit.ts
│   ├── start.ts
│   ├── job.ts
│   ├── read.ts
│   ├── report-views.ts
│   ├── holdout.ts
│   ├── holdout-policy.ts
│   ├── research-policy.ts
│   └── identity.ts
├── correlations/
│   ├── operations.ts
│   ├── compute.ts
│   ├── job.ts
│   ├── worker.ts
│   └── worker.boot.mjs
├── weather/
│   ├── pins.ts
│   └── refresh.ts
├── execution/
│   ├── run.ts
│   ├── worker.ts
│   ├── worker.boot.mjs
│   ├── spec.ts
│   ├── evaluation-scope.ts
│   ├── cross-sectional/
│   │   ├── data.ts
│   │   ├── series.ts
│   │   ├── policy.ts
│   │   ├── evaluate.ts
│   │   ├── evaluator.ts
│   │   └── inference.ts
│   ├── time-series-evaluator.ts
│   ├── panel-evaluator.ts
│   └── macro-regime-evaluator.ts
├── sources/
│   ├── snapshot.ts
│   ├── resolve.ts
│   └── fingerprint.ts
├── jobs/
│   └── read.ts
├── observations/
├── runtime/
└── definitions/、composition/、publication/、agent/、questions/、routes/ 等保持
```

每个树节点表示独立文件或目录，不再用 `/` 分隔同一行的多个文件名。测试跟随所属实现，树中不重复列出。

#### 流程、计算与支撑能力的边界

| 目录 | 拥有的责任 | 不承担的责任 |
| --- | --- | --- |
| `evaluations/` | 正式评估的提交、冻结、任务、报告读取、研究统计及 holdout；Report 是这个业务的证据产物。 | 不实现因子公式和评估算法；不拥有相关性缓存、天气状态或 Research 嵌入执行。 |
| `correlations/` | 相关性业务的完整提交/查询/缓存/Job/Worker 和特有计算。 | 不为复用横截面序列而调用正式评估提交或创建报告。 |
| `weather/` | 天气固定、刷新区间、状态、增量结果及恢复。 | 不借用正式评估的 Report + Job 生命周期，不增加通用 Job。 |
| `execution/` | 可复用的评估计算编排与 Worker；根据 spec 选择数据、运行时和评估器，返回现有结果结构。 | 不创建或更新 FactorReport、FactorCorrelation、天气状态或 Job，不判断 holdout 资格和发布准入。允许经 loader 读取市场数据，不宣称整个 execution 都是纯函数。 |
| `observations/`、`runtime/` | 分别保留观察数据准备与 TS/Python 因子语言执行能力；execution 组合它们。 | 不负责正式报告生命周期。现有类型依赖可保留直接 type import，不引入通用执行框架。 |
| `sources/` | 跨流程复用的来源解析、冻结快照和内容指纹。`resolve.ts` 可查定义及权限；`snapshot.ts`、`fingerprint.ts` 是纯入口。 | 纯入口不通过 resolve/barrel 引入数据库，不依赖 evaluations、correlations 或 jobs。 |
| `jobs/` | 按独立 kind 和报告关系查询归属；数据转换归部署脚本。 | 不新建队列/执行器，不集中业务 Job 生命周期；正式评估和相关性各自的 `job.ts` 仍归业务目录。 |

`jobs/` 只保留两类任务的归属查询，不参与运行分派或数据迁移；API bootstrap 直接注册两类任务。`sources/` 与 `execution/spec.ts` 的纯叶子模块让发布、模板、Strategy 和 Research 消费契约时不必导入任务执行。

#### 关键调用链

```text
正式评估：
routes / Agent 工具
  → evaluations/submit 或既有内部 start 入口
  → evaluations/start（冻结；Report + Job；提交后唤醒）
  → 通用执行器按 factor-analysis 选择任务
  → evaluations/job
  → execution/worker → execution/run → observations + runtime + 评估器
  → evaluations/job.complete（与 Job 终态在原事务内保存 Report）

holdout：
evaluations/holdout（资格、父快照、原 Report + Job 事务）
  → 同一 evaluations/job / execution 计算链
  → evaluations/read、report-views、holdout（封存、日志隐藏、揭示）

天气：
weather/refresh（固定方法与区间）
  → 同一 execution/worker → execution/run
  → weather/refresh（保存天气点与 pin 状态）

相关性：
correlations/operations → Job(kind: factor-correlation) → correlations/job
  → correlations/worker → correlations/compute
  → execution/cross-sectional 的 data 与 series
  → correlations/job.complete（保存缓存）
```

共享评估 Worker 放在 `execution/`，因为它确实被正式评估与天气两条独立流程使用。相关性 Worker 目前只有相关性业务使用，保留在 `correlations/`。Worker 的归属遵循真实复用，不统一塞进某种目录。

`execution/run.ts` 拟提供 `runFactorEvaluation`：接收 factor、source、spec、locale 及日志回调，返回现有各评估类型的计算结果；不接收数据库 reportId、Job 或 Hono Context。从现有 Worker 提取方法选择、因子编译、观察数据装配及运行时释放逻辑，保持执行顺序和异常语义。

Worker 只处理 workerData、日志/结果/error 消息、结果序列化与自身 Prisma 连接收尾。现有消息封套里的 `reportId`（包括天气的 `weather:*` 值）保持原样，仅由 Worker 透传，不进入计算函数或被当作必须存在的数据库记录；不在本次重构中修改 Worker 协议。各类评估原先的 JSON payload 形状保持，不增加统一结果包装。

#### 文件迁移与提取清单

| 原实现 | 目标 | 调整 |
| --- | --- | --- |
| `analysis/submit.ts` | `evaluations/submit.ts` | 保留请求业务校验。 |
| `analysis/job.ts` | `evaluations/start.ts`、`job.ts`、`read.ts` | 分别归属 `startFactorAnalysis` 及其原事务/辅助函数、具名 Job 生命周期、`readFactorAnalysisResult`；导出函数签名与内部 Agent 消费保持。 |
| `reports/read.ts` | `evaluations/read.ts` | 报告/研究统计/任务进度读取同属正式评估；保留所有者校验和 holdout 日志隐藏。 |
| `reports/views.ts` | `evaluations/report-views.ts` | 原投影、payload 解析和封存语义保持。 |
| `reports/holdout.ts`、`holdout-policy.ts`、`research-policy.ts` | `evaluations/` 下同名文件 | 保留探索/holdout 差异及独立提交事务，不为统一 submit/start 强行合并流程。 |
| `reports/spec.ts` | `execution/spec.ts`、`evaluations/identity.ts`、`sources/fingerprint.ts` | 规格规范化与默认值、variant/test 标识、canonicalJson/sha256 分别归属；哈希算法和输入完全保持。 |
| `analysis/factor-worker.ts` | `execution/run.ts`、`worker.ts` | 拆出可调用计算编排，Worker 保留线程协议与收尾。 |
| `analysis/factor-worker.boot.mjs` | `execution/worker.boot.mjs` | 更新源码加载路径。 |
| `analysis/correlation*.ts`、`correlation-worker.boot.mjs` | `correlations/compute.ts`、`operations.ts`、`job.ts`、`worker.ts`、`worker.boot.mjs` | 一一迁移，去掉目录已表达的前缀；完整业务与特有计算保留在一起。 |
| `analysis/source-snapshot.ts`、`sources.ts` | `sources/snapshot.ts`、`resolve.ts` | 纯快照/类型与需要数据库的来源解析保持分离。 |
| `analysis/job-dispatch.ts`、`job-queries.ts` | `jobs/read.ts`；独立部署数据迁移脚本 | Factor 首个提交曾保留 dispatcher；追加提交移除它，改为独立 kind 直接注册、部署转换旧记录并校验类别/所有权。 |
| `analysis/evaluation-scope.ts` 及三个非横截面 evaluator | `execution/` 下同名文件 | 整体迁移，不为每种方法创建任务和报告生命周期。 |
| `analysis/cross-sectional.ts` 及横截面 evaluator/inference | `execution/cross-sectional/` | 按下表拆分/移动，相关性直接消费 data/series，不导入完整 evaluate。 |

横截面内部仍按现有函数职责拆分：

| 文件 | 内容 |
| --- | --- |
| `data.ts` | 调仓日期、价格快照、财报索引/as-of、行业历史及风格控制数据准备。 |
| `series.ts` | 因子序列计算、覆盖审计、历史字段判断和相关类型；调用 TS/Python 因子 runtime。 |
| `policy.ts` | 既有默认策略、策略选择、离群值处理等纯规则。 |
| `evaluate.ts` | `analyzeFactor`、中性化、分组收益、IC/换手及结果装配。 |
| `evaluator.ts` | 原适配类与选择函数，保留方法选择行为。 |
| `inference.ts` | 原统计推断函数。 |

测试按职责跟随：evaluator/inference 测试整体移动；原 `policy.test.ts` 的离群值与窗口覆盖用例分别归属 policy/series；原 `spec.test.ts` 的规格/标识/哈希用例按实际目标归属。补充共享 run 的结果/异常/释放、正式报告与天气不同持久化目标的必要回归；不因只是移动文件添加目录形状测试。

完成后旧 `analysis/`、`reports/` 目录及转发入口不再保留。数据库与 HTTP 仍使用现有 FactorReport、analysis-reports、analysis-jobs 等名称；这是内部职责重组，不进行公开 API 迁移。同步修改 Bootstrap、发布、天气、组合、模板、Agent、Research、Strategy 等直接消费者和 mock 路径，当前 CLAUDE 的旧路径约定随实现更新。

### 2.2 Strategy

#### 业务与产物

| 业务 | 生命周期与产物 | 组织判断 |
| --- | --- | --- |
| 策略定义与 Agent 编辑 | 草稿代码、配置、命名、可见性与对话 | definitions/agent 保留。 |
| 正式回测 | 冻结配置、BacktestReport + Job、模拟结果及风险后处理 | 提交、执行编排、Worker、报告与 Job 应当聚合在 backtests。 |
| 参数扫描 | 冻结网格与样本区间、StrategyScanReport + Job、各 cell 指标 | scans 保留父线程/cell 子进程和特有汇总；不新增逐 cell 正式 BacktestReport。 |
| 因子依赖准备 | 解析声明、检查权限/发布/使用场景、准备可执行模块和血缘 | 正式回测、扫描及 Signals 都使用，独立为 factor-inputs。 |
| 风险研究 | 回测结果的风险附加内容、模型要求、供 Maintenance 组合的就绪判断 | risk 是明确的分析能力，无独立 Job/报告生命周期；去掉空的 analysis 外层。 |

核对后的实际复用关系：只有回测 Worker 调用 `runConfiguredBacktest`；扫描 cell 直接调用 `runWalledBacktest`，Signals 调用 `runWalledSignalCapture`。它们共用 `prepareStrategyFactors` / `prepareCustomFactors`、语言 runtime 与 Engine 模拟核心，不能因目录整理把完整回测及风险后处理强加给扫描或信号。

改前：

```text
strategy/
├── backtest/
│   ├── submit.ts
│   ├── reports.ts
│   └── job.ts
├── execution/
│   ├── run-configured.ts
│   └── prepare-factors.ts
├── analysis/
│   └── risk/
├── scans/
├── runtime/
└── 其他目录
engine/
├── backtest-worker.ts
└── backtest-worker.boot.mjs
```

改后：

```text
strategy/
├── backtests/
│   ├── submit.ts
│   ├── reports.ts
│   ├── job.ts
│   ├── run.ts
│   ├── worker.ts
│   └── worker.boot.mjs
├── scans/                  # 提交、报告、Job、父 Worker 与 cell 子进程保持
├── factor-inputs/
│   └── prepare.ts
├── risk/                   # 原 risk 全部实现与测试
├── runtime/                # TS/Python SDK、编译、墙内执行与宿主桥
└── definitions/、agent/、routes/ 等保持
engine/                     # 保留模拟核心及宿主适配器
```

| 原路径 | 目标路径 | 保持的契约 |
| --- | --- | --- |
| `strategy/backtest/` | `strategy/backtests/` | 提交事务、配置缓存、报告/任务分离和所有导出函数。 |
| `strategy/execution/run-configured.ts` | `strategy/backtests/run.ts` | `runConfiguredBacktest` 签名、语言分派、风险错误仅记日志、资源释放。 |
| `engine/backtest-worker.ts`、`backtest-worker.boot.mjs` | `strategy/backtests/worker.ts`、`worker.boot.mjs` | 消息/日志协议、参数、源码与生产入口及数据库收尾。 |
| `strategy/execution/prepare-factors.ts` 及测试 | `strategy/factor-inputs/prepare.ts` 及测试 | research/deployment/signal 使用场景、权限、归档因子与冻结血缘规则。 |
| `strategy/analysis/risk/` | `strategy/risk/` | 算法、阈值、报表结构及 Maintenance 审计接口。 |

迁移后删除空的 `strategy/execution/`、`analysis/` 和旧 backtest 目录。HTTP 的 `routes/backtest.ts`、接口地址、函数名和 Job kind 保持；扫描不更换执行路径，Engine 核心不迁入 Strategy。回测 Worker 本来就是调用 Strategy 编排的宿主入口，此次归回唯一使用它的回测业务。

### 2.3 Market

#### 围绕数据领域与数据产物组织

Market 的产物主要是可查询、有来源与可得时间的数据集，以及派生市场状态。它不需要仿照 Factor 增设 report 或通用 execution 目录。

| 能力 | 归属与产物 |
| --- | --- |
| 股票、ETF、指数、期货、财报、利率、宏观、商品 | 对应领域负责来源映射、同步写入、读取及本领域质量审计；产物是行情、财报版本、曲线、宏观发布等记录。 |
| 市场状态、估值 | state/valuation 各自聚合派生数据、纯计算与读取；跨资产风险驱动仍归 state。 |
| 联合跨市场数据流程 | cross-market 聚合基准同步、换汇转换、美债/外汇联合获取及其 PIT 规则；纯静态清单仍在 registry。 |
| 日历、身份、供应商、跨资产序列 | calendar/instruments/providers/queries 是有实际共用含义的能力，不强塞进单一资产类型。 |
| 整轮发布与业务准入 | Maintenance 组合发布门禁；Strategy/Signals 分别决定模型历史要求、信号输入与新鲜度政策。Market 提供事实与基础质量，不持有消费者生命周期。 |

改前：

```text
market/
├── sync/
│   ├── stocks.ts
│   ├── stock-daily.ts
│   ├── stock-flows.ts
│   ├── etf.ts
│   ├── etf-history.ts
│   ├── indices.ts
│   ├── futures.ts
│   ├── calendar.ts
│   ├── market-indicators.ts
│   └── cross-market-benchmarks.ts
├── queries/
│   ├── instrument-series.ts
│   ├── index-series.ts
│   ├── stock-codes.ts
│   └── cross-market-benchmarks.ts
├── quality/
│   ├── etf-history-coverage.ts
│   ├── etf-registry-audit.ts
│   └── market-risk-drivers.ts
├── rates/
│   ├── external-market-drivers.ts
│   ├── signal-readiness.ts
│   └── 国债、信用曲线等
├── state/、valuation/、fundamentals/、macro/、commodity/
└── registry/、providers/、instruments/、cli/、routes/ …
```

改后：

```text
market/
├── stocks/
│   ├── basic-sync.ts
│   ├── daily-sync.ts
│   ├── flows-sync.ts
│   └── read.ts
├── etfs/
│   ├── sync.ts
│   ├── history-sync.ts
│   ├── history-coverage.ts
│   └── registry-audit.ts
├── indices/
│   ├── sync.ts
│   └── read.ts
├── futures/
│   └── sync.ts
├── calendar/
│   ├── sync.ts
│   ├── read.ts
│   └── sse-close.ts
├── cross-market/
│   ├── external-drivers.ts
│   ├── benchmark-sync.ts
│   └── benchmark-conversion.ts
├── queries/
│   └── instrument-series.ts
├── state/
│   ├── sync.ts
│   ├── market-risk-driver-quality.ts
│   └── 原 compute/read/weather/market-risk-drivers 等文件
├── rates/
│   ├── government-yield-availability.ts
│   └── 原国债、信用曲线等能力
├── valuation/、fundamentals/、macro/、commodity/
└── registry/、providers/、instruments/、cli/、routes/ …
```

迁移明细：

| 原路径 | 目标路径 | 处理方式 |
| --- | --- | --- |
| `sync/stocks.ts` | `stocks/basic-sync.ts` | 整体移动，股票名录及历史身份同步语义保持。 |
| `sync/stock-daily.ts` | `stocks/daily-sync.ts` | 整体移动，保留日行情/复权/基础指标/涨跌停的四表发布门禁。 |
| `sync/stock-flows.ts` | `stocks/flows-sync.ts` | 整体移动，保留资金流及龙虎榜职责。 |
| `queries/stock-codes.ts` | `stocks/read.ts` | 保留 `stockCodesWithDailyData`。 |
| `sync/etf.ts` | `etfs/sync.ts` | 保留按交易日发布、校验与修订刷新。 |
| `sync/etf-history.ts` | `etfs/history-sync.ts` | 保留按证券回填历史的不同断点规则，不与每日同步合并。 |
| `sync/indices.ts` | `indices/sync.ts` | 保留指数、权重、估值与申万行业相关同步。 |
| `queries/index-series.ts` | `indices/read.ts` | 保留 HTTP 所用精简价格序列；不替换为通用 instrument 响应。 |
| `sync/futures.ts` | `futures/sync.ts` | 保留股指/商品共享持久化逻辑、主力映射和结算。 |
| `sync/calendar.ts` | `calendar/sync.ts` + `calendar/read.ts` | 分别放 `syncTradeCal` 与 `getOpenDates`，函数体保持。 |
| `sync/market-indicators.ts` | `state/sync.ts` | 保留 SQL 批量派生与事务，不合并到纯 `state/compute.ts`。 |
| `sync/cross-market-benchmarks.ts` | `cross-market/benchmark-sync.ts` | 保留注册落库、来源和分段同步。 |
| `queries/cross-market-benchmarks.ts` | `cross-market/benchmark-conversion.ts` | 当前导出为基准人民币价格及汇率转换函数；新名字说明实际职责，保留纯计算属性。 |
| `rates/external-market-drivers.ts` | `cross-market/external-drivers.ts` | 原联合同步、解析、常量、PIT 规则整体移动；相邻测试跟随。 |
| `quality/etf-history-coverage.ts` 及测试 | `etfs/history-coverage.ts` 及测试 | 按证券、日期和复权的历史覆盖检查保持。 |
| `quality/etf-registry-audit.ts` | `etfs/registry-audit.ts` | 注册表、基准、生命周期及历史覆盖审计保持；仍消费纯 registry。 |
| `quality/market-risk-drivers.ts` | `state/market-risk-driver-quality.ts` | 保留基础覆盖/血缘/缺失检查；模型样本要求仍归 Strategy，整体报告仍归 Maintenance。 |
| `rates/signal-readiness.ts` 中利率可得性查询 | `rates/government-yield-availability.ts` | 新内部入口 `loadGovernmentYieldAvailability(requiredTerms, tradeDate)` 接受期限及日期，返回可得日期事实；不接受 FactorDependency、不决定 14 天准入政策。 |
| `rates/signal-readiness.ts` 中输入解析与信号准入 | `signals/factor-inputs/rates.ts`（相对 API src） | 保留既有三个业务函数及 14 天常量，查询委托给 Market；原纯规则测试跟随。 |
| `signals/runs/readiness.ts` 中共用日期判断（相对 API src） | `calendar/sse-close.ts` | 移入 `latestCompletedTradeDate`、`isCompletedShanghaiDate` 及所需时钟辅助；Signals 与 Maintenance 直接引用。 |

迁移完成后删除空的 `market/sync/`、`quality/` 和旧 `rates/signal-readiness.ts`，不留兼容入口。`queries/instrument-series.ts` 面向多个资产类别的统一序列读取，继续保留；不因目录只剩一个文件而把跨资产查询硬塞进某个资产领域。

日历提取保留原上海时区、SSE 日历与 **16:00** 当日截止判断。这个门槛是现有应用的日期可用规则，不在本轮改成交易所实际收盘时间，也不泛化到所有市场；因此使用明确的 `sse-close.ts` 名称。

利率查询保留当前逐期限 findFirst、`availableDate <= tradeDate`、排序和缺失处理；14 天规则、依赖输入解析和无利率依赖时直接通过的行为归 Signals。仅提取内部数据接口，不改 Research SDK 或数据库字段。对应 Signals 与 Maintenance 的适配随同本次 Market 提交，不留下临时反向依赖。

这里的 `futures/` 是完整的共享期货同步能力，与 Strategy 仅起包裹作用的 `analysis/` 不同。商品专属能力仍在 `commodity/`，静态基准清单仍在 `registry/cross-market-benchmarks.ts`。

### 2.4 Research

#### 业务与产物

| 业务 | 状态与产物 | 组织判断 |
| --- | --- | --- |
| 文档/Cell 编辑 | 可变内容、修订号、依赖关系、stale/blocked 状态 | documents/dependencies 保留，不按技术层合并。 |
| 文档运行 | 单 Cell、受影响分支、全文、提案尝试；Cell 输出与执行记录，干净全文执行产生可固化证据 | 当前 execution 中的业务编排明确命名为 document-runs；保留共同锁和中断路径。 |
| 嵌入式分析 | 分析版本、参数、输入留存、运行记录、首次成功冻结、取消与继续研究 | embedded 保留完整流程和 Job，不改成普通文档运行。 |
| Agent 提案/审阅/尝试 | 修改提案、接受/撤销、attempt 与澄清记录 | proposals 保留；接受与执行继续是分开的用户动作。 |
| 证据与交接 | 快照、产物、固化资格、来源血缘及 Factor/Strategy 草稿关联 | evidence/handoff 保留；嵌入运行不因此获得普通文档固化资格。 |
| 研究整理 | CuratorRun、证据提取、去重后的 findings 与反馈 | curator 保留自己的提交、Job 和结果，不能仅因使用模型就并到 agent。 |

Research 的 `evidence/` 有独立固化/交接用途，还提供普通文档与嵌入分析共用的图片产物、指纹能力；不能机械照搬 Factor 将整个目录并进某一个运行流程。当前共享 ResearchExecution 表也不意味着普通文档、嵌入分析可以合并状态机。

改前：

```text
research/
├── execution/
│   ├── run-cell.ts
│   ├── run-document.ts
│   ├── run-affected.ts
│   ├── run-attempt.ts
│   ├── execute-plan.ts
│   ├── run-result.ts
│   ├── run-state.ts
│   ├── control.ts
│   ├── python-session.ts
│   ├── python-session.test.ts
│   ├── python-capabilities.test.ts
│   └── 其他相邻测试
├── embedded/
├── evidence/
└── 其他业务目录
```

改后：

```text
research/
├── document-runs/
│   ├── run-cell.ts
│   ├── run-document.ts
│   ├── run-affected.ts
│   ├── run-attempt.ts
│   ├── execute-plan.ts
│   ├── run-result.ts
│   ├── run-state.ts
│   ├── control.ts
│   └── 文档执行的相邻测试
├── runtime/
│   ├── python-session.ts
│   ├── python-session.test.ts
│   └── python-capabilities.test.ts
├── documents/
├── dependencies/
├── embedded/
├── proposals/
├── curator/
├── evidence/
├── handoff/
└── agent/、sdk/、datasets/、catalog/、language/、templates/、routes/ 等保持
```

`execution/python-session.ts` 及两份直接测试移入 `runtime/`，execution 其余文件整体迁入 `document-runs/`。这是目录与引用变化，不重写会话管理或文档运行函数。旧 execution 不留转发，确保调用者仍使用同一个 `researchRuntimeManager` 实例。

共同能力按实际调用关系保留：

```text
普通文档运行 / 提案尝试 → document-runs → runtime/python-session
嵌入分析的 Job          → embedded/execute → 同一 runtime/python-session
依赖分析               → dependencies/analyze → 同一 runtime/python-session
文档删除 / 归档 / 接续  → 既有调用点关闭同一 runtime 会话
```

runtime 持有会话、串行请求、能力协商、SDK 数据交互与进程通信；document-runs 持有文档运行锁、修订检查、写回和中断业务；embedded 持有独立的超时/取消/版本冻结。保留现有 session key、并发上限、输出限制、执行顺序和收尾。

`sdk/` 是 Python 数据请求协议与分派，`datasets/` 是公开列映射，`catalog/` 是语义检索；它们不因同为“数据”而合并。`language/` 的 Pyright 服务、`datasets/results/`、`templates/fcff/` 均保留当前明确职责。没有新增 Research Worker 或将文档运行改成 Job。

### 2.5 Signals

#### 主体结构合理，调整与 Market 之间的职责

| 业务 | 状态与产物 | 目录 |
| --- | --- | --- |
| 启用/暂停部署 | 从回测报告冻结的策略配置与因子血缘，部署状态 | deployments |
| 生成一次信号 | SignalRun、Job、信号指令、模型持仓与因子输入摘要 | runs |
| 记账与对账 | 模拟/人工成交、账户基线、逐日快照与差异 | accounting |
| 每日批次 | 准备部署所需数据、结算、遍历部署并调用已有单次运行 | daily |
| 因子输入约束 | 冻结血缘、输入摘要，以及由部署决定的利率输入与就绪要求 | factor-inputs |

手动提交和每日调度最终都调用 `runs/enqueue.ts`，复用同一 SignalRun + Job 流程；它们只是不同发起入口。`runs/signal-worker.ts` 只服务该运行流程，因此保留在 runs，不新增 execution 目录。`accounting/replay.ts` 虽然是纯计算，也只服务记账，继续跟随 accounting。

改前、改后的主体目录相同，局部变化如下：

```text
改前 signals/
├── runs/
│   └── readiness.ts            # 日期判断、信号日历、基础数据就绪
├── factor-inputs/
│   ├── lineage.ts
│   └── summary.ts
└── deployments/、accounting/、daily/、cli/、routes/ 等

改后 signals/
├── runs/
│   └── readiness.ts            # 保留信号日历与基础数据就绪，日期判断调用 Market
├── factor-inputs/
│   ├── lineage.ts
│   ├── summary.ts
│   ├── rates.ts                # 从 Market 迁回依赖期限解析和信号利率准入
│   └── rates.test.ts
└── deployments/、accounting/、daily/、cli/、routes/ 等保持
```

`latestCompletedTradeDate` 和其上海/SSE 日期辅助迁入 Market 的 `calendar/sse-close.ts`；`signalCalendar` 的状态返回和下一交易日要求继续归 runs。利率输入/新鲜度政策归 `factor-inputs/rates.ts`，基础可得性查询归 Market。两项调整在同一个 Market 提交中完成，避免独立提交只搬一半边界。

Signals 的通知继续归 `runs/notifier.ts`；afterCommit 初始化记账再通知的顺序及其事务外行为保持。`daily/sync.ts` 读取 active 部署来决定所需数据，是 Signals 的需求编排；具体数据同步委托 Market，不能把部署需求逻辑搬进 Market。整轮维护等待/发布协调继续归 Maintenance，不改为 Signals 或 Market 的总调度器。

## 3. 预计 commit 数量与交付范围

预计 **6 个 commit：1 个计划文档 + 5 个实现提交**。用户追加批准在 Factor 与 Strategy 之间拆分 Factor Job kind。Factor、Strategy、Research 各自完成完整业务边界调整，Market 与 Signals 的相互归属修正在同一提交完成；不为 Signals 主体目录制造无实质改动的提交，其余实现边界保持。

| 顺序 | 准确提交信息 | 完整交付范围 |
| --- | --- | --- |
| 1 | `docs(architecture): plan core business internal structure cleanup` | 本计划文档；确认问题、目标目录、提交边界和验收。已提交 `b3afcbe2`。 |
| 2 | `refactor(factor): organize evaluation workflows and execution` | 正式评估/报告/holdout 归位、相关性独立、天气共享 execution、来源/指纹与旧 Job 协议适配、横截面职责拆分；所有消费者、测试/mock/Worker 路径和当前文档同步。 |
| 3 | `refactor(factor): split analysis and correlation job kinds` | 两类任务直接注册与创建/查询、部署时分批转换旧记录、移除 dispatcher 和新 payload.task；同步测试与文档。 |
| 4 | `refactor(strategy): align backtest and factor input ownership` | 回测编排及 Engine 中的回测 Worker 归 backtests、共享 factor-inputs、risk 提升、所有调用方/测试/运行路径和当前文档。 |
| 5 | `refactor(research): separate document runs from Python runtime` | document-runs 与共用 runtime 归位，普通文档/embedded/dependencies/proposals 等引用与单例保持；测试、当前文档与运行入口同步。 |
| 6 | `refactor(market): align data domains and consumer boundaries` | Market 迁移表全部完成，含领域质量归位、与 Signals 之间的日历/利率职责提取、维护与 CLI 引用、测试和当前文档；完成最终组合验收并更新本文。 |

每个实现提交独立满足静态检查、review 和相关行为验证，不把已知必需的引用修复或验证留到下一提交。本文随对应实现记录实际 review、命令、结果、限制和 commit hash；计划里的检查项不预填“通过”。

### 影响范围与约束

- 产品代码涉及五个核心模块；Signals 主体布局保持，只调整两项与 Market 的既有职责。Engine 只迁出回测宿主 Worker 及 boot 文件，不调整模拟核心/适配器结构；其他模块、`apps/api/scripts`、`apps/api/tests`、Bootstrap 限于直接依赖路径、测试替身与必要调用适配。
- 当前文档同步包括根 `CLAUDE.md`、受影响模块 README、`docs/backend-architecture.md`、`docs/backend-runtime-entries.md`，以及确实引用受影响入口的命令文档；历史设计记录保留当时路径，不全仓替换历史。
- 不改变数据库模型、公开 SDK、HTTP 地址/响应、权限、报告/缓存标识、CLI 命令和参数。用户追加批准的 Factor Job 提交是唯一存储协议例外：拆分 kind、新 payload 移除 task，旧记录由部署转换保留；没有表结构 migration。其余提交不改变 Job kind/payload。
- 不改变数值算法、默认值、样本/PIT/费用口径、事务边界、Worker 协议、同步并发/顺序、恢复和资源收尾。
- 不引入 service/repository 框架、公共 `utils` 容器、总 barrel 或旧路径转发。
- 不增改可部署 workspace/package 或跨 package 构建依赖，因此不需要修改 `deploy/component-impact.json` 及部署规划测试；若实际方案触及这些条件，必须重新确认范围并同步修改两者。
- 不新增用户能力，预期无需更新帮助、公开 SDK 文档和中英 UI 文案。若实现发现需要改变用户可见语义，应返回计划评审，不能按“顺手修复”纳入。

## 4. 验收

### 4.1 每个实现提交：人工 review 前的静态验收

1. 检查实际 diff 与迁移表：旧入口移除、目标文件与消费者一致，测试与实现归属对应，不遗留 mock、动态 import 或 Worker URL 的旧路径。历史记录中的旧路径单独辨认，不当作运行残留。
2. 对移动文件核对导出与函数体；Factor 拆分核对函数、常量、默认参数和私有辅助依赖。允许必要的新模块内导出，不以重构为由改算法或业务错误。
3. `pnpm typecheck`：按当前脚本包含全 workspace 类型检查、后端边界扫描和 Research runtime/SDK、Factor SDK 生成契约一致性；不执行行为测试。
4. 改动源码/测试/脚本执行 ESLint（零警告）和 Prettier 检查；文档检查本地链接、目录树/迁移表一致性及 `git diff --check`。
5. 静态核对 `.boot.mjs`、`new URL(..., import.meta.url)`、编译 `.js` 目标及源码 development 条件。实际启动留到 review 后。
6. 不新增跨业务运行时循环，不放宽后端边界门禁。特别核对 composition 对 Series 的引用保持类型边，Market 不反向依赖消费者，纯来源快照和 registry 不引入数据库/Job。
7. Factor 的 `execution/run.ts` 及计算方法不导入 evaluations、jobs、天气持久化入口；`sources/snapshot.ts`、`fingerprint.ts` 保持纯依赖。Worker 的 reportId 只留在消息封套，报告/缓存/天气状态仍各归所属业务写入。
8. Strategy 扫描和 Signals 不新增对 backtests/run 的依赖；Research 所有调用方仍导入同一 runtime manager，文档锁不被复制到 embedded；Market 利率数据接口不导入 Signals 或解析 FactorDependency。日历规则提取不得改变 16:00 门槛、时区和 SSE 查询范围。

提供 Gate 2 交接时列明准确提交信息、审查入口、静态结果、准备好的行为验证，以及“未提交，等待人工代码 review”。在通过前不运行单元/集成/E2E、构建、Worker probe 或数据库流程。

### 4.2 人工 review 后的行为验收

| 提交 | 必须验证的行为 | 运行入口要求 |
| --- | --- | --- |
| Factor | 原评估器、推断、policy、范围、组合、来源/Job、发布/holdout、天气及路由回归；固定输入下因子序列、审计、评估结果、相关性矩阵及快照/variant/test 哈希一致。验证 start 与 holdout 原事务、报告和日志封存、天气增量与不同持久化目标；Python/TS 因子与共享 run 的结果、失败及资源释放保持。 | 正式评估与天气分别通过迁移后的共享 Worker 在源码/干净产物中执行、回传并退出；天气不额外创建 FactorReport/Job。相关性真实 Worker 验证成功/失败及缓存写入；测试 run 时不要求数据库存在 reportId。 |
| Strategy | 原风险分析/情景/就绪要求、回测/扫描路由和 Job 生命周期；TS/Python 正式回测结果与风险后处理保持。factor-inputs 在 research/deployment/signal 三个使用场景的权限、归档、血缘规则保持；Research 报告消费及 Maintenance 审计可调用。 | 源码和干净产物均由 backtests/job 启动迁移后的 backtests/worker；扫描父线程至少执行一个隔离 cell，仍调用墙内模拟而非正式回测编排；Signals IPC 验证因子准备迁移后的冻结依赖与输入摘要。 |
| Research | 文档编辑/依赖失效、单 Cell/受影响分支/全文/提案尝试、中断/reset/归档、证据固化与 handoff；嵌入版本/输入回放/取消/首次成功冻结；会话复用、能力协商、SDK 分派、资源上限与输出限制保持。 | 源码和干净产物分别使用真实 Python 会话完成普通文档及嵌入分析；验证文档关闭与嵌入结束后的会话释放、同一 manager 和不同会话身份。保留开发 runner/生产 socket 的既有解析方式，不以仅 import 成功代替执行。 |
| Market / Signals 边界 | 原股票四表门禁、ETF 按日/历史及审计、风险驱动基础质量、外部数据/PIT、换汇、状态和路由；隔离数据库验证日历/期货同步、幂等与原失败回滚。新增必要回归覆盖上海 16:00 前后/非交易日、逐期限 as-of/缺失、14 天与 15 天新鲜度边界、无利率依赖及未来数据拒绝；信号入队、每日需求和维护截止日保持。 | 维护、Signals 每日入口和业务入口在源码/编译环境可加载；受影响 CLI 使用隔离数据库和本地 provider 替身验证调用、输出和退出，不运行真实日维护。Signals 运行/记账/通知顺序及报告部署回归使用替身隔离外部请求。 |

执行约束：

- 使用既有 `pnpm --filter api test <相关测试文件>`；最终 Market 提交完成后，在 review 已通过的组合代码上运行一次完整 API 测试，检查跨模块引用与集成回归。不得把默认跳过的用例计入通过。
- 涉及账户数据库集成时，用隔离数据库显式启用 `ACCOUNTING_INTEGRATION=1`。其他环境开关按实际相关测试审计并记录；无法完成的必需验证标为阻塞，不以历史测试数量替代。
- 每个实现提交验证 API 干净构建，例如 `pnpm --filter api build --outDir <全新临时目录>/dist`；产物测试保持 package.json 原生别名的生产解析布局，默认 Node 条件运行，不依赖已有 dist。Worker 的“模块加载”与“实际启动并退出”分别记录。
- Factor 数值对照使用同一固定行情/定义/运行时与隔离数据库，保留重构前基线，排除仅运行标识/时间戳等非确定字段；不把空行情错误回传当作算法等价证据。测试不修改阈值或放宽断言来适配重构。
- 本轮不改 Web/公开交互，默认不新增浏览器 E2E，以路由集成、业务和真实进程验证为主；如范围变化导致必须做 E2E，另行明确，并按项目约定检查、直接展示截图。
- 所有写入使用隔离测试库，市场供应商使用本地替身；不调用真实行情、邮件或付费模型。测试结束关闭所有临时服务、Worker、子进程和数据库连接，清理临时库。
- 若只需修正已批准范围内的测试/fixture/harness，可修正并重新验证；若验证要求修改产品代码，则重新静态检查并交人工 review 后再运行行为验证。

### 4.3 最终完成标准

- [x] 本计划确认，四个实现提交的范围与准确提交信息获准；按工作流逐个完成代码 review 与验证。
- [x] Factor 正式评估/报告/holdout、相关性、天气各有明确状态和产物归属；原 analysis/reports 目录移除且无转发。
- [x] 共享 execution 只执行计算、不写业务生命周期；数据/序列可供相关性复用，来源快照/指纹不依赖任务。Worker 复用关系、旧协议、哈希和封存语义保持。
- [ ] Strategy 回测编排/Worker 归回 backtests，扫描保持独立流程，因子输入准备真实共享；risk 不再有空 analysis 外层。
- [ ] Research 文档运行与共用 Python 会话分开，embedded/proposals/curator/evidence 的不同生命周期及权限边界保持。
- [ ] Market 同步/读取/质量按数据归属完成迁移；无旧 sync/quality 转发，日历与基础可得性归 Market，Signals 的利率准入归 Signals。
- [ ] Signals 主体业务目录保持，手动/每日汇入同一运行；记账与通知事务边界保持。其他模块未被强套模板。
- [ ] 所有改动经过对应人工 review，静态检查、相关行为验证与最终 API 回归通过；实际覆盖与环境限制有记录。
- [ ] 源码及干净产物的相关 Worker/CLI 验证完成，进程与临时资源已收尾。
- [ ] 当前 CLAUDE、README、架构/运行入口与源码一致；没有公开契约、数据或算法语义漂移。
- [ ] 按约定信息提交，记录实际 hash；工作区仅保留用户原有变更或干净，不推送。

## 5. 执行记录

| 提交 | 范围批准 | 静态检查 | 人工代码 review | 行为验证 | Git 提交 |
| --- | --- | --- | --- | --- | --- |
| 计划文档 | 2026-09-16 用户确认「定版开工」 | 本地链接、74 项现有源码路径、5 条提交标题、表格列数、代码围栏、过时方案文字及空白检查通过 | 方案已批准 | 文档不适用 | `b3afcbe2` |
| Factor | Gate 1 已批准，完整实现已完成 | 全仓 typecheck、ESLint 零警告、Prettier、路径/链接/实现对照与 diff 检查通过；测试数据修正后 API typecheck 通过 | 2026-09-16 用户确认通过 | 48 文件 / 283 用例最终通过；干净构建及三套真实 Worker / 17 组结果对照通过 | `6947b4e6` |
| Factor Job kind | 2026-09-16 用户确认追加范围与准确提交信息 | 修订后全仓 typecheck、20 个 TS/MJS 文件 ESLint/Prettier、Shell 语法、153 项本地链接和 diff 检查通过；测试断言修正后静态检查通过 | 2026-09-16 用户确认修订代码通过 | API 12 文件 / 160 用例最终通过；部署 13 项、干净构建及编译迁移入口验证通过 | 随本提交 |
| Strategy | 方案已批准，待 Factor Job 追加提交完成后开工 | 未执行 | 未开始 | 未执行 | 未提交 |
| Research | 方案已批准，待 Strategy 完成后开工 | 未执行 | 未开始 | 未执行 | 未提交 |
| Market / Signals 边界 | 方案已批准，待 Research 完成后开工 | 未执行 | 未开始 | 未执行 | 未提交 |

用户已明确批准定版并开工。Factor 的人工代码 review 和验证均已完成并提交 `6947b4e6`；Factor Job kind 追加修改也已通过人工 review 和验证，随本提交完成。Strategy 尚未开始实现，不推送。

### Factor 实现补充

共享 `runFactorEvaluation` 接受原横截面配置或统一研究配置，返回评估器原有结果。为保持旧 Worker
在时间序列/Panel 分支中「结果序列化与发送 → 运行时 dispose」的顺序，增加可选的同步 `onResult`
回调；Worker 在回调里发送原协议的 done 消息。计算入口不接收 reportId、不依赖端口或业务持久化。
这也保留了序列化/发送异常仍会进入原 finally 释放运行时的行为。

### Factor Gate 2 交接（2026-09-16）

准确提交信息：`refactor(factor): organize evaluation workflows and execution`。

交付：原 `analysis/`、`reports/` 已移除，没有旧路径转发；正式评估与报告归 `evaluations/`，
相关性归 `correlations/`，共享计算归 `execution/`，来源归 `sources/`，既有 Job 适配归 `jobs/`。
天气持久化保持原位置与事务。消费者、测试替身、Bootstrap 及当前 CLAUDE/README/架构/运行入口已同步。

审查入口：

- [正式评估启动](../../apps/api/src/factor/evaluations/start.ts)、[Job 生命周期](../../apps/api/src/factor/evaluations/job.ts)、[报告与封存读取](../../apps/api/src/factor/evaluations/read.ts)：原函数体和事务保持；holdout 仍单独拥有申请事务。
- [共享计算](../../apps/api/src/factor/execution/run.ts)、[Worker](../../apps/api/src/factor/execution/worker.ts)：结果回调、异常与释放时序是本次需要重点 review 的边界。
- [横截面评估](../../apps/api/src/factor/execution/cross-sectional/evaluate.ts)、[数据](../../apps/api/src/factor/execution/cross-sectional/data.ts)、[序列](../../apps/api/src/factor/execution/cross-sectional/series.ts)：按职责提取，函数体、常量和默认参数保持。
- [共享入口测试](../../apps/api/src/factor/execution/run.test.ts)：补充双语言、数据分派、Panel 组合、天气旧配置、原始结果形状及失败/释放顺序；尚未运行。

静态证据：

- `pnpm typecheck` 通过，含全部 workspace、三个生成契约检查；后端边界扫描 697 个文件，0 违规、0 已有跨域循环组，例外配置未变。
- 改动的 80 个 TS/MJS 源码及测试通过 ESLint（零警告）和 Prettier；`git diff --check` 通过。
- 静态 AST/token 对照确认 84 组原声明/实现未改变；Worker 计算分支与原代码一致，差别限于将 done 发送委托给结果回调后返回。
- 原 spec/policy/job 测试拆分后，28 个既有用例及断言保留；Worker/资源 URL 静态解析通过。实际进程尚未启动。
- 当前文档本地链接检查通过；运行源码/脚本没有 Factor analysis/reports 旧路径。历史设计记录保留原路径。

review 后执行：Factor 相关测试、Bootstrap、Agent 分析工具、Strategy 因子准备和 Research 报告消费回归；
以 `fd0ab69f` 保留的原代码和固定行情作数值/序列/哈希对照；隔离库验证生命周期、holdout 封存及天气不同持久化目标；
按 4.2 完成 API 干净构建及源码/编译 Worker 的实际成功、失败与资源收尾验证。

以上为 Gate 2 交接时的状态：当时产品代码未提交，未运行单元/集成测试、构建、Worker probe 或数据库流程。其后的 review 与行为验收见下文。

### Factor review 后验证与提交（2026-09-16）

用户确认代码 review 通过，授权行为验收及通过后提交。准确提交信息保持：
`refactor(factor): organize evaluation workflows and execution`。

- 相关回归范围为 `src/factor`、Bootstrap、两个 Agent 因子分析工具、Strategy 因子准备，以及 Research 的 FactorReport / scan-and-weather 消费：48 个文件、283 个用例最终通过，没有把跳过项计为通过。
- 首轮 47 个文件 / 279 个用例通过，4 个失败均来自新 `execution/run.test.ts` 的数据不足：Panel 只有 1 期、宏观没有完整观察期。仅补充测试数据到原评估器要求的 3 / 12 期并更新相应数量断言，保留真实评估器、原阈值和失败断言；该文件 15 项复跑全部通过。未修改已审查产品代码，测试文件 ESLint、Prettier 及 API typecheck 通过。
- `pnpm --filter api build --outDir <全新临时目录>/clean/apps/api/dist` 通过。干净产物目录保留原生 API package imports，默认 Node 条件加载 `dist/src`；未使用已有 API dist。
- 固定行情包括 783 个工作日、160 只测试股票、125,219 条股票行情、3,132 条 ETF 行情，含行业、历史财务与一个价格缺口。全部为本地生成数据。将 `fd0ab69f` 导出的原实现、当前源码及干净编译产物分别运行在独立 SQLite 库。
- 三套各执行 TS/Python V3/V6 横截面、时间序列、Panel 及失败 Worker，另执行混合语言横截面组合。核对真实窗口序列及覆盖审计（1,919 条观察）、语言相关快照/variant/test 哈希、24 期相关性、缓存内容、两种语言各 35 个月天气观察。当前源码与干净编译产物的 17 组完整结果均与原实现精确相等；没有用空结果代替数值证据。
- 三套均通过真实 Job 执行器验证正式报告成功、相同运行复用、创建回滚、失败和中断恢复；holdout 冻结/重复申请、真实计算、结果与日志封存、越权揭示拒绝及授权揭示；相关性成功缓存与失败保留；天气完整刷新、6 个月增量、旧观察点不变、重复跳过和失败状态。天气调用前后 FactorReport / Job 数量不变。
- 每套直接启动 11 个 Worker；另由真实 Job 与天气业务入口启动 10 个 Worker，均完成或回传预期失败并退出。源码/基线 Python 使用本机 runner；编译产物使用生产 socket 路径连接受控 Unix socket 桥及真实本机 Python runner。桥接不等于生产 sandboxd / Docker 隔离验收，本次没有改动这些能力。
- 没有调用真实行情供应商、邮件或付费模型，没有启动浏览器或新增 E2E。验证结束后确认无遗留验证/Python 进程、关闭并移除 socket，四个 SQLite 库均可取得排他锁后已删除；保留日志、fixture、结果 JSON 和干净构建。

验证归档：`/var/folders/2_/ntv3g9xx1xxf_wrfxwtx35f40000gn/T/jixie-factor-verify-3yqwm2gy`。
`logs/tests.log` 保留首轮结果，`logs/run-tests.log` 为测试数据修正后的复跑；`logs/build.log`、
`logs/baseline.log`、`logs/source.log`、`logs/compiled.log`、`summary.json` 和 `cleanup.json` 分别记录构建、
三套运行、精确对照及资源清理。初次建库需先创建 SQLite 文件、编译桥监听需临时本机 socket 权限，
均为测试环境处理，没有改变产品代码。最终 commit hash 由交付消息记录，并在下一提交更新本文时补入表格。


### Factor Job kind 追加提交（2026-09-16，review 与验证完成）

准确提交信息：`refactor(factor): split analysis and correlation job kinds`。

用户批准独立提交范围和标题后实施。初版静态检查通过；review 指出旧记录的数据转换应由部署入口负责，
因此移除业务目录迁移模块与 API bootstrap 调用，迁移改由 `scripts/bootstrap.sh` 在停服窗口执行。

- 两类 Job 在 API bootstrap 直接注册为 `factor-analysis`、`factor-correlation`，移除 `jobs/dispatch.ts`。
  正式分析及 holdout 创建前者，相关性创建后者；新 payload 不保存 task，HTTP 契约、计算及业务完成事务保持。
- `jobs/read.ts` 按 kind、用户与报告关系查询；相关性不允许关联正式报告，holdout 日志仍由 evaluations 封存。
- 独立脚本 `apps/api/scripts/migrations/split-factor-job-kinds.ts` 仅依赖 Prisma 和 Node；
  部署编排在停止 API、生成 Client、构建 API、完成 schema migration 后调用它的编译产物。
  它使用最多 200 条一批的 Prisma 事务，保留冻结 payload、日志、状态、关联与结果，updatedAt 正常更新；
  成功和失败都释放连接，失败返回非零。部署退出清理识别未完成的数据迁移，不自动重启 API。
- 批次失败可重跑部署继续；普通 API 启动不执行转换，开发机保留旧 Job 时须手动执行同一脚本。
  回退旧代码需先恢复旧 kind 及对应 task，见[部署数据迁移](../../apps/api/scripts/README.md#部署数据迁移)。
- Prisma 仅更新 kind 注释，没有表结构 migration；不修改算法、SDK、公开帮助或中英文 UI。
  没有 workspace / 跨包构建依赖调整，既有组件映射已覆盖 API 脚本；bootstrap 变更触发全量部署。
- 修订后静态检查通过：全仓 `pnpm typecheck`（含三个生成契约检查；698 个后端文件，0 边界违规、0 跨域循环组）；20 个 TS/MJS 文件 ESLint 零警告与 Prettier；`bash -n scripts/bootstrap.sh`、153 项本地文档链接、旧迁移路径引用与 `git diff --check`。
- 人工 review 后验证范围：迁移事务及 CLI 成功/失败、部署阶段顺序与失败后保持停服、部署影响分类；
  Bootstrap、Factor 路由/提交、跨业务生命周期、Strategy/Signals 任务隔离、Research 嵌入分析注册表。
  隔离 SQLite 覆盖各状态、历史 payload、分页、失败回滚/重试、排队执行、中断恢复、缓存与 holdout 封存。
  随后执行 API 干净构建和编译迁移入口验证，确认子进程与连接退出；不执行真实部署或开发库转换。

用户确认修订代码 review 通过后执行验证，实际结果如下：

- API 相关回归共 12 个文件、160 个用例最终通过，覆盖上述注册、提交、读取、权限、迁移与生命周期。
  首轮 159 项通过，1 项因 SQLite 触发器错误被 Prisma 包装为 `P2003`，无法匹配原始错误文案而失败。
  仅将该测试改为断言实际错误码，保留失败批次完全回滚、前批次已提交和重试完成的检查；迁移测试 3 项复跑全部通过。
  测试修正后的 ESLint、Prettier 和 API typecheck 通过，没有修改已审查产品代码。
- `node --test scripts/deploy/bootstrap.test.mjs scripts/deploy/plan-deployment.test.mjs` 共 13 项通过。
  通过 Bash 替身验证实际部署片段的执行顺序、迁移失败后不重启 API、其他失败仍保留原清理行为；没有执行真实部署。
- API 在全新临时目录构建通过。默认 Node 条件下，以部署使用的 `node --env-file=.env dist/scripts/migrations/split-factor-job-kinds.js`
  运行干净产物；临时 API 目录保留原 package.json 与依赖解析布局。
- 编译入口使用隔离 SQLite 验证 205 条旧 Job 的五种状态，以及 3 条现有新 kind / 非 Factor 记录。
  人为使第二批失败：前 200 条提交，后 5 条完全回滚，进程返回 1；解除错误后重跑返回 0 并全部迁移。
  payload、日志、状态、关联、报告和缓存保持不变；再次执行返回 0，全部 Job（含 updatedAt）精确不变。
- 三次迁移子进程均退出，Prisma 连接关闭；隔离库取得排他锁后删除。没有运行服务、浏览器 E2E、真实部署或开发库转换。
  验证归档为 `/tmp/jixie-factor-job-verify.RtxPwM`，保留干净构建、编译入口验证脚本、`compiled-verification.json` 和 `cleanup.json`。

按已批准的准确提交信息提交，不推送；实际 hash 由交付消息记录，在下一提交更新本文时补入表格。

审查入口：[部署编排](../../scripts/bootstrap.sh)、[独立迁移](../../apps/api/scripts/migrations/split-factor-job-kinds.ts)、
[任务注册](../../apps/api/src/bootstrap.ts)、[任务归属](../../apps/api/src/factor/jobs/read.ts)、
[迁移事务与 CLI 测试](../../apps/api/scripts/migrations/split-factor-job-kinds.integration.test.ts)、
[部署失败收尾测试](../../scripts/deploy/bootstrap.test.mjs)。
