# 机械交易系 (jixie) — Claude Code 工作指南

个人多市场量化研究实验室。名字取自《机械交易系统》——"系"如门派,承载被动、机械、成体系的投资理念。愿景与进度见 `README.md`，学习范围见 `docs/learning-map.md`。

## 项目定位与当前优先级

- **当前第一目标是系统学习量化投资并构造分析工具**，不是尽快接入实盘。研究与回测能力都为理解和验证服务；模拟盘、实盘和券商执行保留为长期阶段，不能挤占当前学习与研究主线。
- **研究范围是多市场、多资产**：目标覆盖中国内地、香港、美国的股票、债券和商品。现有 A 股 / ETF / 股指期货能力是已经落地的第一块，不是产品永久边界。
- **量化证据优先**：结论必须来自明确假设、可追溯数据、可复现计算和恰当统计检验，不把宏观叙事、图形直觉或 LLM 判断直接当成投资结论。
- **长期目标是可执行的风险调整收益**：寻找并验证能在真实成本和严格样本外约束下保持费后正收益、且 Sharpe / Calmar 良好的策略组合；不能把样本内最大化 Sharpe / Calmar 当成成功标准。
- **学习范围可以广，正式产品表面必须收敛**：一个知识主题先用文献笔记、Agent 对话、Research Python、脚本或研究报告复现；只有反复使用且需要稳定契约的工作流才进入正式页面、共享类型或持久化模型。

- **基本面研究职责**：基本面研究平台负责来源、字段口径、历史可得时间、缺失提示、公式实现和结果可复现；用户选择分析方法、预测假设和投资结论。用户在普通 Python 中选择分析方法与估值假设，不以策略盈利或价格兑现作为平台能力交付条件。 Factor 发布固定当前代码与匹配的成功报告，不以盈利或统计显著性为门槛；日期由用户选择，不要求研究卡或 holdout。每个用户／因子只保留最近提交的普通分析、发布绑定报告与活动任务，旧普通报告及其 Job／日志会清理；内置版本只初始化缺失项，升级使用新 key，不覆盖已保存的发布源码。

### 探索、验证与执行三层

- **探索层**：Research 页面是 jixie 原生的响应式量化研究文档，只承载 Markdown / Python Cell、Agent、
  平台数据和图表；复用 Python 沙箱、Research SDK与语义目录，不引入 Jupyter，也不
  建设一套与 Research 平行的 Notebook 产品。统计方法和公式写进可读文档，实际计算写进 Python；上游变化
  必须使下游输出显式 stale，核对计算时使用干净环境完整执行。
- **验证层**：FactorReport、代码快照、PIT、稳健统计、真实成本和数据截止日负责把探索结论变成可复查证据。
- **执行层**：策略回测保留窄而稳定；当前不以扩券商、自动下单或实盘运营为建设重点。

Factor / Strategy 对话的嵌入式分析实现与验收记录见
`docs/design/embedded-python-analysis.md`。它复用 Research Python 能力，成功后仍可编辑，每个草稿只保留最近运行，接续 Research 复制当前代码和参数并重新取数；
普通 Research 文档继续可编辑。对话计算使用嵌入式 Python；旧聊天图表执行链已整体退役，读取旧消息时只显示标题和停用提示。
`math/stats.ts` 继续供正式业务使用，Factor/Strategy 的源码转换归 infra/sandbox/typescript/compile.ts。各提交的审查、验证和发布状态以该文档记录为准。

公开帮助和中英双语是学习产品的核心能力，不是发布后的装饰：中文和英文使用者都应能从概念说明进入真实页面、完成操作并理解指标限制。新增或改变用户可见研究能力时，必须同步判断帮助内容、SDK 参考和双语文案是否需要更新。

## 业务 / 研究方法论参考

- 因子研究的项目内业务参考书是 `docs/books/因子投资方法与实践（石川、刘洋溢、连祥斌）.epub`。
- 已结合 jixie 现状提炼为 `docs/books/因子投资方法与实践-项目指导.md`。修改因子数据口径、分析报告、因子准入、多因子合成、风险模型或组合构造前,先读该指导及对应设计文档。
- 书中方法用于指导研究纪律,不是逐字需求。具体市场制度、费率和项目已拍板设计以当前代码、`ROADMAP.md`、`docs/design/` 为准;不要把书中截至 2019 年的 A 股规则、固定涨跌幅或零交易成本设定照搬到其他时期和市场。

- 公司估值研究参考 `docs/books/穿透估值：读懂估值中的共识与博弈 - full.epub` 及 `docs/books/穿透估值-项目指导.md`；书中案例不替代当期公告、模型适用性和样本外验证。

## 技术栈(变更前先讨论 trade-off)

- pnpm workspaces monorepo(Node 20+,纯 ESM),结构参照 `~/Projects/marginalia`、`~/Tools/fangtu`
- 后端 `apps/api`:**Hono + Prisma 6(不升 7)+ SQLite**;dev `tsx watch`,prod `tsc` + `node`
- 当前主要数据源:Tushare HTTP API(`http://api.tushare.pro`,POST + token),client 见 `apps/api/src/market/providers/tushare`；扩展香港、美国或新资产时按数据许可、PIT 能力和可审计性单独选源，不假设 Tushare 能覆盖全部目标
- 前端 `apps/web`(登录与工作台)和 `apps/docs`(公开文档):React + Vite + Tailwind v4 + MobX「complex」架构(一页一 store)。**两个应用都遵循 `apps/web/CLAUDE.md` 的前端硬约定**(具名 BEM class + `.css` 里 `@apply`、classnames、FontAwesome、echarts)
- 共享类型 `packages/shared`

## 数据 / 存储宗旨(本项目核心原则)

- **ORM 优先:能用 Prisma 就用 Prisma。** 行情、因子、回测结果……默认都建 Prisma model,享受迁移、类型安全、Prisma Studio 可视化。
- **只有实测性能扛不住,才下沉到 `$queryRaw` / 原生 SQL**,且只针对那一条热路径,不整体抛弃 ORM。判断依据是"真的测出来慢",不是"我觉得会慢"——避免过早优化。
- 批量写入用 Prisma `createMany`;按交易日「先 `deleteMany` 当日 + `createMany`」保证可重复同步幂等(SQLite 不支持 createMany 的 skipDuplicates)。
- **改市场数据表 schema 时同步相关 loader、映射和数据口径说明**；只有公开 Research SDK 变化时才修改 SDK Contract。Agent 不提供任意 SQL 查询，用户私有数据必须在业务入口校验归属。
- **跨市场数据不能只靠代码字符串区分**：证券身份、交易所、市场时区、交易日历、交易币种、报价币种、公司行动、退市状态和数据 `availableDate` / vintage 必须有显式口径。收益比较必须说明本币或统一基准币及 FX 转换时点；缺少 PIT 历史时宁可标不可验证，不用今天的状态回填过去。

## Research SDK Contract 工作流

- **Prisma schema 是内部存储事实，不是 Python 公开 schema。** 禁止从 Prisma model 原样暴露或自动推断
  Research Runtime API；字段重命名、类型转换、指标选择、频率聚合和 PIT 语义必须经过显式服务映射。
- 修改 `apps/api/prisma/schema.prisma` 后，先判断是否改变公开 Research SDK。仅内部字段、索引、关系或 loader
  映射变化时，生成 Prisma migration、更新 loader / 映射和测试即可，不改 SDK Contract；市场数据表变化时同步相关数据口径说明。
- 公开方法、参数、枚举或返回列变化时，唯一真相源是
  `packages/shared/src/sdk/research/contract.ts`；同时修改 Python runtime 实现和 API 映射，不得另写一份 Monaco
  schema。`apps/sandboxd/python/jixie_research_sdk.pyi` 是生成物，禁止手工编辑。
- 修改公开契约后运行 `pnpm setup:sandbox`，再运行 `pnpm setup:sandbox --check`、`pnpm typecheck` 和相关测试。
  根级 `build` / `typecheck` 已把生成物一致性作为门禁；Git hook 只能提供本地快速反馈，不能作为正确性保证。
- `setup:sandbox` 的 SDK 生成步骤只从公开 Contract 派生产物，不读取 Prisma；默认模式另按需准备本地 Python 环境。Prisma → SDK 的业务映射需要人工决策；
  Contract → `.pyi`、Monaco 补全和 API 校验必须自动同步并由契约测试约束。

- Research 作者对象 `data/results/charts` 的实现归 `research/sdk/python`；Cell namespace、
  AST 分析、环境与输出序列化归 `research/sandbox/python`；`sandbox/research-sandbox.ts` 的宿主实例与
  `sandbox/research-sandbox-pool.ts` 的文档会话池只在 API 进程执行。
  请求校验与分派归 `research/sandbox/host`，私有图片产物归 `research/outputs`，数据查询与业务授权仍归 datasets。
  SDK 只依赖自己声明的 Capabilities，不导入 runtime；ResearchAdapter 实现请求能力，ResearchRunner
  持有 namespace/Cell 状态，run_research 只启动并接入 handler。sandboxd 负责公共循环、通信和限制。
- Research Python 辅助模块须逐项列入 Dockerfile、`.dockerignore` 和部署影响清单，同时影响 API/sandboxd；
  TS 宿主文件不进入 Python 镜像。shared 根导出及生成 `.pyi` 路径保持稳定。

## Strategy SDK Contract 工作流

- Strategy TS 公开签名、文档和 Agent 参考来源为 `packages/shared/src/sdk/strategy/reference.ts`。
  同目录 `contract.ts` 由现有声明生成器经 `pnpm setup:sandbox` 生成，禁止手改；Monaco 继续动态生成
  带用户可用因子 key 的声明，编译契约允许运行时解析的字符串 key。
- 修改公开签名后同步 Strategy SDK 实现与语言适配，运行生成物一致性和类型检查。`strategy/sdk` 的
  `StrategyContext` 实现完整公开签名，Runner 显式构造后调用作者回调，不能用把 EngineContext 整体断言成 StrategyCtx 的方式绕过检查。
- SDK 自有 StrategyCapabilities / StrategyDefinition 是基础能力与内部加载结果；SDK 不导入 Engine。
- Engine 的 `EngineStrategy` / `EngineContext` 是内部模拟契约，不作为公开 SDK 继承来源。
  Strategy runtime 负责桥接；Engine 不加载用户源码或选择语言。Python SDK 的实现归
  `apps/api/src/strategy/sdk/python.py`，协议执行归 `apps/api/src/strategy/sandbox/python/strategy_runner.py`，sandboxd 的通用 runner 只启动/分派。
- Strategy 宿主生命周期统一由 `sandbox/strategy-sandbox.ts` 的 StrategySandbox 持有；业务 Bridge.create
  内部选择语言、准备启动配置并创建 Transport。沙箱源码加载与协议归 `strategy-runner.ts` / `strategy_runner.py`，基础能力适配、缓存与
  宿主访问归 `strategy-adapter.ts` / `strategy_adapter.py`；作者 SDK 接收基础能力，不反向导入 runtime。
- 沙箱镜像以仓库根目录为构建上下文，`.dockerignore` 只允许显式 Python 输入。Strategy Python 源码
  同时影响 API 与 sandboxd；变更这些路径时保持部署清单和计划测试同步。
- TS/Python 账户命令均逐条提交并等待宿主确认；StrategyBridge 的 executeCommand 统一校验与执行。
  TS 通过受限同步宿主调用，Python 使用阻塞 command request/response，命令错误在作者调用处抛出。
  ready 必须声明 command_mode=synchronous，done 仅表示回调完成，不携带命令批次；API 与 Python 镜像须配套更新。
  账户快照与撮合时序保持；确认不等于成交，后续错误不自动回滚已接受的命令。
- 本次整理不表示 TS / Python 功能完全对等；保持各自公开命名和既有产品准入。

## Factor SDK Contract 工作流

- Factor TS 的公开签名与双语说明归 `packages/shared/src/sdk/factor/reference.ts`；Monaco 使用其声明渲染器，
  同目录 `contract.ts` 由 `setup:sandbox` 生成，SDK 实现与 runtime 元数据直接消费该类型，禁止另写一份前端签名。
- Factor Python 的公开类型和字段以 `packages/shared/src/sdk/factor/python.ts` 为唯一真相源；Prisma 的 Factor
  存储列只负责语言、运行时和代码血缘，禁止反向推导 Python SDK。
- 修改 Factor Python 公开字段、上下文方法、输入枚举或构造参数后，运行 `pnpm setup:sandbox` 生成
  `apps/sandboxd/python/jixie_factor_sdk.pyi`，再运行 `pnpm setup:sandbox --check`、`pnpm typecheck` 和相关运行时/
  Pyright 测试。根级 `build` / `typecheck` 已把生成物一致性作为门禁。
- Monaco/Pyright 直接复用同一 Contract 渲染的 stub，不另维护前端 Python schema；TypeScript Factor 的 ambient
  类型继续独立兼容，不能用旧 TS 字段名污染 Python 的 snake_case 契约。
- TS/Python 作者接口实现归 `apps/api/src/factor/sdk`；Python 源码加载、协议和返回值校验归
  `factor/sandbox/python/factor_runner.py`。SDK 不反向依赖 runtime；sandboxd 只分派并打包业务模块，Python 源码同时影响 API/sandboxd。
- Factor 宿主生命周期统一由 `sandbox/factor-sandbox.ts` 的 FactorSandbox 持有；共享 `factor-bridge.ts` 的
  Bridge.create 内部选择语言、准备启动配置并创建 Transport，同时负责协议、字段映射及结果检查，`metadata.ts` 保留各语言校验。
  TS 外围通信归 `entry.ts`，源码加载、会话状态及回调归 `factor-runner.ts` 的 FactorRunner；与 Strategy 使用相同
  文件职责和类型后缀；Python 同样使用 FactorRunner，run_factor 只启动并接入 handler，外围读帧循环归
  sandboxd 通用入口。Factor 种类仍关联不同输入与 metadata，不统一作者计算语义。
- 三业务 Adapter 统一实现 infra/sandbox 的 SdkAdapter 接口／Protocol，以 bind(input) 返回能力绑定；
  Runner 在 session 内持有 Adapter，绑定对象保留本次快照／索引。账户原始操作的命令编码归 Adapter，SDK 只转发。
  公共接口不管理 close/abort，不导入业务；SDK 不导入此 sandbox 接口，Python 公共 Protocol 显式打包并同时影响 API/sandboxd。
- 三业务 Capabilities 由 SDK 声明，Adapter 由 runtime 实现；TS/Python 按相同角色命名，不以是否通信
  决定是否需要适配。详见 docs/design/sdk-capability-adapters.md，旧聊天图表退役规则见 docs/design/legacy-chat-chart-retirement.md。
- TS runtime 打包 `sdk/typescript.ts`（生产使用编译后的 `.js`）并注入 isolate；工厂与 `history/value/lag`
  只在 SDK 实现，不在 runtime 另写字符串副本。FactorAdapter 将预备数据、索引、声明字段绑定为
  SDK 自有 Capabilities；SDK Context 保留公开方法与校验，不持有传输 DTO 或导入 runtime。

- Factor、Strategy、Research 宿主 Sandbox 的 static start 统一按创建实例 → 等待基类 initialize → 返回排列。
  Sandbox 通过子类 createBridge 调用对应业务 Bridge.create，并统一调用 bridge.initialize 管理启动状态与失败/取消清理；
  语言选择、源码准备、Transport 获取和构造均在业务 Bridge.create 内完成；Sandbox 不导入语言实现或选择语言。
  Factor/Strategy 的 createPython/createTypeScript 为 Bridge 私有静态方法，编译/bundle 仍复用技术辅助，旧 prepare 文件和 Preparation 配方类型移除。
  成功握手后发布只读 metadata，未 ready 不可执行；成功实例关闭后 metadata 仍可读取。
  SandboxTransport 统一约束 send/readValidated、close/abort/isClosed；不再另建 SandboxResource。
  Sandbox 只持有 Bridge，Bridge 独占 Transport；Sandbox 决定业务关闭时机并调用 Bridge，具体 Transport 实现底层回收。
  Bridge.create 返回前构造失败由其内部回收 Transport；返回后包括晚到 Bridge 均由 Sandbox 清理。
- 三业务宿主 Bridge 分别位于 strategy/sandbox/strategy-bridge.ts、factor/sandbox/factor-bridge.ts、
  research/sandbox/research-bridge.ts，构造函数接收传输、配置和稳定宿主能力；
  initialize 负责握手并返回 metadata，execute 负责业务协议，Research 另有 analyze/reset。
  会话协议状态归 Bridge 实例，单次执行日志归局部变量；业务状态和取消监听归 Sandbox。
  三类统一继承 infra/sandbox/sandbox-bridge-base.ts 的 SandboxBridgeBase，基类持有 Transport，
  提供 close/abort/isClosed 并以 protected exchange 复用消息循环；帧/Transport 契约归 transport.ts。
  并发保护按 Transport 跨 Bridge 生效并覆盖终止帧业务处理，无状态映射和服务分派保留具名函数。
  公共方法由 infra/sandbox/sandbox-bridge.ts 的 SandboxBridge 约束：initialize({ signal? })
  返回 metadata，execute 接收本业务单次操作的输入和选项，同时约束 close/abort/isClosed。
  SandboxBridgeBase 实现公共接口并声明抽象 initialize/execute；业务子类绑定类型并实现协议方法，
  不重复 implements，也不为 Factor/Strategy 保留纯泛型绑定的 BridgeContract 别名。
  Sandbox 字段依赖公共 SandboxBridge；Research 的 analyze/reset 归扩展契约，类显式 implements，
  ResearchSandbox 通过扩展接口使用这两个方法，不要求其他业务实现。
- 沙盒单次调用的宿主契约按业务动作命名：FactorComputeInput（横截面与资产输入仍按 Kind 关联）、
  StrategyDecisionInput（当前 EngineContext）、ResearchCellRunInput / ResearchCellRunOptions /
  ResearchCellRunResult（一次 Cell 调用）。协议 schema 对应使用 Compute / Decision / CellRun。
  Sandbox 表达会话生命周期，StrategySimulationInput 表达完整模拟配置；ResearchExecution
  继续表示持久化研究运行记录，不与一次 Cell 的沙盒返回值混用。

- 目录按业务能力组织：公共运行设施归 infra/sandbox，三业务用户代码会话归各自 sandbox，
  StrategySimulation 与 FactorHost 归 strategy/simulation；Factor 评估计算与共享 Worker 归
  factor/analysis，观察数据、横截面取数/序列及数据契约归 factor/observations。
  observations 不依赖 analysis；Research outputs 的产物与内容比较不依赖 sandbox
  帧或会话。两条方向约束由后端边界检查覆盖，SDK 也不得导入 sandbox 或旧 runtime 实现。

## Research Python Runtime Contract 工作流

- `packages/shared/src/research-python-runtime.ts` 是 `research-py-v1` 可用 Python 版本、第三方包、导入名和 Agent
  使用政策的唯一事实源。不得只在 Dockerfile、开发机或 Agent prompt 中单独增删包。
- 修改运行时包或版本后运行 `pnpm setup:sandbox`，提交生成的
  `apps/sandboxd/python/requirements-research-runtime.txt`，再运行 `pnpm setup:sandbox --check`、`pnpm typecheck`
  和相关 runtime / Agent / Pyright 测试。
- 本地首次运行或 Contract 变化后执行 `pnpm setup:sandbox`。`pnpm dev` 会在启动 Web、API 和 sandboxd
  前校验 CPython 3.13 及所有固定包的精确版本；校验失败不得静默退化到系统 Python。
- API、sandboxd 及 Python 检查器测试入口同样校验项目 Python 环境；默认路径从仓库位置解析，显式
  `JIXIE_PYTHON_EXECUTABLE` 覆盖也必须匹配 CPython 3.13 与固定依赖。环境异常明确报错并提示
  `pnpm setup:sandbox`，不回退到系统 Python，也不在测试入口自动安装。
- Agent 生成 Python 前必须查询 `searchResearchCatalog("runtime.python")`。prompt、Catalog、提案导入白名单、
  Docker requirements 和本地运行时必须复用同一 Contract；清单外能力应明确报缺口，不得猜测安装状态或手写替代。

## 目录约定(对齐 fangtu)

- **文件命名按局部职责**：目录表达业务归属，文件表达局部职责，导出的函数、类型和对象保留完整业务语义。业务 Job 生命周期统一为 `job-lifecycle.ts`，输入为 `job-payload.ts`；单一任务能力的 Worker 文件组使用 `worker.ts`、`worker.boot.mjs`、`worker-protocol.ts`。保留能区分同目录职责的限定词（如 `basic-sync.ts` / `daily-sync.ts`、`reference-worker.ts`），不为文件名全局唯一重复完整业务路径，也不为缩短名称去掉有效语义。不同业务无需具有相同目录结构；前端组件及 store 遵循前端命名约定。

- **API 核心类文件与完整类名对应**：以一个主要类为中心的实现文件使用完整类名，TypeScript 使用 kebab-case，Python 使用 snake_case，例如 StrategyBridge → `strategy-bridge.ts`、StrategyRunner → `strategy_runner.py`、SdkAdapter → `sdk_adapter.py`；同名测试同步使用该前缀。这个规则优先于上一条的目录去重习惯，允许业务前缀重复。围绕主要类的输入类型、工厂和私有辅助类保留在同一文件，不为命名机械拆分。`errors.ts`、SDK 聚合入口、`contract.ts`、`protocol.ts`、Capabilities 与同主题函数集合仍按模块职责命名；Worker 文件组与 Job 生命周期继续遵循上条专项约定。完整映射和验证记录见 `docs/design/execution-naming-and-ownership.md`。

- Factor、Strategy、Research、Market 四个核心业务模块按业务能力分目录；根级保留 `README.md` 和统一的业务 `errors.ts`；仅有后端专属校验组合或内部入参时保留 `schema.ts`。本业务 Agent 启动与上下文放在 `agent/`，Job 定义与提交、查询放在所属业务目录，测试跟随实现。纯来源类型、快照与哈希不依赖任务执行模块；Factor 分别归 `sources/snapshot.ts` 和 `sources/fingerprint.ts`。不要求四个模块具备相同目录，不将此布局套用到 Agent、Engine、Auth 或 Maintenance。

- **执行职责按业务组织**：无状态业务编排优先使用具名函数，不为单一 `run` 方法创建 Runner 类，不强制各模块采用同一目录或签名。Worker 负责输入/消息/进程收尾，语言 runtime 负责代码加载与执行，不规划报告、扫描或文档运行。类用于确实持有资源或可变状态的 runtime、会话池和进程执行器；共享模拟/计算放在明确的业务能力目录，避免混入语言 runtime。具体调整见 `docs/design/execution-naming-and-ownership.md`。

- **业务计算入口按动作命名**：因子评估使用 `factor/analysis/evaluate.ts`，回测和扫描结果计算分别使用 `strategy/backtests/compute.ts`、`strategy/scans/compute.ts`；允许取数、沙盒装配和结果后处理。Worker 调用不决定入口叫 `run`，Job 生命周期仍归 `job-lifecycle.ts`。Agent 完整后台对话流程、Research 的 `run-cell.ts` / `run-document.ts` 等具名运行入口、CLI、工具及对象的 `run()` 保留各自语义；已有 `runBacktest` 等明确业务对象的函数名保留。

- 测试按职责归属：模块测试与源码同目录，不要求存在同名源码文件；API 包级配置及跨模块应用契约测试放在 `apps/api/tests`。具有明确模块归属的 integration 测试仍留在模块内，不按文件后缀统一搬迁。`tests` 仅供测试使用，生产代码不能导入；该目录仍纳入 TypeScript 与后端边界检查。

- 业务模块的多组 HTTP 路由统一放在 `routes/`，由 `routes/index.ts` 组合并具名导出，外部调用方显式导入该入口（如 `#strategy/routes/index.js`），不保留根级转发文件。实现按职责命名为 `definition.ts`、`agent.ts`、`backtest.ts` 等，不重复 `-routes` 后缀。只有一组路由的模块可以直接在根级 `routes.ts` 实现。五个核心业务模块的整体接口测试放在 `routes/index.integration.test.ts`（Market 使用 `index.test.ts`），专属路由测试与实现同放 `routes/`；其他模块沿用其现有测试布局。子路由直接导入子实现，避免反向导入 `index.ts` 形成循环。模块路由出口允许显式具名 re-export，不建立应用级总 barrel。业务错误统一定义在模块根级 `errors.ts`，由 `infra/http/errors.ts` 在 `server.ts` 的 `onError` 统一映射，子路由不另设错误映射；公共 HTTP 请求 schema 与类型位于 `packages/shared/src/api/<业务>.ts`，路由直接导入；后端专属校验组合留在模块根级 `schema.ts`。鉴权、维护门禁等中间件从模块 `middleware.ts` 单独具名导出，不经路由入口转导出；`infra/http` 保留跨业务 HTTP 辅助。路由对象统一使用「业务/职责名 + `Route`」具名导出（如 `authRoute`、`strategyBacktestRoute`），调用方直接使用同名导入，不导出通用 `routes` 再用 `as` 命名。路由只负责请求/响应，资源归属、状态与事务由业务入口负责。

- `apps/api/src/auth` — 登录与会话业务；根级 `routes.ts` 负责登录 HTTP，`cookies.ts` 负责 Cookie，`middleware.ts` 负责鉴权中间件与 Hono 用户上下文；`session.ts` 保留会话业务。
- `apps/api/src/infra` — 数据库、HTTP 辅助、LLM 与邮件传输；`math` 为共用数值计算，`date.ts` 为日期辅助，`i18n` 保留纯翻译。
- `apps/api/src/infra/sandbox` — 公共 Python 通信、TS isolate 与沙盒日志；业务协议归 Strategy/Factor/Research 各自的 runtime，公共运行设施不导入业务模块。
- `apps/api/src/jobs` — 通用任务存储、日志、事件调度和 Worker 回收；register.ts 显式注册四类 JobLifecycle 对象；JobService 统一存储、执行、终态事务与恢复。onExecute 在事务外计算，onSuccess/onFailure/onInterrupted 在终态事务中更新业务，onCommitted 在提交后执行。bootstrap 等待恢复后启动单消费调度器；buildApp 只构建 HTTP。报告运行状态来自 Job，无 Job 历史终态回读 legacy 字段；ResearchExecution 保留领域结果状态。
- `apps/api/src/research` — 文档/Cell 编辑归 documents，依赖与失效归 dependencies，文档运行/控制归 document-runs，共用 Python 会话归 sandbox，嵌入式分析的可编辑草稿/最近运行归 embedded，图片产物归 outputs，Agent 修改/审阅/尝试归 proposals；研究数据归 datasets，语义检索归 catalog，Python 作者 API 归 sdk/python，宿主校验/分派归 sandbox/host，语言服务归 language，空白文档初始内容归 documents。`routes/index.ts` 直接组合并导出 `researchRoute`，挂载到 `/api/app/research`；文档/Cell、执行控制、私有图片、提案、Agent、数据查询、Python 语言服务分别由 `routes/document.ts`、`routes/execution.ts`、`routes/artifacts.ts`、`routes/proposal.ts`、`routes/agent.ts`、`routes/data.ts`、`routes/language.ts` 适配请求，`agent/turn.ts` 编排 Research 对话启动；入口与调用链见 `src/research/README.md`。
- `apps/api/src/factor` — 定义与草稿归 definitions，观察数据与截止日归 observations，正式评估/报告 归 evaluations，共享评估计算及 Worker 归 analysis，来源解析/快照/指纹归 sources，Factor Job 归属查询归 jobs，发布/归档归 publication，作者 SDK 实现归 sdk，语言适配归 sandbox；`routes/index.ts` 直接组合并导出 `factorRoute`，统一挂载到 `/api/app/factors`；定义、Agent、分析分别由 `routes/definition.ts`、`routes/agent.ts`、`routes/analysis.ts` 适配请求；报告位于 `/analysis-reports`，普通分析任务使用 `/analysis-jobs`，`evaluations/job-lifecycle.ts` 导出生命周期对象，在 jobs/register 注册为 `factor-analysis`，旧 kind 的一次性生产转换已完成，旧库恢复见 `docs/backend-runtime-entries.md`，bootstrap 不再重复转换。入口与调用链见 `src/factor/README.md`。
- `apps/api/src/strategy` — 定义/命名/配置归 definitions，回测提交、报告、语言编排及 Worker 归 backtests，参数扫描及线程内串行模拟归 scans，策略因子对象、准备与引用归 factors，策略 SDK 辅助实现归 sdk，TS/Python 适配归 sandbox，报告风险分析与模型就绪要求归 risk。`routes/index.ts` 直接组合并导出 `strategyRoute`，统一挂载到 `/api/app/strategies`；`routes/agent.ts` 处理 Agent，`routes/definition.ts` 处理列表、创建、删除，`routes/backtest.ts` / `routes/scan.ts` 分别处理提交、报告与任务查询；自动命名仅保留内部能力；`backtests/job-lifecycle.ts`、`scans/job-lifecycle.ts` 保留具名任务入口；调用链见 `src/strategy/README.md`。
- `apps/api/src/agent` — core 负责统一模型/工具循环，profiles 选择业务能力；turns 负责后台执行、事件、轨迹和持久化状态，conversations 负责对话关联/历史/实体镜像及消息校验，tools 保留证券检索、数据覆盖、股票池和研究工具，不提供任意 SQL。Strategy Agent 负责依据 SDK 和上下文生成代码及必要校验，回测由用户在工作台显式发起；Research 探索后由用户手动在对应工作台建立草稿，不提供后台回测工具。routes/index.ts 组合 routes/turn.ts，适配 `/api/app/agent` HTTP/SSE；消息归 conversations，执行详情/订阅/取消归 turns；旧图表重查接口已移除。入口和消息顺序见 `src/agent/README.md`。
- `apps/api/src/backtesting` — 根级 BacktestingEngine/OrderBook/BacktestingContext 分别持有运行、订单与当日上下文，CashPortfolio/FuturesPortfolio 负责账户；data 为必填 DataPort/EngineData，factors 的 FactorEvaluator 为引擎内因子求值；adapters 为宿主 Prisma，TS/Python FactorHost 归 strategy/simulation，testing 为共用 fixture。因子源码只在各自沙箱执行，Engine 经独立 FactorExecutionPort 使用计算结果。模拟核心不导入宿主适配器；TS/Python 策略经共享 bridge 使用宿主 Engine，TS bundle 只包含 SDK 与沙箱适配。见 `src/backtesting/README.md`。
- `apps/api/src/market` — stocks/etfs/indices/futures 按数据领域聚合同步与读取，ETF 基础质量归 etfs；calendar 负责同步/读取及上海 16:00 的 SSE 日期规则，cross-market 负责基准同步/换算与美债/外汇联合获取，queries 保留跨资产统一序列；state 保留风险驱动基础质量与商品发布状态读取，valuation 保留估值计算/读取。fundamentals/rates/macro/commodity 承接财报、利率、宏观和商品，rates 提供逐期限利率可得日期。providers/tushare 是数据通道，registry 是纯静态清单，instruments 负责证券身份及历史代码合并。routes/index.ts 直接组合 routes/instrument.ts、routes/valuation.ts，适配 `/api/app/market` 的 instruments、index-valuations 和 indices 序列。入口见 `src/market/README.md`。Market 不反向导入 Strategy、Research、Agent 或 Maintenance。
- `apps/api/src/maintenance` — 统一 `data sync` 目标、持久分区计划、有限预算、恢复和短发布编排；来源身份、映射与原始质量归 Market，各消费者判断自己的正式输入资格。`sync.ts` 组合 Market 分区准备和事务接纳；`calculations.ts` 处理有界失效与派生输出 CAS；`status.ts` 展示覆盖与真实发布锁，`routes.ts` 保留既有状态接口。旧 daily/weekly/repair/import、整轮候选及财报候选子进程协议已退役，历史控制表只保留历史与部署用途。流程见 `apps/api/src/maintenance/README.md`。
- `apps/api` — Hono 后端 + `prisma/schema.prisma` + 领域逻辑(`src/research`、`src/factor`、`src/strategy` 等)+ 模块内应用命令(`src/*/cli/`)及审计/探针/研究脚本(`scripts/`)
- `apps/web` — 登录与工作台前端
- `apps/docs` — 独立公开文档前端，挂载 `/docs/help/*` 与 `/docs/sdk`
- `packages/shared` — 共享类型、公开 SDK Contract 和 HTTP 请求契约；依赖方向 `apps/* → packages/*`，反向禁止。HTTP schema 通过 `@jixie/shared/api/<业务>` 子路径导入，不进入根级运行时 barrel；前端只使用 `import type` 引用请求类型。
- `packages/shared` 编译到 `dist`，实际运行／构建前需 `pnpm --filter @jixie/shared build`（install 时 `prepare` 也会自动构建）。根级 `pnpm typecheck` 在内存中生成最新 shared 声明再检查各应用，不运行构建、不写文件、不依赖旧 dist；各应用保持自己的 TypeScript 配置。

应用 CLI 放在所属模块的 `cli/`，负责参数、配置、调用、输出、退出与进程资源收尾，允许简单同步组合和只为输出服务的查询；可复用业务不导入 CLI，不为每个命令新增转发 service。Market / Maintenance / Auth 的入口统一登记在 `apps/api/scripts/README.md`。独立备份工具 `apps/api/scripts/backup-db.mjs` 保留 Node 内置模块 + sqlite3 CLI 的零 npm 依赖契约，不要求应用构建。

## 架构阅读与边界门禁

当前后端地图见 `docs/backend-architecture.md`，模块依赖规则见 `docs/backend-boundaries.md`。`pnpm check:backend-boundaries` 使用 TypeScript AST 与 API tsconfig 解析 import/re-export/字面量动态 import，区分类型边和运行时边；根级 typecheck/build 已包含此静态门禁。具体纯依赖例外在 `scripts/checks/backend-boundaries.json`，不按目录整体放行。

`pnpm check:backend-boundaries` 先运行检查器自测，通过后扫描项目，放在人工 review 通过的行为验证阶段执行。根级 build/typecheck 直接调用底层静态扫描，不运行自测。静态扫描不执行应用模块；Worker、Python、Prisma 和 Pyright 资源路径须按 `docs/backend-runtime-entries.md` 做实际验证。

## 代码约定

- **ESM 相对导入必须带 `.js` 后缀**(即使源是 `.ts`)
- **API 跨顶层模块导入使用原生包内别名**：例如 `#jobs/job-service.js`、`#market/instruments/stock-identity.js`，根级日期辅助用 `#date`；模块内部保留相对路径，跨 workspace 继续使用包名。映射唯一来源为 `apps/api/package.json#imports`，新增可跨模块引用的顶层目录时同步补充。Worker/资源的 `new URL(..., import.meta.url)` 仍使用相对路径，不当作模块导入替换。
- API 源码执行使用 `--conditions=development`（已有 pnpm API 脚本已配置）；手动执行示例：`node --conditions=development --import tsx scripts/probes/smoke.ts`。生产不传此条件，原生 Node 从 `dist/src` 加载，部署必须保留 API `package.json`。`NODE_ENV=development` 本身不会启用模块解析条件。
- 跨包用包名 `@jixie/shared`;`@prisma/client` 是 CJS,用 `import pkg from '@prisma/client'; const { PrismaClient } = pkg;`(见 `src/infra/database/prisma.ts`)
- ID 用 ULID,应用层生成;zod 做入参校验
- **业务入口使用具名输入类型**：已有业务 schema 对应的对象参数，在 schema 所属文件中导出派生类型（公共 HTTP 契约在 shared/api，后端专属组合在业务 `schema.ts`），业务文件使用 `import type` 引用，不在导出的业务函数签名中内联 `z.input`、`z.output` 或 `z.infer` 推导表达式。HTTP、Agent 工具、SDK 适配等入口解析外部参数，业务操作接收 `z.output`，保留权限、状态和业务规则检查；持久化 JSON、Job/Worker 消息、LLM 输出仍须在各自读取边界校验。前端请求 `*Request` / `*RequestQuery` / `*RequestParams` 使用 `z.input`，与后端业务 `z.output` 区分；查询字符串在序列化处接受共享类型检查，coerce 必须显式声明字符串输入类型。未知数据解码器可接收 `unknown`；类型名的 `Input` 表示业务入参，不决定选哪一种。保持现有共享契约与独立业务类型；局部推导、协议/Job/工具类型按实际归属保留，不为没有类型消费者的 schema 批量添加别名，不新增集中式 `types.ts`。详见 `docs/design/api-input-types.md` 与 `docs/design/api-request-contracts.md`。
- **业务错误统一约定**：Strategy、Factor、Research、Market、Agent、Auth、Maintenance 的业务错误在各自根级 `errors.ts` 定义，继承 `infra/errors.ts` 的 `BusinessError`；调用点直接 `throw new XxxError(reason, options)`，不增加只负责抛出的 `failXxx` 函数。成功返回数据，预期拒绝抛异常；合法的空查询和运行状态仍是数据。错误定义只含稳定 reason、分类、i18n key/参数、可公开 details 与内部 cause，不依赖 HTTP、数据库或业务执行。自定义技术异常也放所属模块根级 `errors.ts`，保留取消、重试和诊断语义，不冒充业务拒绝。HTTP 统一映射：输入 400、缺失 404、状态冲突 409、认证 401、权限 403、暂不可用/维护 503；未知异常记录原始错误并返回安全双语 500。不得按文案识别错误或 catch 所有异常后转 400。非 HTTP 输出在消费边界用 `errorMessage(error, locale)` 翻译。详见 `docs/design/api-errors.md`。
- **代码注释使用中英文双语**(inline `//`、块注释、JSDoc、Prisma `///`、CSS `/* */`)——用途、复杂流程、计算口径与关键约束均提供语义一致的中文和英文说明；优先在声明上使用双语 JSDoc，中文说明不加语言前缀，JSDoc 的中英文说明之间保留一个空段，供 Markdown hover 分段；Python 使用相邻双语注释，避免仅为补注释改变运行时 docstring。保留标准英文财经术语，不机械解释显而易见的代码。**LLM prompt / 工具 description / few-shot 仍一律英文**(见下「多语言」条)。**面向用户的 UI/报错文案走 i18n**(英文 key,zh+en 值),不再硬编码——详见 `docs/design/i18n.md` 与下「多语言」条
- 格式化:prettier(`semi`、`singleQuote`、`printWidth 100`、`trailingComma all`)+ eslint `curly: all`(控制语句强制大括号,`if (x) return;` 会被拆成带 `{}` 的多行)。**pre-commit hook**(simple-git-hooks + lint-staged)提交时自动对暂存文件跑 `eslint --fix` + `prettier --write`,机械格式无需手动维护;`.prettierignore` 里 `*.md` 等文档不受 prettier 摆布
- **空行分段(工具做不到,唯一靠人/agent 的格式)**:函数体内按逻辑段落用**单空行**分组 —— 入参校验 → 数据准备 → 主循环 → 收尾/return;注释引导的新段落,注释前空一行。函数首行前 / 末行后不空;紧密相关的连续单行不硬插;不留连续空行(prettier 会压成一行)。写的时候主动分段,别挤成一坨
- **对同一值的等值分支 ≥3 用 `switch`,不写 `if/else` 链**:TS 对可辨识联合(discriminated union)的 switch 能做穷尽检查,加新分支漏处理编译器会抓;纯「值→值」映射优先查表对象(`Record`),连 switch 都不用。条件异构(区间判断、复合谓词、不同变量)的 if/else 链不硬套 switch
- **命名一律语义全称**(代码是给人看的,没必要省):变量/参数、回调 / reduce / map-item / 临时变量都要有语义(`(sum, close)` 不是 `(a, b)`、`.map((code) => …)` 不是 `(c)`);金融/领域术语在定义处加简短中英文双语注释,保留标准英文财经术语(`ATR`/`EMA`/Donchian channel / after-adjustment price)。领域惯例短名优先展开成全称(`predicate`/`fraction`/`direction`);纯数组下标 `for (let i …)` 可留
- 不为「未来可能复用」提前抽象:三处相似 < 一处错误抽象

## 多语言(i18n,中英双语)

产品支持中文 / 英文,**详设与执行计划见 `docs/design/i18n.md`**。几条不能违背的红线:

- **面向用户的字符串走 i18n,不硬编码**:前端过 react-i18next(`apps/web/src/i18n`,一页一命名空间,zh 是形状真相源、en 用 `typeof` 约束);后端过消息目录(`apps/api/src/i18n` 的 `t`；`localeFromRequest` / `m` 从 `apps/api/src/infra/http/locale.ts` 导入)。
- **LLM prompt / 工具 description / few-shot 示例一律英文,绝不抽成 i18n key**(代码标识符保持英文，代码用途注释使用中英文双语；A 股专有名词用标准英文财经术语)。这是需求 1(UI i18n,值可切换)与需求 2(prompt 是静态英文串)的边界,别搞混。
- **LLM 回复跟随用户提问语言**(英文提问→英文回答),靠 prompt 里一句英文指令 `REPLY_LANGUAGE` 实现,不给模型传 locale;唯一按 locale 变的是命名助手生成的名称语言。
- `Locale = 'zh' | 'en'` 在 `@jixie/shared`;前端 `localeStore` 单例是唯一切换入口,api client 每请求带 `Accept-Language`。
- 切表/加因子时,面向用户的中文 label 用 i18n 显示层映射;**DB 存的规范名保持中文不迁移**(它也是 LLM 上下文)。

## Prisma 已知坑

- `DATABASE_URL` 里的相对路径是相对 `schema.prisma` 解析(不是 cwd):`file:./dev.db` 实际生成在 `apps/api/prisma/dev.db`
- Prisma 7 破坏性变更(移除 `datasource.url`),留在 6.x
- **Migration SQL 必须由 Prisma 生成,禁止手工修改已生成的 migration 文件**。修改 schema 后使用 `prisma migrate dev` 生成新的 migration;如果发现历史 migration checksum 漂移,先备份并审计数据库状态,通过修复迁移元数据解决,不要改写历史 SQL。

## 市场规则与 A 股回测基线

跨市场研究不得默认复用 A 股规则。香港、美国、债券、商品和不同基金品种必须分别确认结算、交易单位、
涨跌幅、卖空、税费、交易时段、公司行动、期货换月和币种口径；尚未建模的规则必须显式限制研究范围，
不能静默按 A 股处理。

A 股回测必须内置以下规则(写回测时别漏):

- 复权:回测价格用 `close × adj_factor`(后复权),消除除权除息假跳空
- T+1:当日买入,次日才能卖
- 涨跌停:涨停不可买、跌停不可卖
- 停牌 / ST:停牌日不可成交;ST 按策略决定是否剔除
- 成本:佣金(双边约万 2.5,最低 5 元)+ 印花税(**仅卖出**千 0.5)+ 过户费

## 回测与后台计算

回测已由 `strategy/backtests/job-lifecycle.ts` 派发到 `strategy/backtests/worker`，参数扫描位于 `strategy/scans`，Factor 也有自己的线程/子进程入口。HTTP 主线程负责提交与结果事务，Engine 负责模拟；长任务沿用「同步写库 → 返 jobId → 后台计算 → 查询/订阅进度」。具体入口和资源收尾见 `docs/backend-runtime-entries.md`。

## Commit message policy

- All commit subjects and bodies must be written in English using `type(scope): description`.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for allowed types, scope conventions, imperative subjects,
  body structure, breaking changes, and attribution. Contributor names and attribution trailers retain
  their original spelling. This policy supersedes the former allowance for Chinese commit messages.
- The `commit-msg` hook runs `scripts/checks/check-commit-message.mjs`; reviewers also verify meaning and English wording.
- Agree on the exact compliant message before implementation when using review-gated development.

## 协作风格

- **本项目授权自动执行**:pnpm、Prisma(migrate dev / generate / db push / studio)、typecheck / 测试 / 构建 / 跑脚本 —— 判断安全的直接执行并汇报
- **Git**:`git commit` 准备好(含 message)后**先确认,用户点头才执行**;`git push` **一律用户手动,我不代跑**
- 仍先确认:`rm -rf`、force push、`git reset --hard`、删库 / `prisma migrate reset`、对外发送
- **测试服务清理**:agent 为测试临时启动的 API / Web / dev server,验证结束后必须主动关闭,并确认监听端口和数据库连接已释放;不得把测试进程遗留给用户
- **E2E 截图交付**:完成涉及 E2E 的任务后,不仅要运行并检查验收截图,还必须在最终回复中直接展示本次 E2E 截图,不能只给文件路径或口头说明
- 先理解再动手:选型 / 加依赖 / 改架构先讲清 trade-off;不熟的概念讲 why,不只讲 what
