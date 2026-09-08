# 后端业务边界与目录重整开发计划

> 状态：方案已确认；Commit 1（基线与计划）已完成并获准提交；源码重构尚未实施。
> 编制日期：2026-09-07；核对代码基线：`12ce9092`。
> 目标：让不熟悉项目的开发者从目录识别业务能力，沿一个入口读懂完整流程，并找到状态与数据的责任方。
> 本文只规划后端结构调整，不改变研究方法、金融口径或产品行为。
> 开发授权：2026-09-08 用户确认按评审工作流开始开发；Commit 1 已通过提交前评审。后续提交逐项说明具体范围，经确认后实施。

## 1. 判断与取舍

当前后端的主要理解成本来自业务概念、执行生命周期和证据关系：研究文档与执行快照、因子草稿与发布、策略与历史报告、行情入库与数据可用性。经典三层可以规范 HTTP、业务和存储的技术边界，但不能替代这些业务关系的梳理。

采用以下组织原则：

1. **顶层以业务命名，模块内部以实际职责命名。** 保留 `research`、`factor`、`strategy`、`signals` 等业务模块，不在每个模块机械复制 `controllers/services/repositories`。
2. **完整业务操作有明确入口。** 例如提交回测、发布因子、运行研究文档。入口负责权限归属、状态检查、事务与副作用顺序；HTTP 只是调用方。
3. **数据访问按语义提取。** 简单 Prisma 查询可以靠近业务操作；PIT 解析、复杂复用查询和跨模型一致性需要明确边界。不建立通用 CRUD repository 或按每张表生成包装层。
4. **公共运行设施有独立归属。** Python 通信、数据库连接、通用队列等不挂在某一个使用它们的业务目录中。
5. **区分领域能力和上层编排。** 研究向因子/策略交接、Agent 调用工具、任务分派确实跨业务；把它们放在可识别的编排位置，不用事件总线隐藏现有调用。
6. **命名服务于业务解释。** 新文件优先使用 `submit-backtest`、`publish-factor` 等具体操作名；不通过制造大量 `manager`、`service`、`utils` 文件转移复杂度。

不新增 `modules/` 包装层：`src/research` 已经能表达业务。也不为目录统一性拆开本来就简洁的文件，或为尚不存在的职责创建空目录。

### 1.1 本次范围

- 梳理业务对象、读写所有权、生命周期与跨模块调用。
- 重整 API 内部目录，提取混杂文件中的实际职责。
- 修正 Python runtime、Job、worker 入口、引擎适配器的归属。
- 同步导入、脚本、测试、构建资源路径和开发文档。
- 建立少量可自动检查的导入约束，阻止结构再次退化。

### 1.2 保持不变的契约

- Hono、Prisma 6、SQLite、pnpm workspace 及现有可部署组件。
- HTTP URL、请求与响应结构、错误码、权限语义、SSE 事件及轮询协议。
- Prisma model、表结构、已持久化 JSON、任务 kind/payload、源码与结果哈希算法。
- Research / Factor Python SDK、运行时版本和包清单的公开契约。
- 交易规则、复权、成本、PIT、holdout、因子发布条件和财报字段口径。
- Job、Agent turn、Research 会话的现有调度方式、并发限额及恢复语义。

不引入微服务、Redis、消息中间件、DI 容器、通用工作流引擎，也不复制 Python 回测引擎。实施中如发现行为缺陷，应独立记录；不能将修复悄悄混入目录迁移的等价性验收。

## 2. 当前结构中需要解决的问题

| 已核对的事实 | 理解成本 | 调整方向 |
| --- | --- | --- |
| `research/workbench.ts` 同时承担文档编辑、依赖分析、执行、过期处理和执行记录 | 无法从入口判断一个修改影响哪些生命周期 | 拆成文档、依赖、执行与证据职责，保留完整操作入口 |
| `research/workbench-runtime.ts` 同时管理会话并分派多种 SDK 数据请求 | Python 生命周期与金融数据映射交织 | 会话归执行模块，数据请求适配归 SDK 模块 |
| `strategy/python/session.ts` 和 `protocol.ts` 被 Research、Factor 共用 | 路径错误暗示“Python 属于策略” | 通用传输上移，领域协议分别归属 |
| `lib/jobs.ts` 除 Job 状态外还更新回测、因子、扫描、信号及整理任务实体 | 通用任务设施实际拥有多个领域的状态转换 | 通用记录与日志、业务完成事务、启动恢复分开 |
| `lib/job-queue.ts` 动态导入各领域 runner | 通用队列与业务任务互相依赖 | 应用启动处装配处理函数；队列只调度 |
| `engine/configured-run.ts` 解析已保存策略、准备因子、选择语言并附加风险分析 | 引擎既是模拟算法又是业务执行总入口 | 编排归策略执行，模拟核心保留在 engine |
| `engine` 包含回测、扫描、每日信号、Agent 快速回测的 worker 入口 | 文件目录掩盖各任务实际责任方 | 任务入口随业务走；线程/子进程形态保持原样 |
| `services` 只有少量策略操作，其他服务散落在业务目录及路由 | 新人无法预判业务代码位置 | 策略操作归回 strategy，移除全局 services 目录 |
| `store` 是行情同步，`lib` 混合数据库、任务、认证、统计与展示辅助 | 通用名字不能说明业务职责 | 行情同步显式命名；其他能力按实际用途归位 |

当前“worker”不统一等于线程：普通回测、因子分析使用线程；每日信号使用子进程；参数扫描中还有子任务进程。迁移前要逐入口登记，禁止统一改成一种执行方式。

现有设计文档包含历史决策。例如早期路由文档中的 `lastResult` 和报告描述已被后续实现演进。本文以当前源码为基线，保留仍有效的 URL 命名规则，不恢复历史行为。

## 3. 先明确业务对象与责任方

下表是目标逻辑所有权，不要求数据库一张表只能由一个文件访问。跨实体事务可以由明确的业务操作编排，必须保持原子性。

| 对象或概念 | 责任模块 | 可变内容与生命周期 | 跨模块使用方式 |
| --- | --- | --- | --- |
| 用户、Session、登录验证 | `auth` | 登录、会话有效期、退出、禁用 | HTTP 注入身份；业务操作仍校验资源归属 |
| 原始行情、证券身份、基础注册表、市场状态与指数估值 | `market` | 幂等同步、历史身份、来源与日期、状态及估值计算 | 领域数据加载器或已命名的读取函数 |
| 财报、利率、宏观、商品数据语义 | `market/fundamentals` / `market/rates` / `market/macro` / `market/commodity` | 发布日期、可得时间、修订、缺失与质量 | 各子领域解析函数；不从调用方重复实现口径 |
| 数据发布水位、维护记录与检查点 | `maintenance` | 拉取、校验、发布、修复、恢复 | 查询可用状态；业务不能自行推进发布水位 |
| ResearchDocument、ResearchCell | `research/documents` | 编辑、版本冲突、排序、归档 | 文档操作入口 |
| Cell 依赖图与 stale/blocked 判断 | `research/dependencies` | 定义/引用分析、依赖失效、运行计划 | 文档编辑调用失效操作；执行模块消费运行计划 |
| ResearchCellExecution、ResearchExecution、ResearchArtifact | `research/evidence` | 创建执行记录、完成/失败/取消、冻结源码与结果 | 执行模块写入；已完成证据通过只读入口使用 |
| Cell 修改提案、尝试与语义确认 | `research/proposals` | 提案、应用、审阅、拒绝、运行受影响 Cell | Agent 创建提案，文档操作应用变更，执行入口运行 |
| Factor、FactorReport、FactorComposite | `factor` | 草稿、分析、holdout、发布、归档与组合 | 策略按发布与依赖规则使用；Research 读取报告 |
| Strategy、BacktestReport、StrategyScanReport | `strategy` | 配置编辑、提交运行、历史报告与参数扫描 | 信号部署冻结配置；Research 读取报告或生成文档 |
| 回测报告中的组合风险分析 | `strategy/analysis/risk` | 回测完成后计算，随报告保存；无独立 HTTP endpoint | 策略工作台读取报告的 `allocationAnalysis.risk` |
| StrategyDeployment、SignalRun、成交与账户快照 | `signals` | 部署、暂停、每日运行、通知、人工成交与对账 | 调用策略执行能力，不把模拟账户逻辑塞入 engine |
| AgentConversation、AgentMessage、AgentTurn | `agent` | 对话记录、流式 turn、取消、中断与轨迹 | Profile/工具调用业务入口；不直接改业务持久化表 |
| Job | `infra/jobs` + 业务任务完成入口 | queued/running/done/error/stale、日志 | 队列拥有领取和并发；领域拥有报告与 Job 的完成事务 |
| 公开库展示与复制操作 | `library` | 聚合展示、复制到当前用户 | 调用因子/策略读取与复制入口，不绕过业务约束 |

### 3.1 必须保留的三条生命周期区别

1. **Job**：先持久化排队，再执行；前端按 ID 查询。API 启动时处理残留 running，queued 任务按现有行为恢复。
2. **Agent turn**：后台执行，SSE 推送，保存对话与轨迹；连接断开与取消执行是不同操作。
3. **Research 执行**：文档级会话和互斥控制；当前 Cell/文档运行路由等待操作完成。普通执行与全新环境完整执行分别保留。

不可变证据指完成后的源码、计算参数与结果不被后续编辑覆盖；运行状态仍需从进行中转为终态，部分展示元数据允许按当前规则修改。不能把“不可变”误实现为记录创建后任何字段都禁止更新。

## 4. 目标目录

以下是实施目标，按现有能力填充；没有文件的目录不创建。测试紧邻实现，开发 worker 的 `.boot.mjs` 与其 worker 同目录；它们与根级应用启动入口 `bootstrap.ts` 职责不同。

```text
apps/api/src/
  index.ts                      进程入口、启动调用与退出信号
  bootstrap.ts                  资源装配、启动顺序与关闭协调
  server.ts                     构建 Hono 应用、挂载中间件和路由
  date.ts                       跨业务使用的日期辅助
  auth/                         登录、Session、邀请码、HTTP 鉴权
  library/                      公开库查询与复制业务
  research/
    http/                       保持原 URL 的 HTTP 适配
    documents/                  文档与 Cell 编辑、查询、版本控制
    dependencies/               依赖分析、过期判断与受影响运行计划
    execution/                  Cell/文档运行、取消、会话生命周期
    evidence/                   执行记录、快照、哈希与产物
    proposals/                  修改提案、审阅、尝试与语义确认
    datasets/                   研究数据切片、口径映射、结果数据集
    sdk/                        Research 请求校验与数据调用分派
    catalog/                    数据目录、概念、来源选择与研究方法
    language/                   Pyright、文档映射与生成 stub 的消费
    templates/                  FCFF 等具体研究模板
    handoff/                    因子/策略草稿生成与来源关联
    curator/                    研究整理任务与结果
    agent-context.ts            研究上下文构造
  factor/
    http/
    definitions/                定义、预置因子与元数据
    analysis/                   评估器、分析任务、worker 和统计检验
    observations/               不同资产与分析形态的观察数据
    reports/                    报告定义、读取、holdout 纪律与完成事务
    publication/                发布、归档与准入
    composition/                因子组合与来源解析
    runtime/                    因子 TS/Python 编译、SDK 与运行适配
    weather/                    因子天气计算与查询
  strategy/
    http/
    definitions/                策略保存、命名、读取与复制
    backtest/                   提交、任务、报告、worker
    scans/                      参数扫描与子任务执行
    execution/                  语言分派、因子准备、风险分析编排
    analysis/
      risk/                     回测报告的风险暴露、宏观敏感度与压力情景
    runtime/                    策略 TS/Python SDK 与隔离执行适配
    examples/                   仓库维护的示例策略
  engine/
    simulation/                 交易日推进、持仓、成交与期货账户
    data/                       EngineData、DataPort 与数据类型
    factors/                    引擎内因子求值
    adapters/                   Prisma 读取、宿主 Python 因子桥接
    testing/                    fixture DataPort
    types.ts
  signals/
    http/
    deployments/                配置冻结、激活与暂停
    runs/                       每日任务、worker、记录与完成事务
    accounting/                 成交与账户对账
    factor-inputs/              因子依赖、数据截止与血缘
    scheduler.ts
    sync.ts
    notifier.ts
  agent/
    http/
    core.ts                     统一模型/工具循环
    turns/                      后台运行、事件流与轨迹
    conversations/              对话记录与实体关联
    profiles/
    tools/
      charts/                   Agent 图表工具与规格校验
      sql/                      只读 SQL 工具、worker 与 Node SQLite 类型补充
  market/                       行情获取、证券身份、查询与市场分析
    http/                       行情与市场状态接口
    providers/tushare/          Tushare 通道与能力探测
    sync/                       基础行情同步
    instruments/                证券身份与股票代码变更
    registry/                   ETF/指数等静态注册表
    fundamentals/               财报来源、版本解析、标准化与财务指标
    rates/                      利率曲线与相关外部数据
    macro/                      宏观发布、历史可得性与状态计算
    commodity/                  商品期货、连续收益、持仓与仓单
    quality/                    跨子领域数据审计
    queries/                    跨子领域行情、序列与基准查询
    state/                      跨子领域的市场与行业状态计算
    valuation/                  指数估值
  maintenance/                  同步编排、整体数据审计、质量门禁、水位、修复与运维 HTTP
  infra/
    database/                   Prisma 初始化与连接释放
    http/                       HTTP 校验与错误响应辅助
    jobs/                       通用 Job 记录、日志、领取与队列
    runtime/
      python/                   会话连接、分帧与公共启动协议
      typescript/               通用 isolate 执行辅助
      console.ts                沙箱日志协议适配
    llm/                        模型供应商适配
    email/                      邮件传输
    logging.ts                  日志输出辅助
  math/                         共用数值计算，不组织业务流程
    stats.ts                    描述统计、相关、回归和收益统计
    inference.ts                统计推断
    indicators.ts               技术指标计算
    stats-doc.ts                从 stats JSDoc 生成的统计说明
    stats-doc-gen.ts            统计说明生成辅助
  i18n/                         后端消息目录与纯翻译函数
```

`apps/sandboxd`、`packages/shared` 的包名与根路径保持不变。Python runner 及 `.pyi` 的位置也默认保留，避免无收益地改变镜像构建和公开契约生成路径。

### 4.1 市场业务集中在 market，内部按职责划分

已确认：不单独建立顶层 `market-data` 模块。行情获取、同步、身份注册、查询、市场状态和估值属于同一组市场业务，内部通过 providers/sync/instruments/queries/state/valuation 等职责区分。获取与分析的差异本身不足以支持两个顶层模块；集中后，新人可以从 market 找到完整链路。

子目录只在已有文件构成明确职责组时创建；简单的独立文件可以保留在 market 根目录。当前没有独立部署或独立数据服务消费的需求，不提前建立这个边界。

已确认：`fundamentals`、`rates`、`macro`、`commodity` 收进 `market`，作为市场信息及其解释规则的子领域，不再与 Research、Factor、Strategy 等主业务能力并列在顶层。子领域按现有能力命名，不强行改成股票/债券/商品的资产分类；宏观信息横跨资产，利率曲线也不等于全部债券业务。

财报版本选择属于 `market/fundamentals`，宏观可得性属于 `market/macro`，商品连续合约口径属于 `market/commodity`。各子领域已有的同步、查询和质量检查留在子领域内，不再按技术动作拆散到 `market/sync`、`market/queries`、`market/quality`。这些共用目录只承担基础行情或跨子领域职责。子领域可以复用 `market/providers/tushare` 的数据源通道，这不改变其数据解释和计算的归属。

按业务用途判断边界，不按金融关键词搬文件：

| 能力 | 目标归属 |
| --- | --- |
| 某个历史时点可见的财报版本、标准化财务指标 | `market/fundamentals` |
| 利率曲线、宏观发布修订、商品连续收益的数据口径 | `market/rates`、`market/macro`、`market/commodity` |
| 用财务指标构造因子并检验 IC | `factor` |
| 用户修改 FCFF 假设、运行估值研究模板 | `research/templates` |
| 利率、宏观或商品变化对回测组合风险的解释 | `strategy/analysis/risk` |

`market/valuation` 当前只承接指数估值，不因目录名称而吸收 Research 的公司估值模板。当前组合风险分析服务于策略回测报告，归 `strategy/analysis/risk`；市场序列准备和基础质量检查归 market。`maintenance` 保持顶层，负责跨子领域的运行编排与发布状态。

`maintenance` 决定什么时候同步、什么时候可以发布；`research/datasets` 决定研究 API 如何呈现数据；`engine/data` 决定模拟引擎如何在某个历史时点消费数据。它们的返回形态与职责不同，本次不强行合并成一个 loader。

### 4.2 顶层公共能力的命名与归属

已确认：基础设施统一使用常见缩写 `infra`。通用 Job 队列、Python 通信、isolate 执行辅助和日志归入 infra；业务任务、领域 SDK、报告完成事务仍在各业务模块。当前日志能力只有少量输出辅助，使用 `infra/logging.ts`，不提前建立完整 observability 模块。

共用计算目录命名为 `math`，替代含义过宽的 analytics。它提供统计、推断与技术指标等输入到输出的数值计算，不拥有数据库记录、用户状态或业务流程。Factor 检验、Strategy 的风险分析、Engine 模拟和 Research 数据映射保持各自归属，不能因为“也涉及计算”就搬入 math。

不设 common 或 utils 收纳目录。`i18n` 是读者会直接寻找的明确能力，保留顶层；从 HTTP 请求解析语言的辅助仍归 `infra/http`。日期辅助目前是一个小文件，直接使用 `src/date.ts`，不为单文件再创建模块。模块专用类型随模块放置，当前 Node SQLite 类型补充与 Agent SQL worker 放在一起。

当前根级 `config.ts` 只定义 Tushare 配置，归 `market/providers/tushare/config.ts`。不预设全局配置中心；以后配置也按其使用者归属。Agent 的图表规格与 SQL 工具归 `agent/tools/charts`、`agent/tools/sql`，不由此建立系统级 charts 模块，也不搬动 Research 的图表输出与产物职责。

保留 auth、library、research、factor、strategy、engine、signals、agent、market、maintenance 的业务边界。当前 risk 归入策略报告分析，不单列顶层模块。不建立 `application/` 模块：启动装配由根级 `bootstrap.ts` 组织，业务恢复规则留在各业务模块，整体数据审计归 `maintenance/data-audit.ts`。目录归并不要求新增共同父类、通用接口或框架。

### 4.3 启动入口与资源生命周期

已确认：采用普通 `bootstrap.ts` 文件集中组织启动，不建立独立的 application 业务层。职责类似 Spring Boot 启动中的资源创建、依赖装配、启动任务与关闭协调；本项目用显式函数调用表达，不引入 DI 容器、自动扫描、统一模块基类或通用生命周期框架。

| 位置 | 负责什么 | 边界 |
| --- | --- | --- |
| `index.ts` | 调用启动入口、处理进程启动失败与退出信号 | 不实现业务恢复规则或资源内部清理细节 |
| `bootstrap.ts` | 获取各模块配置、创建进程资源、连接任务处理函数、协调恢复、启动调度与 HTTP 监听、汇总关闭操作 | 只表达依赖与顺序，不承接报告计算、同步规则或审计逻辑 |
| `server.ts` | 保留 `buildApp`，挂载 Hono 中间件和各业务 HTTP 路由 | 构建应用可供测试使用，不隐式启动队列、恢复任务或监听端口 |
| `infra` 中的资源实现 | 数据库连接、任务队列、运行客户端等的创建、启动与释放机制 | 不决定回测、因子、研究等实体的状态规则 |
| 各业务模块 | 提供任务处理、业务恢复以及自身会话的生命周期操作 | 启动入口调用这些操作，业务不反向依赖启动入口 |
| `maintenance/data-audit.ts` | 组合市场基础质量检查与策略模型就绪检查，形成现有整体审计报告 | 由维护任务/CLI 显式调用，不放进每次 HTTP 启动流程 |

装配的典型例子是把策略回测处理函数交给 Job 队列：策略实现回测，队列实现领取和并发，bootstrap 连接两者。普通计算函数与稳定的模块调用继续直接 import；有生命周期的资源、任务处理函数、需替换的外部客户端才按实际需要显式传入，不创建包含所有业务服务的全局容器。

启动按依赖组织：读取并校验相关配置 → 创建必要资源 → 连接处理函数和构建 HTTP 应用 → 完成必须先执行的恢复 → 启动调度与对外服务。数据库须先于恢复可用，残留 running 的恢复须先于领取新任务。沿用当前预置数据初始化、可选运行时探测等步骤的阻塞/异步语义，不因重排代码让可选能力变成启动硬依赖。配置仍由使用者定义，bootstrap 不成为第二份配置真相源。

业务恢复函数留在所属模块；跨报告恢复仍由启动入口在同一数据库事务中协调，向各恢复操作传入同一个 transaction client。函数拆分不得把一次原子恢复变成多次独立提交。Agent turn 与 Research 会话继续保留自己的生命周期，不套用 Job 恢复规则。

资源生命周期规划需要同时说明正常启动、启动失败与退出：

- 谁创建或持有资源，谁负责提供关闭操作。API 与 Worker 各自创建的 Prisma 连接分别释放；API 管理自己的沙箱客户端/会话，独立部署的 `sandboxd` 进程仍由部署设施管理。
- 启动中途失败时，协调释放已创建的资源；关闭顺序按依赖安排，避免数据库已断开却仍有任务需要写终态。
- 正常退出的目标顺序为停止接收新工作、停止领取任务、按现有规则等待或中止在途执行、完成状态与日志写入、释放连接。Job、Agent turn、Research 会话分别核对，不能把关闭队列当成全部执行均已停止。
- 本节明确资源与流程归属，不假定当前已有完整的失败清理或优雅退出。实施先登记现有能力；目录重整迁移已有行为，缺失的等待机制、超时策略或清理能力独立记录，不夹带改变运行语义。

避免 import 本身启动监听、队列或异步连接初始化。需要整理已有初始化副作用时，必须逐一核对 API、CLI、Worker 和测试的资源获取入口，保留每进程/线程实例语义及数据库初始化参数，不能机械删除初始化代码。数据库迁移、全量同步和整体审计按部署或维护入口显式执行。

默认不把 bootstrap 拆成目录。若核对后确有多个执行队列的 API/CLI 入口需要共享装配，再提取一个明确命名、无自动启动副作用的普通函数文件；仅入队的调用方不因此启动调度器。Worker 的 `.boot.mjs` 继续随业务 Worker 放置，不与 API 进程启动文件混用。

## 5. 具体迁移与拆分清单

本节路径均相对 `apps/api/src`。同名测试同步移动，测试中的 mock 路径和 fixture 路径一起修改。纯迁移保留原文件名；只有职责已经改变或旧名明显失真时才改名。

### 5.1 公共设施与 HTTP 入口

| 当前文件/目录 | 目标 | 修改内容 |
| --- | --- | --- |
| `index.ts`、`server.ts` 中的启动流程 | `index.ts` + `bootstrap.ts` + `server.ts` | 进程入口、资源装配与 HTTP 构建分开；依照 4.3 保留运行行为 |
| `lib/prisma.ts` | `infra/database/prisma.ts` | 保留每进程/线程连接初始化、WAL 与 busy timeout |
| `lib/httpError.ts` | `infra/http/errors.ts` | 保留错误码和校验输出，所有 Hono 适配仍在 HTTP 边界 |
| `lib/session.ts`、`lib/inviteCode.ts` | `auth/session.ts`、`auth/invite-code.ts` | 将 Hono Context 扩展和 middleware 放 `auth/http/`，会话操作留 auth |
| `routes/auth.ts` | `auth/http/auth.ts` | 提取登录操作，保留 cookie、安全属性及用户禁用语义 |
| `lib/email.ts`、`llm/*` | `infra/email/`、`infra/llm/` | 迁移传输能力；具体业务邮件内容继续由业务负责 |
| `lib/date.ts`、`util/log.ts` | `date.ts`、`infra/logging.ts` | 保留实现，不扩成通用工具框架 |
| `lib/stats.ts`、`inference.ts`、`indicators.ts`、`stats-doc*.ts` | `math/` | 纯计算与说明生成一起归位；不引入数据库或 HTTP 依赖 |
| `lib/chart-spec.ts` | `agent/tools/charts/spec.ts` | Agent 图表规格保持共享契约映射 |
| `types/node-sqlite.d.ts` | `agent/tools/sql/node-sqlite.d.ts` | 类型补充跟随实际使用者；确认 tsconfig 仍收录该声明 |
| `config.ts` | `market/providers/tushare/config.ts` | 仅 Tushare 配置；更新 API、CLI 和测试调用方 |
| `lib/chat-schema.ts` | `agent/conversations/schema.ts` | 对话入参/消息校验由 Agent 拥有 |
| `lib/sandbox-console.ts`、`lib/isolate-run.ts` | `infra/runtime/console.ts`、`infra/runtime/typescript/isolate-run.ts` | 仅通用执行机制；不搬入领域 SDK |
| `routes/strategy*.ts`、`routes/backtest.ts` | `strategy/http/` | 保留单复数文件与挂载语义，复杂操作转入对应业务入口 |
| `routes/factor*.ts`、`routes/factors.ts` | `factor/http/` | 保留所有 URL 和字面量/参数路由顺序 |
| `routes/research.ts` | `research/http/` | 按 documents、execution、proposals、catalog、agent、curator 划分内部路由文件 |
| `routes/signals.ts`、`routes/agent.ts`、`routes/market.ts` | 对应业务 `http/` | HTTP 与业务操作分离，注册仍集中在 server |
| `routes/library.ts` | `library/http/library.ts` + `library/catalog.ts`、`library/copy.ts` | 抽出聚合查询与复制操作；因子/策略复制约束由其业务入口负责 |

`server.ts` 保留 `buildApp` 作为路由总索引，构建应用本身不启动队列或监听端口；监听与资源启动由 `bootstrap.ts` 显式调用。模块内部 `http/index.ts` 只负责局部挂载，不导出整个业务模块。全部调用方迁移后删除空的顶层 `routes`、`services`、`lib`、`util`、`llm` 目录；不保留长期转发层。

当前 `i18n/index.ts` 同时导出纯消息函数 `t` 和依赖 Hono Context 的 `m`，`locale.ts` 也读取请求。将 `m` 与请求 locale 解析归 `infra/http/locale.ts`；`i18n/messages.ts` 保持纯消息目录。领域与隔离 bundle 直接消费纯消息入口，HTTP 适配消费请求辅助，避免通过 re-export 将 Hono 带入领域依赖。

### 5.2 Python 通信与领域运行时

1. `strategy/python/session.ts` → `infra/runtime/python/session.ts`。保留 `PythonSession.connect`、Unix socket、分帧、超时/断连和仅开发可用的本地运行分支。
2. 拆开 `strategy/python/protocol.ts`：公共帧包络/握手属于 `infra/runtime/python/protocol.ts`；策略交互帧属于 `strategy/runtime/python/protocol.ts`；Research 帧属于 `research/sdk/protocol.ts`。现有 Factor 特有帧按实际声明归 `factor/runtime/python/`，不复制一份 schema。
3. `strategy/python/runtime.ts`、`codegen-prompt.ts` → `strategy/runtime/python/`。策略 SDK 的语义适配留在这里。
4. Research 会话 manager 放 `research/execution/python-session.ts`；`answerResearchRequest` 及其数据请求处理放 `research/sdk/dispatch.ts`，调用 `datasets` 中的 loader。
5. 通用 session 不能导入 Research、Factor、Strategy；领域适配可以导入通用 session。保持现有帧类型、字段、错误和运行时版本不变。

验收重点：移动后本地 runner 的解析路径仍正确；Research、Python 因子、Python 策略都通过同一连接设施；生产不能启用本地 Python 逃生分支。

### 5.3 Job 设施、业务完成与恢复

这是有状态拆分，不按全文替换一次完成。

| 原职责 | 目标责任方 |
| --- | --- |
| `createJob`、查询、原子领取、通用状态类型 | `infra/jobs/records.ts` |
| 内存日志、增量读取、完成后写库和 TTL 清理 | `infra/jobs/logs.ts`，通过明确函数配合领域完成事务 |
| FIFO、每用户并发限制、唤醒、运行名额释放 | `infra/jobs/queue.ts` |
| 任务 kind 与业务处理函数的连接 | `bootstrap.ts` 显式装配；payload 解析与任务执行留在对应业务入口 |
| `finishBacktestReportJob` | `strategy/backtest/complete.ts` |
| `finishFactorReportJob` | `factor/reports/complete.ts` |
| `finishStrategyScanJob` | `strategy/scans/complete.ts` |
| `finishSignalRunJob` | `signals/runs/complete.ts` |
| Curator 完成操作 | `research/curator/` |
| `markRunningJobsStale` 的启动调用与跨实体事务 | `bootstrap.ts` 协调一次恢复事务，调用各领域恢复操作与 `infra/jobs` 的事务内状态更新辅助 |
| 报告恢复规则、未知/损坏 payload 的实体失败处理 | 对应业务任务目录中的恢复/失败操作；由装配的处理函数连接到队列 |

实施要求：

- 调度器通过启动时传入的普通处理函数调用领域任务；使用现有 TS 能力，不引入插件注册框架。`bootstrap.ts` 是装配点，业务与 `infra/jobs` 不反向导入启动入口；API/CLI 的入口差异按 4.3 处理。
- 保留 Job 与报告终态更新的同一数据库事务，不能改成“先 finishJob，再更新报告”。恢复当前使用的跨报告事务也须保持原子性。
- 领域完成函数可以接收 Prisma transaction client；通用 Job 模块提供事务内更新辅助，不接管业务实体规则。
- queued payload 是持久化协议，不能因移动文件重命名 `kind/task` 或改字段。旧 queued 数据仍能执行，损坏 payload 仍能将相关实体一并标记失败。
- 日志完成前在内存、完成后持久化的语义保持不变；不能通过提取日志模块引入每行写库。
- 核对所有实际执行队列的 API/CLI 入口及只入队等待的调用方；只在原本执行队列的进程装配处理函数，不让维护脚本意外多启动一个调度器。

### 5.4 Research：按对象和生命周期拆分

| 当前文件或文件组 | 目标目录/文件 | 责任 |
| --- | --- | --- |
| `workbench.ts` 的 list/get/create/archive/restore/add/update/delete | `documents/document-operations.ts`、`cell-operations.ts` | 编辑与归属检查、版本冲突、排序 |
| `workbench.ts` 的 analyze、definition/reference 解析、downstream、affected plan | `dependencies/analyze.ts`、`invalidation.ts`、`run-plan.ts` | 依赖图、阻塞和过期规则 |
| `workbench.ts` 的 runCell/runDocument/runAffected/interrupt/reset | `execution/run-cell.ts`、`run-document.ts`、`run-affected.ts`、`control.ts` | 业务执行入口、互斥与取消 |
| `workbench-runtime.ts` | `execution/python-session.ts` + `sdk/dispatch.ts` | 分离会话管理与数据请求处理 |
| `workbench-sdk.ts` | `sdk/validation.ts` | 从共享公开 Contract 构造校验，保持唯一真相源 |
| `research-execution-records.ts`、`workbench-artifacts.ts`、`fingerprints.ts` | `evidence/` | 执行快照、产物与哈希 |
| `workbench-cell-changes.ts`、`workbench-cell-change-attempts.ts`、各 `research-cell-change-*-records.ts`、`research-clarification-records.ts` | `proposals/` | 提案/尝试的持久化和生命周期；运行仍调用 execution |
| `equity-dataset.ts`、`financial-dataset.ts`、`financial-values.ts`、`commodity-dataset.ts`、`market-reference-dataset.ts`、`supplemental-dataset.ts` | `datasets/` | 金融数据查询与公开列映射 |
| `series.ts`、`universe.ts`、`spec.ts`、`cross-market-data-contracts.ts` | `datasets/` | 序列、截面、股票池与跨市场约束 |
| `factor-report-result.ts`、`backtest-report-result.ts`、`result-dataset.ts` | `datasets/results/` | 已归属用户的报告读取与研究数据映射 |
| `catalog.ts`、`data-catalog.ts`、`concept*.ts`、`source-decisions.ts`、`playbooks.ts` | `catalog/` | 语义检索、来源与概念绑定 |
| `research-series-proposal-validation.ts` | `proposals/series-validation.ts` | 修改提案中数据调用的校验，消费 catalog/datasets |
| `pyright-language-service.ts`、`research-language-document.ts`、`research-language-stubs.ts` | `language/` | 编辑器协议与 Python 类型信息 |
| `equity-fcff-*.ts` | `templates/fcff/` | 模板、分类证据与回放案例，不放入通用财务解析 |
| `research-factor-drafts.ts`、`research-strategy-drafts.ts`、`research-factor-handoff.ts`、`research-strategy-handoff.ts`、`research-handoff-context.ts` | `handoff/` | 从冻结执行生成草稿、校验并关联来源 |
| `backtest-report-document.ts` | `documents/from-backtest-report.ts` | 将报告变为研究文档的业务操作 |
| `curator.ts`、`curator-job.ts`、`curator-reference-search.ts` | `curator/` | 整理任务 |
| `screen-data-migration.ts` | `apps/api/scripts/migrations/screen-to-research.ts` | 历史迁移实现；先确认调用方，再迁移并保留 CLI 行为 |

拆分 `workbench.ts` 时先按函数责任分组，再处理依赖：

- `dependencies` 不调用执行器；它产生分析结果和运行计划。
- 文档编辑调用依赖失效操作，执行器消费文档版本及运行计划；避免 documents 与 execution 互相导入实现。
- 共用的文档读取和版本校验留在 documents 的窄入口；共用无副作用错误/值类型放在实际责任子目录。
- proposals 可以编排文档操作和执行操作，执行器通过明确的审阅状态查询检查未完成 review；不反向导入整个提案应用流程。
- evidence 负责记录，不能导入执行器或 SDK dispatcher。
- 先保留现有操作顺序、锁作用域和事务，再去除旧总文件；不借拆分重新设计依赖图算法。

### 5.5 Factor：分清定义、观察数据、检验和发布

- `builtin-factors.ts`、`metadata.ts`、`factor-v2-fields.ts` → `definitions/`。
- `analysis.ts`、各 evaluator、`cross-sectional-inference.ts`、`evaluation-scope.ts`、分析/相关任务与 worker → `analysis/`；横截面、时间序列、Panel、宏观状态保持不同实现。
- `*-observations.ts`、`*-data-cutoff.ts` → `observations/`；资产/可得性口径随文件一起迁移。
- `report-spec.ts`、当前 `research.ts` 中 holdout 纪律及计数 → `reports/`，将后者命名为 `research-policy.ts`，避免和 Research 产品混淆。
- `publication.ts`、`panel-composite-publication.ts` → `publication/`；`composite.ts`、`panel-composite-source.ts` → `composition/`。
- 编译器、Python validator/runtime、`factor-sdk.ts`、`factor-codegen-prompt.ts` → `runtime/`；预置 time-series/panel/macro templates → `definitions/templates/`。
- `weather.ts` → `weather/`；HTTP、刷新状态、计算若确实混在一个大文件，再按这些责任提取，不按文件长度硬拆。
- 从路由抽取因子创建/更新/复制与发布操作；检查报告代码哈希、运行时版本、用户归属和发布准入的逻辑仍由 factor 拥有。

验收必须覆盖：holdout 规则、代码变更使旧报告不可用于发布、组合来源、历史报告保留、研究专用输入不得越过现有部署限制。

### 5.6 Strategy 与 Engine：业务执行和模拟计算分开

| 当前文件或文件组 | 目标 | 说明 |
| --- | --- | --- |
| `services/strategy-service.ts` | `strategy/definitions/` | 按保存配置、命名等具体职责提取；命名竞争检查和 runKey 语义保留 |
| 回测路由中的事务 | `strategy/backtest/submit.ts` | 归属检查、重复任务检查、配置/报告/Job 创建是一个操作 |
| `strategy/backtest-job.ts`、`engine/backtest-worker.*` | `strategy/backtest/` | 任务启动和执行入口靠近报告业务 |
| `strategy/scan*.ts`、`engine/strategy-scan*-worker.*` | `strategy/scans/` | 保留父 worker 和 cell 子进程结构、超时与资源释放 |
| `engine/configured-run.ts` | `strategy/execution/run-configured.ts` | 策略语言分派与风险结果附加 |
| `engine/prepare-custom-factors.ts` | `strategy/execution/prepare-factors.ts` | 已发布因子选择、权限与依赖血缘 |
| `strategy/code/*` | `strategy/runtime/typescript/` | 策略编译、SDK、参数、schema、prompt、仓库脚本直接运行入口 |
| `engine/walled-run.ts`、`wall-entry.ts` | `strategy/runtime/typescript/` | 这里封装策略 SDK + engine 的隔离执行，不是通用 isolate 工具 |
| `engine/run.ts`、`portfolio.ts`、`futures-portfolio.ts` | `engine/simulation/` | 模拟计算核心与账户规则 |
| `engine/data.ts`、`data-port.ts` | `engine/data/` | 数据接口及历史时点计算 |
| `engine/custom-factor.ts` | `engine/factors/` | 引擎内因子求值 |
| `engine/prisma-port.ts`、`python-factor-host.ts` | `engine/adapters/` | 宿主侧存储与 Python 计算桥接 |
| `engine/fixture-port.ts` | `engine/testing/` | 保持测试数据端口可用于开发脚本 |
| `engine/allocation-analysis.ts` | `engine/simulation/allocation-analysis.ts` | 逐日跟踪持仓、成本与再平衡，直接被交易循环调用；保留在模拟核心，区别于回测后的风险分析 |
| `engine/strategies.ts`、`strategy/zeng.ts` | `strategy/examples/` | 仓库内策略示例，保留脚本可用性 |

当前 `engine/run.ts` 默认导入 `prismaDataPort`，隔离 bundle 用 esbuild 插件替换该依赖。本次目标是让模拟核心显式接收 DataPort，并在宿主执行入口补上默认 Prisma 端口。所有直接调用者必须同步更新，不能只让生产入口通过。

该调整必须以现有 direct/walled 一致性测试验证。隔离入口继续禁止 Node、Prisma、文件系统和网络依赖进入 bundle；移除旧 alias 前证明新 bundle 不含宿主依赖。DataPort 的方法与数据语义保持不变。

不在这次重整中拆解整套交易日算法、增加撮合接口层或统一所有金融分析器。

#### 5.6.1 风险分析归属策略报告

2026-09-08 核对实际调用链后确认：risk 当前主要服务于策略回测结果，没有独立 HTTP endpoint 或独立页面。产品位置是“策略工作台 → 回测结果 → 结果概览 → 多资产配置归因 → 风险研究”。前端 `apps/web/src/complex/lab/lab.tsx` 中的 `AllocationRiskPanel` 展示市场风险、宏观敏感度、Alpha / Risk 重合与压力情景，仅在报告有相应结果时出现。

保持以下链路与契约：

```text
POST /api/app/strategy/backtest
  → 回测任务 / Worker
  → strategy/execution/run-configured
  → strategy/analysis/risk/backtest-risk-analysis
  → result.allocationAnalysis.risk
  → BacktestReport

GET /api/app/strategy/backtest/reports/:reportId
  → 完整报告
  → 策略工作台的“风险研究”面板
```

风险分析是可选的回测后处理。保留现有 allocationAnalysis、样本数量、日期与数据血缘门槛，缺失数据不改成零风险；当前失败日志及不阻断主回测结果的行为保持不变。不新增风险 API、实时风控、独立风险页面或其他业务调用。

| 当前文件 | 目标 | 职责 |
| --- | --- | --- |
| `risk/backtest-risk-analysis.ts` | `strategy/analysis/risk/backtest-risk-analysis.ts` | 从回测收益和因子报告组织风险计算，附加结果 |
| `risk/market-risk-model.ts`、`macro-risk-model.ts` | `strategy/analysis/risk/` | 日频市场暴露与月频宏观敏感度模型 |
| `risk/alpha-risk-overlap.ts`、`risk-scenarios.ts` | `strategy/analysis/risk/` | 因子收益重合诊断与压力情景 |
| `risk/market-risk-drivers.ts` | `market/state/market-risk-drivers.ts` | 构造带单位、日期和血缘的跨资产市场驱动序列 |
| `risk/macro-risk-axes.ts` | `market/macro/risk-axes.ts` | 宏观轴历史状态、变化与可得性，不依赖组合收益 |
| `risk/market-risk-quality.ts`、`macro-risk-quality.ts` | 基础检查分别归 `market/quality/market-risk-drivers.ts`、`market/macro/risk-axis-quality.ts`；模型就绪检查归 `strategy/analysis/risk/data-readiness.ts` | 区分数据质量和某个风险模型的最低历史要求 |

质量检查拆分需处理现有依赖：`macro-risk-quality.ts` 当前导入模型的最低样本数。market 的基础检查输出覆盖、缺失、可得性与 vintage 信息；依赖具体模型窗口/样本门槛的判断留在策略风险分析。由 `maintenance/data-audit.ts` 组合市场基础审计和策略模型就绪检查，保持现有审计报告结构、阈值、状态与 CLI 输出。不能让 market 反向导入策略模型，也不能复制常量导致审计与模型门槛漂移。

两个附带调用关系须记录而不扩大：

- 策略 Agent 的快速回测复用 `runConfiguredBacktest`，可能经过风险计算，但 `metricSummary` 只返回绩效指标，当前并未把风险分析交给 Agent。迁移保持该行为；是否省略这部分计算是独立优化。
- 数据审计调用风险输入质量检查，属于数据/模型就绪验证，不是第二个组合风险产品入口。当前没有发现 Factor 工作台或每日信号独立调用整套风险分析。

`engine/allocation-analysis.ts` 的 `AllocationAnalysisTracker` 在交易循环中逐日累计数据，不能随原 risk 目录直接搬进 strategy，造成 engine 核心反向依赖策略报告模块。报告后处理从 engine 结果读取数据，调用方向保持单向。

验收增加：风险计算结果及报告 JSON 等价；相同数据条件下“风险研究”面板的显示条件与内容不变；风险缺失/失败不影响主结果；Agent 快速回测摘要不意外新增风险字段；市场审计无需导入策略实现。

### 5.7 Signals、Agent 与 Library

**Signals**：拆 `service.ts` 中的部署、运行记录、入队、子进程管理与结果转换，分别归 deployments/runs；`engine/signal-worker.*` 移至 `signals/runs/`。accounting 与 factor inputs 各自归位，保留 scheduler/sync/notifier 的具体名称。每日信号的 TS/资产支持限制、配置冻结、人工成交和结算幂等保持不变。

**Agent**：保留 core/profiles/tools 结构；`turn-run.ts`、`turn-bus.ts` 归 turns。`persistence.ts` 按实际函数拆出对话记录与 turn 轨迹，不能为了迁移改消息内容或持久化顺序。`engine/agent-backtest-worker.*` 归 `agent/tools/quick-backtest/`，其调用的策略执行能力由 strategy 提供。

`render-chart.ts`、`render-computed-chart.ts` 及相关校验归 `agent/tools/charts/`；`read-only-sql.ts`、`sql-worker.ts`、对应 `.boot.mjs` 和 Node SQLite 类型补充归 `agent/tools/sql/`。同步工具注册、测试 mock、worker URL、SQL 白名单文档引用；函数名、工具名和权限规则保持不变。

Research handoff 当前调用 `agent/core`，Agent profile 又消费 Research 能力。允许上层 profile/tool/handoff 有定向组合关系，但 core 只依赖工具协议与模型接口，不能导入 profiles 或领域实现。不要求各业务顶层目录形成完全无环图；约束应落实到这些实际子模块。

**Library**：保留跨领域聚合职责。策略/因子只读入口输出库需要的投影，复制入口完成用户归属和默认状态设置。没有复用价值的单次聚合查询可以留在 library，但不得直接修改他域生命周期状态。

### 5.8 行情、领域数据与运维

| 当前位置 | 目标 | 边界 |
| --- | --- | --- |
| `tushare/*` | `market/providers/tushare/` | 外部协议、重试、能力探测；沿用已有实现 |
| `store/sync.ts` | `market/sync/` | 按股票基础、交易日历、股票日行情、ETF、指数、期货等实际函数组拆分 |
| `store/etf-market-sync.ts` | `market/sync/etf.ts` | ETF 同步与覆盖 |
| `store/*presets.ts`、`etf-research-registry.ts` | `market/registry/` | 将纯静态列表和需 Prisma 的操作分文件，避免静态导入拉入数据库 |
| `market/stock-identity.ts`、`instrument-resolver.ts` | `market/instruments/` | 股票代码、历史身份与证券解析 |
| `data-quality/*` | 基础审计归 `market/quality/`；跨市场数据与策略模型的报告组合归 `maintenance/data-audit.ts` | 保持整体审计结果，避免市场模块反向依赖策略风险模型 |
| `market/instrument-series.ts` | `market/queries/` | 行情序列查询；暂不统一各领域的系列 loader |
| `market/market-state.ts` | `market/state/` | 市场和行业状态计算及读取；按实际职责提取 |
| `market/sync-market-indicators.ts` | `market/sync/` | 派生指标写入；复用 state 中的计算能力 |
| `market/index-valuation.ts` | `market/valuation/` | 指数估值计算与读取 |
| `market/cross-market-benchmarks.ts` | `market/sync/` 与 `market/queries/` 中的基准操作 | 按已有同步与读取职责拆分，保持来源、日期和币种口径 |
| `fundamentals/*` | `market/fundamentals/` | 财报来源、同步、版本解析、标准化、指标与质量检查整体归位；研究模板留在 research |
| `rates/*` | `market/rates/` | 利率曲线及相关外部数据能力整体归位；回测组合风险解释归 strategy/analysis/risk |
| `macro/*` | `market/macro/` | 宏观发布、修订、历史可得性及状态计算整体归位；因子检验留在 factor |
| `commodity/*` | `market/commodity/` | 商品合约、连续收益、持仓、仓单及其同步和质量检查整体归位 |
| `risk/*` | 按 5.6.1 拆分到 `strategy/analysis/risk` 与 market 数据能力 | 分析跟随策略报告，基础数据准备与质量检查归市场；删除旧顶层 risk 入口 |
| `maintenance/*` | 保留 | 调度、发布水位、锁、修复、自愈、参考数据子进程和 HTTP 运维门禁 |

同步函数可被 CLI 和维护任务复用，不能导入 HTTP、Agent 或 Research 文档执行逻辑。市场数据表进入 SQL 白名单的规则继续执行；用户数据不进入 Agent 市场只读 SQL 白名单。

上述四个子领域默认只迁移目录和更新引用，保持现有内部组织；不借本次归位抽象共同父类、统一数据模型或重写算法。所有导入方、测试、CLI、源码路径说明同步更新，子领域内部的来源/同步/计算/质量职责在模块说明中明确列出。

## 6. 依赖与事务规则

### 6.1 允许的调用形态

```text
index → bootstrap → server（构建 HTTP 应用）+ Infra 资源 + 业务启动/恢复操作
HTTP 适配 / CLI / Maintenance 编排
  → 具体业务操作
  → 数据解析 / 计算 / Prisma / runtime

Research SDK dispatcher → Research datasets → 对应数据领域
Strategy execution → Factor 依赖入口 + Engine + Strategy risk analysis + Runtime
Strategy risk analysis → Market 驱动序列与基础质量 + Math
Maintenance data audit → Market 基础审计 + Strategy 模型就绪检查
Agent profile/tool → 业务操作或只读查询入口
Jobs queue → 启动时传入的任务处理函数
```

- 路由允许 Hono；领域操作和计算函数不接收 Hono Context。
- 路由中的资源授权、状态转换和复杂事务迁入业务操作。HTTP 认证不能代替操作内部的资源归属校验。
- 业务模块允许直接使用 Prisma。跨模型事务由业务操作拥有，不在多个 helper 中分别提交。
- `infra/runtime` 和 `infra/jobs` 不依赖业务模块。engine 的 simulation/data/factors 核心不依赖 HTTP 路由、任务队列、Agent、Research、Prisma；adapters 明确例外。
- `math`、`date.ts`、纯消息目录 `i18n` 不依赖业务模块、数据库、网络或 HTTP 请求上下文；它们不拥有业务状态。
- market 不依赖策略风险模型；engine 模拟核心不依赖策略报告分析。完整审计的跨业务组合在 `maintenance/data-audit.ts` 完成，由维护任务或 CLI 显式调用。
- 不建立导出所有实现的顶层 barrel。跨业务调用使用已命名的窄文件入口；纯类型不得通过带副作用入口导入。

### 6.2 自动化约束

优先复用现有 ESLint 和 TypeScript，不增加架构框架依赖。实施时增加 `scripts/check-backend-boundaries.mjs` 及对应测试，并提供 `pnpm check:backend-boundaries`，接入根级 typecheck/build 门禁。

检查范围：

1. 非 HTTP/启动适配导入 Hono；HTTP 路由直接导入 Prisma。
2. `infra/runtime`、`infra/jobs` 通用模块反向导入具体业务；业务或通用设施反向导入 index/bootstrap/server 启动与 HTTP 总入口；math/date/i18n 纯辅助引入业务或运行设施。
3. engine 核心引用宿主存储、HTTP 和任务模块。
4. 静态 import、re-export、字面量动态 import 的路径规则；用 TypeScript AST 和路径解析，不能只按文本关键词匹配。
5. 被迁移的旧路径、生产源码对测试文件的意外依赖、新增跨边界循环。

依赖基线应区分类型边和运行时边，记录已有例外及原因。目标是消除本次涉及边界的循环，不承诺在目录重整中消除所有既有业务依赖。worker URL、esbuild 入口、脚本字符串路径另做清单与启动检查，不能宣称 import 检查覆盖它们。

## 7. 实施工作包与顺序

以下工作包是同一重整目标的依赖顺序和验证单元，提交可按实际职责拆分，不改变整体交付范围。整体目标仍为完成全部范围；2026-09-08 用户确认采用分提交评审工作流，具体执行顺序见 7.1。每个提交先说明范围并确认，再实施与验证，完成后等待提交授权；push 由用户手动执行。

| 工作包 | 依赖 | 开发事项 | 完成标准 |
| --- | --- | --- | --- |
| A：基线与业务地图 | 无 | 记录实际 HEAD、工作区变更、路由、对象、任务、运行入口；建立精确文件映射与依赖基线 | 每个现存源文件有迁移或保留结论；基线测试结果可追溯 |
| B：公共设施归位 | A | infra/math/i18n/date 归属落实，认证归位；拆 Python 传输与领域协议 | 所有调用方切换，Python 三条链路通过，公开契约无 diff |
| C：任务责任拆分 | B | infra/jobs 记录/日志/队列、bootstrap 启动与资源装配、领域完成事务与恢复 | 五类 Job 正常/失败/恢复行为保持，事务与日志语义通过验证；启动/关闭资源归属及 API/CLI 入口核对完成 |
| D：Research 内聚整理 | B、C | documents/dependencies/execution/evidence/proposals/datasets/catalog/sdk/language/templates/handoff/curator | 编辑→失效→运行→冻结→提案→交接链路通过 |
| E：Factor、Strategy 与 Engine | B、C | 因子报告/发布边界；策略操作与风险报告分析；风险输入数据/审计归位；engine 纯计算与适配；worker 路径迁移 | 因子发布与报告历史、TS/Python 回测、风险面板与数据审计、参数扫描及引擎一致性通过 |
| F：Signals、Agent、Library 与数据同步 | D、E | 运行入口归业务；对话持久化；公开库；市场业务及 fundamentals/rates/macro/commodity 四个子领域统一归入 market，Tushare 配置随 provider 归位，同步调用方与 CLI | 信号/对账、SSE、研究数据、数据维护链路通过 |
| G：边界门禁与整体收尾 | B–F | 收紧依赖规则、移除转发文件、更新路径文档、完整构建/E2E | 所有目标目录与业务说明一致，无旧路径，完整验收通过 |

每个工作包内部遵循：先等价迁移与更新引用，再提取函数责任，最后删除旧入口。每一步保持可构建，避免先移动全仓、最后集中修错。临时转发文件只能服务于当前实施过程，最终交付前移除；不保留双路由或两套业务实现。

### 7.1 已确认的提交规划与进度

预计 12 个 commit，合理调整范围为 10～14 个。编号代表预估顺序，不为凑数量拆分；若某项需要拆开或合并，在对应提交实施前说明原因。每个 commit 同步调用方、脚本、测试和路径文档，保持可构建、可回退；第 12 项只负责最终门禁与整体收尾，不替前面提交补欠账。

| Commit | 工作包 | 提交范围 | 主要验证 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | A | 固化方案、文件归属、路由/运行入口、依赖与测试基线 | 类型检查、SDK 一致性、后端测试与环境限制 | 已完成，本次提交 |
| 2 | B | 公共辅助、infra/database/http/llm/email、math/date/i18n 与认证归位 | 初始化行为、相关测试与类型检查 | 待开始 |
| 3 | B | 公共 Python 通信、领域协议、TS isolate 辅助及引用 | Research/Factor/Strategy 运行链路 | 待开始 |
| 4 | C | Job 通用设施、领域完成/恢复事务、bootstrap 启动装配 | 排队/失败/恢复、事务回滚、API/CLI 入口 | 待开始 |
| 5 | D | Research 文档、依赖、执行、证据、提案 | 编辑→失效→执行→取消/冻结→提案 | 待开始 |
| 6 | D | Research 数据、SDK、目录、语言服务、模板、交接、整理及 HTTP | 公开列映射、契约、语言服务与交接 | 待开始 |
| 7 | E | Factor 定义、观察、分析、报告、发布、组合、运行与 HTTP | 发布纪律、历史报告、分析 Worker | 待开始 |
| 8 | E | Strategy 与 Engine 分离，风险分析及风险数据/审计边界 | TS/Python 回测、参数扫描、风险结果、引擎一致性 | 待开始 |
| 9 | F | Signals 部署、运行、对账、因子输入、Worker 与 HTTP | 冻结配置、幂等运行、失败收尾、对账 | 待开始 |
| 10 | F | Agent turns/conversations/tools/Worker、Library 操作与 HTTP | SSE、取消、工具权限、公开库复制 | 待开始 |
| 11 | F | Market 子领域及其余市场职责、Maintenance 与 CLI | 数据口径、幂等同步、质量门禁、审计 | 待开始 |
| 12 | G | 边界门禁、架构阅读地图与剩余旧路径清理 | 完整构建、相关测试、受影响 E2E、运行入口 smoke | 待开始 |

Commit 8 将风险模型、市场风险数据与整体审计调用的边界一起调整，避免保留 market → strategy 的反向依赖；Commit 11 整理剩余市场和维护职责。Commit 4 提取的领域完成/恢复操作直接落在目标目录，后续领域整理复用这些入口，不再重复搬迁。其余跨提交的路径变化按调用方同步原则处理。

Commit 1 的开发者交付为本文和 [重构基线](backend-architecture-refactor-baseline.md)，不改变产品功能、HTTP、Prisma schema 或公开 SDK。基线记录实际 HEAD、455 个 API 源目录文件的逐文件归属、HTTP 注册顺序、API/CLI/Worker 入口、现有依赖问题和验证结果；后续以具体 commit hash 与测试结果更新进度，不把已确认方案误标为已实现架构。

## 8. 测试与验收计划

### 8.1 当前行为基线

实施前运行已有相关测试并记录失败原因，不把原有失败与重构回归混在一起。使用隔离测试数据库和确定性 fixture；数据维护验证不能写开发者已有市场数据库或触发真实邮件。

跨所有工作包的最低等价要求：HTTP 契约和权限一致；相同输入的报告数值、数据列、哈希与状态结果一致；任务重启、取消、失败处理不因文件搬迁改变。

### 8.2 行为矩阵

| 范围 | 重点断言 | 现有验证入口示例 |
| --- | --- | --- |
| 启动装配 | buildApp 不启动运行资源；恢复先于领取任务；API/CLI 不重复启动队列；已有失败/退出清理行为保持 | 启动入口相关测试、隔离数据库 smoke 与现有开发进程清理测试；缺失行为单列记录 |
| API 权限与资源 | 未登录、跨用户读写、资源不存在、错误结构、路由顺序 | `routes/multi-user-permissions.test.ts`、`routes/backtest-report-route.test.ts` |
| Job | FIFO/用户并发、旧 queued payload、运行恢复、损坏 payload、报告与 Job 原子终态 | `lib/job-queue.test.ts`、`lib/jobs.test.ts`、`lib/jobs-backtest-report.test.ts` |
| Research 文档 | 自动保存、版本冲突、删除依赖、stale/blocked、运行互斥、取消与 reset | `research/workbench*.test.ts`；E2E `research-autosave`、`research-cell-deletion`、`research-affected-run`、`research-interrupt` |
| Research 证据与提案 | 干净执行、历史快照、产物归属、审阅与执行、交接来源 | execution-records、cell-change、handoff 测试；E2E `research-execution`、`research-cell-change-review` |
| Research 数据与 SDK | 财务值、PIT、序列/Panel、报告结果数据集、SDK 请求校验 | financial-values/dataset、series、workbench-sdk/runtime 测试；E2E `research-financial-data`、`research-factor-report-sdk` |
| Factor | 报告历史、holdout、发布哈希、组合与各 evaluator | publication、analysis、evaluator、report-spec 测试；E2E `factor-publication`、`factor-report-history`、`python-factor` |
| Strategy/Engine | TS/Python、direct/walled 一致性、交易规则、扫描与报告历史 | engine/strategy 现有测试；E2E `python-strategy`、`strategy-parameter-scan`、`backtest-report-history` |
| 策略风险分析 | 市场暴露、宏观敏感度、重合与情景结果；数据不足/失败；报告序列化和面板显示条件 | 原 `risk/*.test.ts` 及数据审计测试；在回测 E2E 中补齐确定性风险报告 fixture 与面板断言 |
| Signals | 冻结配置、依赖、幂等运行、失败、人工成交与账户结算 | signals/accounting 测试；E2E `daily-signals`、`strategy-factor-dependency` |
| Agent | SSE 重连、取消、消息写入顺序、工具权限、校验修复 | core/persistence/turn-bus 测试；E2E `research-agent-cell-context` |
| 数据维护 | 幂等同步、来源/日期、质量失败不发布、锁与恢复 | store、maintenance、fundamentals、commodity、macro、rates 的 fixture 测试 |
| Python 与进程 | 会话协议、超时、断连、容器清理、worker 线程/子进程资源释放 | sandboxd 与 Python runtime 测试、开发进程清理测试、编译后入口 smoke |

表中名称引用迁移前位置；迁移后按映射运行。E2E 文件均在 `apps/web/e2e/`，运行前先读取其 README 与参数/环境要求，不假定所有脚本都能裸执行。

只补业务保护缺口：例如已有测试未覆盖的旧 payload 恢复、提取后的跨实体事务回滚、开发/生产 worker 路径。不给每个移动后的函数补镜像测试，不用大量内部 mock 固定拆分后的实现细节。

### 8.3 检查命令与时机

每包运行受影响测试和类型检查；整体收尾运行：

```bash
pnpm check:research-runtime
pnpm check:research-sdk
pnpm check:factor-sdk
pnpm check:backend-boundaries
pnpm typecheck
pnpm --filter api test
pnpm --filter sandboxd test
pnpm lint
pnpm build
pnpm test:dev-shutdown
node --test scripts/plan-deployment.test.mjs
```

`check:backend-boundaries` 是本计划新增命令，其余命令已存在。根级 typecheck/build 已包含 SDK/运行时一致性检查；实际执行可以避免重复跑已通过且未受后续改动影响的检查。

整体 E2E 选择覆盖上表所有实际受影响链路的集合，复用现有脚本；不为路径迁移重跑所有无关公开帮助页面。涉及 E2E 的验收应检查并交付截图，结束后关闭临时 API/Web/sandboxd，确认端口、连接和子进程释放。

### 8.4 仅 typecheck 不足以覆盖的入口

- 开发 `.boot.mjs` → `.ts` worker 相对路径。
- 生产 `dist/src/**` 中 `.js` worker 与子进程路径。
- `new URL(..., import.meta.url)`、`resolve(process.cwd(), ...)`、`fork` 和 `Worker` 参数。
- esbuild 的 wall-entry、插件匹配与纯计算依赖。
- API scripts 导入、SDK 生成脚本、Python stub/Pyright 路径、测试 fixture、E2E 中引用的模块路径。
- 纯 `tsc` 构建不会自动清除旧产物；验收需使用干净的隔离构建目录/工作树，证明没有依赖残留 dist 文件。部署按已有构建流程核查，不随意删除用户本地目录。

开发入口和编译后入口各做一次真实 smoke，使用 fixture 和独立数据库。Python/容器环境不可用时必须明确列出未验证项，不把本机 Python 测试记为生产隔离验收通过。

## 9. 文档、脚本与部署同步

实现时同步以下位置：

- `CLAUDE.md`：目录约定、Prisma 位置、SQL 白名单位置、Python runtime 位置、已实现的 worker 描述，移除“未来 src/backtest”等失真说明。
- `README.md`：后端目录与阅读入口，链接新的架构说明。
- 新建 `docs/backend-architecture.md`：作为当前实现的阅读地图，包含业务对象、运行图、三条典型调用链、模块入口、启动顺序、资源归属与关闭顺序、状态生命周期和常见修改定位。与本文的“开发计划”分开，实施完成后才标为当前架构。
- 主要业务模块补短 `README.md`：职责、拥有的对象、主要操作、允许依赖、关键测试。无必要不为每个子目录建文档。
- `docs/design/api-route-naming.md`、`python-and-sandbox.md`、`reactive-quant-research-workbench.md`、`strategy-run-orchestration.md`、`production-maintenance.md` 等更新当前路径；历史决策保留并标注被替代的描述。
- `apps/api/scripts`、根级 `scripts`、测试、生成器与部署检查中的源码路径同步变更。
- 公开帮助、双语文案及 SDK 文档做影响判断：本次若严格保持产品行为/公开契约，不改用户操作说明；内部文件路径引用仍须修正。若需要改 `apps/web` 或 `apps/docs` 实现，先完整阅读 `apps/web/CLAUDE.md`。

不新增/重命名 workspace 或改变跨包构建依赖时，API 内部迁移仍由 `deploy/component-impact.json` 的 `apps/api/` 前缀覆盖，无需为了目录变更修改部署分类。新增边界脚本位于根 `scripts/`，按现有规则触发全量部署，这是已知影响。

如果实施确实增加/重命名可部署包或改变跨包构建依赖，必须在同一变更更新 `deploy/component-impact.json` 和 `scripts/plan-deployment.test.mjs`。未知路径触发全量部署的保护规则必须保留。

本次默认不改 Prisma schema，因此不生成 migration。若意外需要 schema/SDK 变更，应重新确认是否属于独立需求；一旦有公开契约变更，完整遵循根说明中的 Contract→生成物→校验流程，不手改 `.pyi`。

## 10. 风险控制与回退

| 风险 | 预防与判定 |
| --- | --- |
| 只搬目录，仍有巨型总入口与反向依赖 | 检查每个业务操作和状态责任；完成函数职责拆分后再删除旧入口 |
| 拆分引入循环 import 或重复单例 | 类型/运行时依赖分别检查；session manager、turn bus、日志缓冲、队列各只有一份实例 |
| 报告与 Job 出现不一致终态 | 保留单事务；验证失败、回滚和启动恢复 |
| 老 queued 任务不可执行 | 使用旧格式 payload fixture；不依赖源码路径作为持久化标识 |
| 本地通过、编译后找不到 worker | 干净构建，逐项 smoke 线程/子进程入口和 esbuild wall bundle |
| 调整数据目录改变金融口径 | 使用固定历史 fixture 比对返回列、可得日期、数值和缺失语义 |
| 路由抽取漏掉归属或过滤条件 | 操作级跨用户测试、公开库复制、报告/产物读取测试 |
| 改进结构演变为功能扩张 | 将发现的调度/算法/多市场能力问题单列，不纳入本次行为等价修改 |
| 覆盖其他正在进行的业务修改 | 每包开始核对工作区和文件基线；只迁移已整合的实现，不使用历史版本覆盖当前代码 |

回退单位是完整、自洽的变更集合，包含源码、脚本、生成路径引用与文档；不能只恢复旧文件路径。保持数据库和公开协议不变后，部署可以切回上一完整构建。回退前处理当前运行任务与会话，沿用已有维护/部署流程；代码回退不意味着进程内会话可以恢复。

## 11. 完成定义

- [ ] 所有当前后端源文件有明确迁移或保留归属，本文映射与最终结构一致。
- [ ] 不熟悉项目的人能从模块 README 找到对象、状态、业务入口与关键测试。
- [ ] Research 编辑/执行/证据/提案分开，复杂度没有转移到新命名的巨型文件。
- [ ] Factor 定义、报告和发布职责清晰；Strategy 执行与 Engine 模拟核心分开。
- [ ] 公共 Python 通信不再藏在 strategy；三种领域 SDK 语义仍各有归属。
- [ ] Job 调度不直接拥有业务报告，领域完成和恢复仍保持原有事务。
- [ ] 启动统一由 index/bootstrap/server 分工，不建立 application 模块；业务恢复规则留在所属模块，整体数据审计归 maintenance。
- [ ] 资源创建、装配、启动与关闭的责任明确；不因导入模块意外启动队列或监听端口，不改变独立 sandboxd 的进程归属；已有生命周期行为保持，缺口独立记录。
- [ ] 所有 worker 随所属业务归位，开发与生产的线程/子进程路径均验证。
- [ ] 顶层旧 routes/services/lib/store/tushare/data-quality/types 等迁移来源目录无残留运行实现或转发层；原 Tushare 专用 config.ts 已随 provider 归位。
- [ ] 公共运行设施统一归 infra，共用计算归 math，i18n 保留顶层，日期辅助为 date.ts；不创建 common/utils 或单文件占位模块。
- [ ] 市场获取、同步、查询和分析统一归入 market；fundamentals/rates/macro/commodity 已作为其子领域归位，旧顶层入口无残留实现或转发层。
- [ ] 子领域自身的同步、查询与质量规则保持内聚；跨子领域辅助、maintenance 编排、Research 模板、Factor 检验和 Strategy 风险分析的边界明确。
- [ ] 风险分析归 strategy/analysis/risk，旧顶层 risk 无残留实现或转发层；报告接口和产品展示保持不变，市场数据与基础审计不反向依赖策略模型。
- [ ] HTTP、数据库、公开 SDK、金融口径、调度与资源限制保持等价。
- [ ] 依赖检查、类型检查、相关测试、完整构建和受影响 E2E 完成，失败和环境限制有明确记录。
- [ ] 开发说明与实际路径一致，临时进程和数据库连接已清理。

最终评审用五个定位问题检查可读性：修改 Cell 过期规则去哪里、因子发布检查去哪里、回测报告何时冻结、每日信号失败由谁收尾、Python 请求财报数据经过哪些入口。另核对进程从哪里启动、资源由谁关闭，确认入口代码足以解释运行顺序。评审者应能依靠目录和短说明定位，不必先读完整项目历史。
