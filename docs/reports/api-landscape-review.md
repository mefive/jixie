# API 全景与人工审阅表（2026-10-19 历史快照）

> 归档说明（2026-11-13）：本文保留 2026-10-19 的接口盘点与待审事项，不是当前 API 契约。下文的接口数量、路径、代码位置和行为说明均属于当时快照；未填写的审阅结论仍不表示通过。
>
> 当前实现请从 [后端架构](../backend-architecture.md)、[API 挂载入口](../../apps/api/src/server.ts)及各业务模块 README 查阅。采集与副本发布见 [Ingestion 说明](../../apps/api/src/ingestion/README.md)。旧 Maintenance、Signals、Library，以及气象、holdout、研究固化／交接等条目不能作为当前可调用接口。

基准日期：2026-10-19。范围为当时工作区 `apps/api/src/server.ts` 实际挂载的应用 HTTP API，每个“方法＋路径”单独列项。共 **140 条显式路由声明：138 个生产接口、1 个非生产登录接口、1 个非 GET SSE 拒绝入口**。`/` 也作为探针纳入；中间件、框架隐式 HEAD/404、前端页面、内部 TS/Python SDK、Agent 工具、Tushare 上游接口和 sandboxd TCP 协议不混入 HTTP 数量。

本表用于逐项确认用途、业务归属、调用方式及副作用。ID 可用于记录审阅意见；快照中均为待人工审阅。代码定位记录当时的路由声明位置，采用仓库相对路径与历史行号，不保证在当前版本中仍存在，业务规则仍由对应业务函数实施。路径按挂载前缀拼接，模块根路径去除结尾 `/`；参数保留 `:参数名`。

## 业务全景

探索主线是 Market 数据 → Research 文档与证据 → Factor／Strategy 草稿与验证 → Signals 冻结部署与账户记账。Agent 横向提供对话与代码辅助，Library 供已登录用户发现、复制公开资源；Auth 管会话，Maintenance 管可用性及版本。

| 业务模块 | HTTP 前缀 | 声明数 | 主要用途 |
| --- | --- | ---: | --- |
| 系统探针 | `/、/api/health` | 2 | 存活及健康探针 |
| 认证与会话 | `/api/auth` | 5 | 邮箱登录、当前用户、退出和非生产登录 |
| 维护与版本 | `/api/maintenance` | 2 | 维护状态与部署版本 |
| 市场数据 | `/api/app/market` | 6 | 证券名称、行情、指数估值及市场气象 |
| 研究工作台 | `/api/app/research` | 47 | 文档、执行、证据、提案、嵌入分析、整理与语言服务 |
| 因子研究 | `/api/app/factors` | 38 | 因子／组合生命周期、分析、holdout、相关性和气象 |
| 策略研究 | `/api/app/strategies` | 17 | 策略定义、Agent、回测及参数扫描 |
| 信号与账户 | `/api/app/signals` | 16 | 冻结部署、每日运行、人工成交与账户重放 |
| 通用 Agent 执行 | `/api/app/agent` | 5 | 活动轮次、详情、SSE 和取消；含一条拒绝入口 |
| 公开资源库 | `/api/app/library` | 2 | 公开资源发现与策略复制 |

## 共同契约与审阅口径

| 项目 | 快照时实现 |
| --- | --- |
| 认证 | `/api/app/*` 统一使用 Cookie 会话鉴权。认证、维护和探针路由不经过该鉴权中间件，认证路由自行处理会话。 |
| 维护门禁 | `/api/app/*` 先检查维护，再鉴权；维护期间返回 503 与 Retry-After，所以未登录请求也可能先看到维护状态。 |
| 资源授权 | 登录不代表可访问任意 ID；业务入口按 userId 检查归属或可见范围。语言服务使用 userId:documentId 隔离请求源码会话，不读取数据库文档。 |
| 入参 | 表中 Body/Query/Path 标出路由显式校验器，通常来自 shared/api 对应业务文件；“路径参数”不表示缺少业务授权，“无显式 schema”也不表示没有业务校验。 |
| 成功响应 | 通常 JSON、HTTP 200；嵌入派生版本为 201、提交运行为 202。根探针为文本，SSE 为事件流，研究产物按 MIME 返回二进制并支持 304。 |
| 错误 | 公共错误边界按输入 400、认证 401、权限 403、缺失 404、冲突 409、暂不可用／维护 503 映射；未知错误安全返回 500。 |
| 语言 | Accept-Language 选择中英文错误及显示信息。Agent 回复语言由用户提问决定。 |
| 任务 | 后台 Job 的提交响应不等于计算成功；后续读所属业务任务／运行详情。Agent 事件由通用 SSE 提供。没有统一公开 `/jobs` API。 |
| 普通研究执行 | 单 Cell、受影响分支、全文及提案尝试直接等待执行结果；不能统一按后台 jobId 模式理解。 |
| 其他后台刷新 | 因子气象采用独立刷新流程；其 GET 列表也可能触发刷新，不能把所有 GET 都视为无副作用。 |
| 账户边界 | Signals 人工成交是记账与核对，不向券商下单；旧版 PATCH execution 与新版 fills/revisions 两套契约并存。 |

## 系统探针

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-001 | GET `/` | 服务存活探针，返回文本 jixie api ok | 只读／文本 | 无显式 schema | `apps/api/src/server.ts:26` |
| API-002 | GET `/api/health` | HTTP 健康探针，返回 {ok:true}；不检测数据库或后台任务就绪 | 只读／JSON | 无显式 schema | `apps/api/src/server.ts:27` |

## 认证与会话

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-003 | GET `/api/auth/me` | 获取当前会话用户，未登录可返回空用户 | 会话查询 | 无显式 schema | `apps/api/src/auth/routes.ts:13` |
| API-004 | POST `/api/auth/logout` | 销毁当前会话并清除浏览器 Cookie | 写／退出 | 无显式 schema | `apps/api/src/auth/routes.ts:17` |
| API-005 | POST `/api/auth/email/request` | 申请邮箱登录凭据，结合邀请逻辑发送登录邮件 | 写／发送邮件 | Body: `emailLoginRequestSchema` | `apps/api/src/auth/routes.ts:26` |
| API-006 | POST `/api/auth/email/verify` | 校验邮箱登录凭据，建立会话并设置 Cookie | 写／登录 | Body: `emailLoginVerifySchema` | `apps/api/src/auth/routes.ts:31` |
| API-007 | POST `/api/auth/dev/login` | 按邮箱直接建立开发会话；仅 NODE_ENV 非 production 注册 | 写／仅非生产 | Body: `developmentLoginSchema` | `apps/api/src/auth/routes.ts:39` |

## 维护与版本

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-008 | GET `/api/maintenance/status` | 查询维护状态及重试提示，供登录页和维护遮罩使用 | 只读 | 无显式 schema | `apps/api/src/maintenance/routes.ts:7` |
| API-009 | GET `/api/maintenance/version` | 查询当前部署版本；响应禁止缓存 | 只读 | 无显式 schema | `apps/api/src/maintenance/routes.ts:9` |

## 市场数据

### 证券与行情

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-010 | GET `/api/app/market/instruments/names` | 按 codes 批量解析证券名称，最多处理 500 个非空代码 | 只读 | Query: `instrumentNamesQuerySchema` | `apps/api/src/market/routes/instrument.ts:16` |
| API-011 | GET `/api/app/market/instruments/:assetType/:instrumentId/series` | 读取股票、ETF 或期货行情序列；使用 assetType、instrumentId 及 start/end | 只读 | Query: `instrumentSeriesQuerySchema` | `apps/api/src/market/routes/instrument.ts:25` |
| API-012 | GET `/api/app/market/indices/:indexCode/series` | 读取指数收盘序列，用于基准比较；默认日期范围写在路由中 | 只读 | Query: `instrumentSeriesQuerySchema` | `apps/api/src/market/routes/instrument.ts:47` |

### 市场气象

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-013 | GET `/api/app/market/weather` | 按维度 dimension 与频率 frequency 读取市场气象序列 | 只读 | Query: `marketWeatherQuerySchema` | `apps/api/src/market/routes/state.ts:9` |

### 指数估值

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-014 | GET `/api/app/market/index-valuations` | 列出有估值覆盖的指数及日期范围 | 只读 | 无显式 schema | `apps/api/src/market/routes/valuation.ts:7` |
| API-015 | GET `/api/app/market/index-valuations/:indexCode` | 读取指定指数估值历史；代码转大写，无数据返回业务缺失错误 | 只读 | 路径参数 | `apps/api/src/market/routes/valuation.ts:11` |

## 研究工作台

### 文档与 Cell

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-016 | GET `/api/app/research/documents` | 按 active/archived 列出本人普通研究文档 | 只读 | Query: `documentListQuerySchema` | `apps/api/src/research/routes/document.ts:27` |
| API-017 | POST `/api/app/research/documents` | 新建空白／模板文档，或从回测报告建立研究文档 | 写／创建 | Body: `createDocumentSchema` | `apps/api/src/research/routes/document.ts:31` |
| API-018 | GET `/api/app/research/documents/:documentId` | 读取普通研究文档、Cell 与上下文；含历史会话补建兼容路径 | 读／可能补建 | 路径参数 | `apps/api/src/research/routes/document.ts:43` |
| API-019 | POST `/api/app/research/documents/:documentId/archive` | 归档空闲研究文档 | 写／归档 | 路径参数 | `apps/api/src/research/routes/document.ts:48` |
| API-020 | POST `/api/app/research/documents/:documentId/restore` | 恢复已归档研究文档 | 写／恢复 | 路径参数 | `apps/api/src/research/routes/document.ts:53` |
| API-021 | POST `/api/app/research/documents/:documentId/cells` | 新增 Markdown 或 Python Cell | 写／内容 | Body: `createCellSchema` | `apps/api/src/research/routes/document.ts:58` |
| API-022 | PATCH `/api/app/research/cells/:cellId` | 按 expectedRevision 更新 Cell 源码或配置并处理依赖失效 | 写／修订 | Body: `updateCellSchema` | `apps/api/src/research/routes/document.ts:68` |
| API-023 | DELETE `/api/app/research/cells/:cellId` | 删除 Cell，受依赖及运行状态约束 | 写／删除 | 路径参数 | `apps/api/src/research/routes/document.ts:77` |
| API-024 | PATCH `/api/app/research/documents/:documentId` | 修改文档标题；此入口不负责整篇内容替换 | 写／重命名 | Body: `renameDocumentSchema` | `apps/api/src/research/routes/document.ts:82` |
| API-025 | DELETE `/api/app/research/documents/:documentId` | 删除文档，受业务状态及归属约束 | 写／删除 | 路径参数 | `apps/api/src/research/routes/document.ts:95` |

### 运行控制与执行

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-026 | POST `/api/app/research/cells/:cellId/run` | 执行单个 Python Cell，等待结果并回写文档 | 同步执行＋写 | 路径参数 | `apps/api/src/research/routes/execution.ts:14` |
| API-027 | POST `/api/app/research/cells/:cellId/run-affected` | 执行指定 Cell 受影响的依赖分支，等待结果 | 同步执行＋写 | 路径参数 | `apps/api/src/research/routes/execution.ts:19` |
| API-028 | POST `/api/app/research/documents/:documentId/run` | 按 clean 参数执行整篇文档；干净全文运行形成冻结执行证据 | 同步执行＋写 | Body: `runDocumentSchema` | `apps/api/src/research/routes/execution.ts:24` |
| API-029 | POST `/api/app/research/documents/:documentId/runtime/interrupt` | 中断文档当前 Python 运行 | 控制／中断 | 路径参数 | `apps/api/src/research/routes/execution.ts:37` |
| API-030 | POST `/api/app/research/documents/:documentId/runtime/reset` | 重置文档 Python 会话及相关运行状态 | 控制／重置 | 路径参数 | `apps/api/src/research/routes/execution.ts:42` |

### 执行证据与业务交接

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-031 | GET `/api/app/research/artifacts/:artifactId` | 读取有权限的研究产物二进制；按 MIME 返回，支持 ETag/304 | 只读／二进制 | 路径参数 | `apps/api/src/research/routes/evidence.ts:17` |
| API-032 | GET `/api/app/research/documents/:documentId/executions` | 列出文档的冻结执行记录 | 只读 | 路径参数 | `apps/api/src/research/routes/evidence.ts:34` |
| API-033 | GET `/api/app/research/executions/:executionId` | 读取冻结源码、DAG、Cell 输出及执行状态 | 只读 | 路径参数 | `apps/api/src/research/routes/evidence.ts:39` |
| API-034 | POST `/api/app/research/executions/:executionId/promote` | 将成功执行标记为固化证据，保存名称、标签和说明 | 写／固化 | Body: `promoteExecutionSchema` | `apps/api/src/research/routes/evidence.ts:44` |
| API-035 | POST `/api/app/research/executions/:executionId/factor-draft` | 从符合准入要求的固化执行生成因子草稿 | LLM＋写／交接 | 路径参数 | `apps/api/src/research/routes/evidence.ts:57` |
| API-036 | POST `/api/app/research/executions/:executionId/strategy-draft` | 从符合准入要求的固化执行生成策略草稿 | LLM＋写／交接 | 路径参数 | `apps/api/src/research/routes/evidence.ts:66` |

### 修改提案与人工审阅

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-037 | POST `/api/app/research/cell-change-proposals/:proposalId/apply` | 明确应用 Agent 的 Cell 修改提案，更新内容及依赖失效状态 | 写／应用 | 路径参数 | `apps/api/src/research/routes/proposal.ts:15` |
| API-038 | POST `/api/app/research/cell-change-proposals/:proposalId/review` | 将提案临时应用到文档以供人工审阅；开放审阅阻止普通执行 | 写／待审状态 | 路径参数 | `apps/api/src/research/routes/proposal.ts:20` |
| API-039 | POST `/api/app/research/cell-change-proposals/:proposalId/review/accept` | 按 expectedContentRevision 接受当前审阅结果；不自动运行 | 写／接受 | Body: `cellChangeReviewSchema` | `apps/api/src/research/routes/proposal.ts:28` |
| API-040 | POST `/api/app/research/cell-change-proposals/:proposalId/review/revert` | 按 expectedContentRevision 撤回审阅应用并恢复内容 | 写／撤回 | Body: `cellChangeReviewSchema` | `apps/api/src/research/routes/proposal.ts:41` |
| API-041 | POST `/api/app/research/cell-change-proposals/:proposalId/reject` | 拒绝尚可拒绝的提案 | 写／拒绝 | 路径参数 | `apps/api/src/research/routes/proposal.ts:54` |
| API-042 | POST `/api/app/research/cell-change-proposals/:proposalId/attempts` | 明确运行提案尝试，保存 attempt 及执行结果；不等价于固化全文证据 | 同步执行＋写 | 路径参数 | `apps/api/src/research/routes/proposal.ts:59` |

### Agent 与问答

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-043 | POST `/api/app/research/agent/turns` | 启动研究 Agent，或处理澄清回答／attempt 解释；使用 conversationId 关联会话 | 后台 Agent | Body: `researchAgentInputSchema` | `apps/api/src/research/routes/agent.ts:9` |

### 数据发现与标的筛选

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-044 | GET `/api/app/research/data-catalog` | 按 q、assetType、scope、limit 检索证券、数据集或本人报告目录 | 只读 | Query: `dataCatalogQuerySchema` | `apps/api/src/research/routes/data.ts:9` |
| API-045 | POST `/api/app/research/universe-queries` | 按 UniverseSpec 筛选研究标的集合，返回选定字段；不执行用户 Python | 查询计算 | Body: `universeSpecV1Schema` | `apps/api/src/research/routes/data.ts:22` |

### Python 语言服务

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-046 | POST `/api/app/research/language/python` | 对请求中的多 Cell 源码提供补全、诊断、悬停、签名、定义、引用及重命名建议 | 语言服务／不执行 Cell | Body: `pythonLanguageRequestSchema` | `apps/api/src/research/routes/language.ts:8` |

### 宿主内嵌入式分析

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-047 | GET `/api/app/research/embedded-analyses` | 按宿主类型及 ID 分页列出本人的嵌入式分析 | 只读 | Query: `embeddedListSchema` | `apps/api/src/research/routes/embedded.ts:32` |
| API-048 | GET `/api/app/research/embedded-analyses/:analysisId` | 读取嵌入分析详情及其版本信息 | 只读 | 路径参数 | `apps/api/src/research/routes/embedded.ts:35` |
| API-049 | POST `/api/app/research/embedded-analyses/:analysisId/versions` | 从父版本派生新版本；可提供新草稿；返回 HTTP 201 | 写／新版本 | Body: `embeddedDeriveSchema` | `apps/api/src/research/routes/embedded.ts:38` |
| API-050 | GET `/api/app/research/embedded-analyses/:analysisId/versions/:versionId` | 读取指定分析版本 | 只读 | 路径参数 | `apps/api/src/research/routes/embedded.ts:44` |
| API-051 | PATCH `/api/app/research/embedded-analyses/:analysisId/versions/:versionId` | 按 expectedRevision 修改未冻结的分析版本 | 写／版本修订 | Body: `embeddedUpdateSchema` | `apps/api/src/research/routes/embedded.ts:49` |
| API-052 | POST `/api/app/research/embedded-analyses/:analysisId/versions/:versionId/runs` | 按 requestId 幂等提交版本运行，返回 HTTP 202；冻结输入和源码 | 后台 Job | Body: `embeddedRunSchema` | `apps/api/src/research/routes/embedded.ts:62` |
| API-053 | GET `/api/app/research/embedded-analyses/:analysisId/runs` | 分页列出该分析的运行记录 | 只读 | Query: `embeddedPageSchema` | `apps/api/src/research/routes/embedded.ts:76` |
| API-054 | GET `/api/app/research/embedded-analyses/:analysisId/runs/:runId` | 读取单次运行状态、输出、错误及输入元数据 | 只读／轮询 | 路径参数 | `apps/api/src/research/routes/embedded.ts:79` |
| API-055 | POST `/api/app/research/embedded-analyses/:analysisId/runs/:runId/continue-research` | 从成功运行接续为可编辑普通研究文档；默认重放留存输入 | 写／接续 | 路径参数 | `apps/api/src/research/routes/embedded.ts:82` |
| API-056 | PATCH `/api/app/research/embedded-analyses/documents/:documentId/input-mode` | 切换接续文档 retained/current 输入模式，校验修订并使 Python 输出失效 | 写／输入模式 | Body: `embeddedInputModeSchema` | `apps/api/src/research/routes/embedded.ts:92` |
| API-057 | POST `/api/app/research/embedded-analyses/:analysisId/runs/:runId/cancel` | 取消嵌入运行，终结 Job 并释放占用、尝试中断解释器 | 控制／取消 | 路径参数 | `apps/api/src/research/routes/embedded.ts:100` |
| API-058 | GET `/api/app/research/embedded-analyses/:analysisId/runs/:runId/inputs/:inputId` | 读取单条完整留存输入响应，用于审计取数与回放 | 只读 | 路径参数 | `apps/api/src/research/routes/embedded.ts:103` |

### 研究整理

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-059 | POST `/api/app/research/curator/runs` | 提交或复用研究整理任务，从已有证据生成候选发现 | 后台 Job | 无显式 schema | `apps/api/src/research/routes/curator.ts:10` |
| API-060 | GET `/api/app/research/curator/runs/latest` | 读取本人最近一次整理任务 | 只读 | 无显式 schema | `apps/api/src/research/routes/curator.ts:14` |
| API-061 | GET `/api/app/research/curator/runs/:runId` | 读取指定整理任务及发现结果 | 只读 | 路径参数 | `apps/api/src/research/routes/curator.ts:18` |
| API-062 | PATCH `/api/app/research/curator/findings/:findingId` | 保存发现的人工处置、核验反馈与备注 | 写／反馈 | Body: `curatorFindingUpdateSchema` | `apps/api/src/research/routes/curator.ts:23` |

## 因子研究

### 定义与生命周期

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-063 | GET `/api/app/factors/catalog` | 读取可用因子目录，包含当前用户可用的内置及用户因子 | 只读 | 无显式 schema | `apps/api/src/factor/routes/definition.ts:26` |
| API-064 | GET `/api/app/factors` | 读取本人因子列表 | 只读 | 无显式 schema | `apps/api/src/factor/routes/definition.ts:30` |
| API-065 | POST `/api/app/factors` | 创建因子草稿 | 写／创建 | Body: `createFactorDraftSchema` | `apps/api/src/factor/routes/definition.ts:34` |
| API-066 | POST `/api/app/factors/:factorId/publish` | 以 approvedReportId 为准入依据发布因子 | 写／发布 | Body: `publishFactorBodySchema` | `apps/api/src/factor/routes/definition.ts:38` |
| API-067 | POST `/api/app/factors/:factorId/archive` | 归档已存在的因子，受引用和状态约束 | 写／归档 | 路径参数 | `apps/api/src/factor/routes/definition.ts:52` |
| API-068 | PATCH `/api/app/factors/:factorId/visibility` | 修改因子的公开范围 | 写／权限范围 | Body: `factorVisibilitySchema` | `apps/api/src/factor/routes/definition.ts:57` |
| API-069 | GET `/api/app/factors/:factorId` | 读取指定因子定义与显示元数据 | 只读 | 路径参数 | `apps/api/src/factor/routes/definition.ts:67` |
| API-070 | PATCH `/api/app/factors/:factorId` | 更新可编辑因子草稿源码或属性 | 写／草稿 | Body: `updateFactorDraftSchema` | `apps/api/src/factor/routes/definition.ts:73` |
| API-071 | DELETE `/api/app/factors/:factorId` | 删除可删除的因子草稿 | 写／删除 | 路径参数 | `apps/api/src/factor/routes/definition.ts:79` |
| API-072 | POST `/api/app/factors/:factorId/copy` | 复制可访问的因子为新草稿 | 写／复制 | 路径参数 | `apps/api/src/factor/routes/definition.ts:83` |
| API-073 | POST `/api/app/factors/:factorId/metadata/refresh` | 根据源码与已有对话调用模型刷新草稿名称及双语说明 | LLM＋写／元数据 | Body: `factorMetadataBodySchema` | `apps/api/src/factor/routes/definition.ts:87` |

### 组合因子

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-074 | POST `/api/app/factors/composites/:compositeId/publish` | 根据批准的报告发布面板组合因子 | 写／发布 | Body: `publishFactorBodySchema` | `apps/api/src/factor/routes/composite.ts:21` |
| API-075 | POST `/api/app/factors/composites/:compositeId/archive` | 归档组合因子 | 写／归档 | 路径参数 | `apps/api/src/factor/routes/composite.ts:35` |
| API-076 | PATCH `/api/app/factors/composites/:compositeId/visibility` | 修改组合因子公开范围 | 写／权限范围 | Body: `factorVisibilitySchema` | `apps/api/src/factor/routes/composite.ts:40` |
| API-077 | GET `/api/app/factors/composites/:compositeId` | 读取组合因子定义及成员配置 | 只读 | 路径参数 | `apps/api/src/factor/routes/composite.ts:50` |
| API-078 | POST `/api/app/factors/composites` | 创建组合因子配置 | 写／创建 | Body: `factorCompositeInputSchema` | `apps/api/src/factor/routes/composite.ts:54` |
| API-079 | PATCH `/api/app/factors/composites/:compositeId` | 更新可编辑组合配置 | 写／更新 | Body: `factorCompositeInputSchema` | `apps/api/src/factor/routes/composite.ts:58` |
| API-080 | DELETE `/api/app/factors/composites/:compositeId` | 删除可删除的组合因子 | 写／删除 | 路径参数 | `apps/api/src/factor/routes/composite.ts:68` |
| API-081 | POST `/api/app/factors/composites/:compositeId/copy` | 复制组合为新的可编辑配置 | 写／复制 | 路径参数 | `apps/api/src/factor/routes/composite.ts:72` |

### 分析与保留段验证

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-082 | GET `/api/app/factors/analysis-reports` | 按条件列出因子分析报告 | 只读 | Query: `factorReportListQuerySchema` | `apps/api/src/factor/routes/analysis.ts:23` |
| API-083 | GET `/api/app/factors/analysis-reports/:reportId` | 读取分析报告详情与可展示结果 | 只读 | 路径参数 | `apps/api/src/factor/routes/analysis.ts:31` |
| API-084 | GET `/api/app/factors/analysis-jobs/:jobId` | 读取因子分析任务状态与增量日志 | 只读／轮询 | Query: `factorJobLogsQuerySchema` | `apps/api/src/factor/routes/analysis.ts:35` |
| API-085 | GET `/api/app/factors/research/window` | 读取当前因子研究可用窗口与保留段边界 | 只读 | 无显式 schema | `apps/api/src/factor/routes/analysis.ts:45` |
| API-086 | GET `/api/app/factors/research/summary` | 按请求条件读取因子研究摘要 | 只读 | Query: `factorResearchSummaryQuerySchema` | `apps/api/src/factor/routes/analysis.ts:49` |
| API-087 | POST `/api/app/factors/analyses` | 提交因子正式分析，冻结代码及研究配置 | 后台 Job | Body: `submitFactorAnalysisSchema` | `apps/api/src/factor/routes/analysis.ts:57` |
| API-088 | POST `/api/app/factors/analysis-reports/:reportId/holdout` | 对母报告冻结快照提交独立 holdout 验证，不提前揭示结果 | 后台 Job | 路径参数 | `apps/api/src/factor/routes/analysis.ts:63` |
| API-089 | POST `/api/app/factors/analysis-reports/:reportId/reveal` | 揭示已完成的 holdout 结果并记录 revealedAt；有持久化副作用 | 写／结果揭示 | 路径参数 | `apps/api/src/factor/routes/analysis.ts:69` |

### 相关性

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-090 | GET `/api/app/factors/correlations` | 读取给定因子研究配置的相关性结果或缓存 | 只读 | Query: `factorCorrelationQuerySchema` | `apps/api/src/factor/routes/correlation.ts:19` |
| API-091 | GET `/api/app/factors/correlation-jobs/active` | 查询对应相关性分析是否已有活动任务 | 只读 | Query: `factorCorrelationQuerySchema` | `apps/api/src/factor/routes/correlation.ts:27` |
| API-092 | POST `/api/app/factors/correlations` | 提交因子相关性计算 | 后台 Job | Body: `submitFactorCorrelationSchema` | `apps/api/src/factor/routes/correlation.ts:35` |
| API-093 | GET `/api/app/factors/correlation-jobs/:jobId` | 读取相关性任务状态与日志 | 只读／轮询 | Query: `factorJobLogsQuerySchema` | `apps/api/src/factor/routes/correlation.ts:45` |

### 因子气象

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-094 | GET `/api/app/factors/weather` | 读取本人固定项与气象序列；对 pending/running 项会再次触发后台刷新 | 读＋后台刷新 | 无显式 schema | `apps/api/src/factor/routes/weather.ts:15` |
| API-095 | POST `/api/app/factors/weather/pins` | 固定指定因子并启动气象刷新；用户因子需已发布 | 写＋后台刷新 | Body: `createFactorWeatherPinSchema` | `apps/api/src/factor/routes/weather.ts:19` |
| API-096 | POST `/api/app/factors/weather/pins/:pinId/refresh` | 请求刷新指定固定项，立即返回运行状态 | 后台刷新 | 路径参数 | `apps/api/src/factor/routes/weather.ts:23` |
| API-097 | DELETE `/api/app/factors/weather/pins/:pinId` | 移除固定项；pending/running 时拒绝移除 | 写／删除 | 路径参数 | `apps/api/src/factor/routes/weather.ts:27` |

### Agent 与问答

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-098 | POST `/api/app/factors/:factorId/agent/turns` | 为指定因子启动代码与研究辅助 Agent | 后台 Agent | Body: `factorAgentBodySchema`；Path: `factorAgentParamsSchema` | `apps/api/src/factor/routes/agent.ts:14` |
| API-099 | GET `/api/app/factors/:factorId/questions` | 读取指定因子的问答历史，响应 private,no-store | 只读 | Query: `factorQuestionHistorySchema` | `apps/api/src/factor/routes/agent.ts:29` |
| API-100 | POST `/api/app/factors/questions` | 按 factorKey 发起因子问答；缺少新字段的旧请求明确拒绝 | 后台 Agent | Body: `factorQuestionSchema` | `apps/api/src/factor/routes/agent.ts:46` |

## 策略研究

### 定义与生命周期

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-101 | GET `/api/app/strategies` | 列出本人的策略 | 只读 | 无显式 schema | `apps/api/src/strategy/routes/definition.ts:11` |
| API-102 | GET `/api/app/strategies/:strategyId` | 读取本人策略定义、配置与相关详情 | 只读 | 路径参数 | `apps/api/src/strategy/routes/definition.ts:15` |
| API-103 | POST `/api/app/strategies` | 创建策略定义；按请求配置与语言建立草稿 | 写／创建 | Body: `createStrategySchema` | `apps/api/src/strategy/routes/definition.ts:19` |
| API-104 | PATCH `/api/app/strategies/:strategyId/visibility` | 修改策略的公开范围 | 写／权限范围 | Body: `strategyVisibilitySchema` | `apps/api/src/strategy/routes/definition.ts:23` |
| API-105 | DELETE `/api/app/strategies/:strategyId` | 删除本人策略；受业务引用与状态约束 | 写／删除 | 路径参数 | `apps/api/src/strategy/routes/definition.ts:33` |

### Agent 与问答

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-106 | POST `/api/app/strategies/:strategyId/agent/turns` | 为指定策略启动 Agent 对话及代码辅助；事件走通用 Agent 接口 | 后台 Agent | Body: `strategyAgentBodySchema`；Path: `strategyAgentParamsSchema` | `apps/api/src/strategy/routes/agent.ts:10` |

### 回测

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-107 | POST `/api/app/strategies/:strategyId/backtests` | 冻结本次源码与回测配置，提交回测并返回任务身份 | 后台 Job | Path: `backtestStrategyIdentitySchema`；Body: `codeConfigSchema` | `apps/api/src/strategy/routes/backtest.ts:19` |
| API-108 | GET `/api/app/strategies/:strategyId/backtest-jobs/active` | 查询指定策略正在进行的回测任务 | 只读 | Path: `backtestStrategyIdentitySchema` | `apps/api/src/strategy/routes/backtest.ts:35` |
| API-109 | GET `/api/app/strategies/:strategyId/backtest-reports` | 列出指定策略的回测报告 | 只读 | Path: `backtestStrategyIdentitySchema` | `apps/api/src/strategy/routes/backtest.ts:43` |
| API-110 | GET `/api/app/strategies/backtest-reports/:reportId` | 读取回测报告及结果 | 只读 | 路径参数 | `apps/api/src/strategy/routes/backtest.ts:51` |
| API-111 | GET `/api/app/strategies/backtest-jobs/:jobId` | 读取回测任务状态和增量日志 | 只读／轮询 | Query: `backtestJobQuerySchema` | `apps/api/src/strategy/routes/backtest.ts:55` |

### 参数扫描

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-112 | POST `/api/app/strategies/scan-parameters/inspect` | 检查策略源码中可扫描参数及其定义；不提交扫描 | 计算／检查 | Body: `strategyScanParametersSchema` | `apps/api/src/strategy/routes/scan.ts:21` |
| API-113 | POST `/api/app/strategies/:strategyId/scans` | 提交指定策略的参数扫描，后台执行多组模拟 | 后台 Job | Path: `scanStrategyIdentitySchema`；Body: `submitStrategyScanSchema` | `apps/api/src/strategy/routes/scan.ts:29` |
| API-114 | GET `/api/app/strategies/:strategyId/scan-reports` | 列出策略参数扫描报告 | 只读 | Path: `scanStrategyIdentitySchema` | `apps/api/src/strategy/routes/scan.ts:45` |
| API-115 | GET `/api/app/strategies/:strategyId/scan-jobs/active` | 查询策略正在进行的扫描任务 | 只读 | Path: `scanStrategyIdentitySchema` | `apps/api/src/strategy/routes/scan.ts:53` |
| API-116 | GET `/api/app/strategies/scan-jobs/:jobId` | 读取扫描任务状态及增量日志 | 只读／轮询 | Query: `scanJobQuerySchema` | `apps/api/src/strategy/routes/scan.ts:61` |
| API-117 | GET `/api/app/strategies/scan-reports/:reportId` | 读取参数扫描报告与各参数组合结果 | 只读 | 路径参数 | `apps/api/src/strategy/routes/scan.ts:67` |

## 信号与账户

### 信号部署

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-118 | GET `/api/app/signals/deployments/latest-runs` | 汇总本人各信号部署的最新运行 | 只读 | 无显式 schema | `apps/api/src/signals/routes/deployment.ts:11` |
| API-119 | GET `/api/app/signals/deployments` | 按 strategyId 查询策略部署列表 | 只读 | Query: `deploymentListQuerySchema` | `apps/api/src/signals/routes/deployment.ts:15` |
| API-120 | POST `/api/app/signals/deployments` | 由回测 reportId 建立冻结的信号部署 | 写／部署 | Body: `createDeploymentBodySchema` | `apps/api/src/signals/routes/deployment.ts:20` |
| API-121 | POST `/api/app/signals/deployments/:deploymentId/pause` | 暂停指定信号部署 | 写／暂停 | 路径参数 | `apps/api/src/signals/routes/deployment.ts:26` |

### 信号运行

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-122 | GET `/api/app/signals/deployments/:deploymentId/runs` | 读取部署的信号运行列表，支持 limit | 只读 | Query: `signalRunListQuerySchema` | `apps/api/src/signals/routes/run.ts:13` |
| API-123 | POST `/api/app/signals/deployments/:deploymentId/runs` | 按可选 tradeDate 提交信号运行，返回 runId、jobId、started | 后台 Job | Body: `submitSignalRunBodySchema` | `apps/api/src/signals/routes/run.ts:23` |
| API-124 | GET `/api/app/signals/run-jobs/:jobId` | 读取信号运行任务及 since 之后的日志 | 只读／轮询 | Query: `signalRunJobQuerySchema` | `apps/api/src/signals/routes/run.ts:35` |

### 运行控制与执行

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-125 | GET `/api/app/signals/deployments/:deploymentId/execution-overview` | 读取部署执行概览、模型／模拟／实际账户及偏差 | 只读 | 路径参数 | `apps/api/src/signals/routes/execution.ts:26` |
| API-126 | PATCH `/api/app/signals/executions/:executionId` | 更新旧版 accountingVersion=1 的人工成交状态并重放实际账户 | 写／旧版记账 | Body: `actualExecutionSchema` | `apps/api/src/signals/routes/execution.ts:31` |
| API-127 | GET `/api/app/signals/deployments/:deploymentId/executions` | 读取部署账户历史、执行任务与成交视图 | 只读 | 路径参数 | `apps/api/src/signals/routes/execution.ts:44` |
| API-128 | POST `/api/app/signals/deployments/:deploymentId/account-replays` | 重试或重放部署账户，恢复派生记账结果 | 计算＋写／重放 | 路径参数 | `apps/api/src/signals/routes/execution.ts:47` |
| API-129 | POST `/api/app/signals/executions/:executionId/resolutions` | 结合实际敞口、价格与依赖确认，解析执行目标及交易腿 | 计算＋写／解析 | Body: `resolutionContextSchema` | `apps/api/src/signals/routes/execution.ts:50` |
| API-130 | POST `/api/app/signals/executions/:executionId/fills` | 录入人工实际成交，带 clientRequestId 与 expectedRevision | 写／成交记账 | Body: `signalFillSchema` | `apps/api/src/signals/routes/execution.ts:58` |
| API-131 | PATCH `/api/app/signals/fills/:fillId` | 追加成交作废或替代修订；保留修订血缘 | 写／成交修订 | Body: `reviseSignalFillSchema` | `apps/api/src/signals/routes/execution.ts:64` |
| API-132 | PATCH `/api/app/signals/executions/:executionId/decision` | 将执行任务设为 pending 或 skipped，记录理由和预期修订 | 写／人工决策 | Body: `signalTaskDecisionSchema` | `apps/api/src/signals/routes/execution.ts:68` |
| API-133 | POST `/api/app/signals/deployments/:deploymentId/market-input-revisions` | 按日期修订冻结市场输入并推进账户重算 | 写／输入修订 | Body: `signalMarketRevisionSchema` | `apps/api/src/signals/routes/execution.ts:77` |

## 通用 Agent 执行

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-134 | GET `/api/app/agent/turns/active` | 按 entity 查询本人正在运行的 Agent turnId | 只读 | Query: `activeTurnQuerySchema` | `apps/api/src/agent/routes/turn.ts:13` |
| API-135 | GET `/api/app/agent/turns/:turnId` | 读取本人单轮对话详情与持久化轨迹 | 只读 | 路径参数 | `apps/api/src/agent/routes/turn.ts:18` |
| API-136 | GET `/api/app/agent/turns/:turnId/stream` | 订阅 Agent 实时事件与快照；进程内订阅失效时需回读持久化详情 | SSE／GET | 路径参数 | `apps/api/src/agent/routes/turn.ts:23` |
| API-137 | POST `/api/app/agent/turns/:turnId/cancel` | 取消本人的运行轮次；已结束或未知轮次返回 cancelled:false | 控制／幂等取消 | 路径参数 | `apps/api/src/agent/routes/turn.ts:60` |
| API-138 | 非 GET（ALL 兜底） `/api/app/agent/turns/:turnId/stream` | 拒绝同一 stream 路径的非 GET 请求；不是另一种订阅能力 | 保护入口／拒绝 | 路径参数 | `apps/api/src/agent/routes/turn.ts:66` |

## 公开资源库

| ID | 方法与完整路径 | 用途 | 调用与副作用 | 显式入参契约 | 代码定位 |
| --- | --- | --- | --- | --- | --- |
| API-139 | GET `/api/app/library` | 汇总当前用户可见的公开资源库；业务上公开，但 HTTP 仍要求登录 | 只读 | 无显式 schema | `apps/api/src/sharing/routes.ts:7` |
| API-140 | POST `/api/app/library/strategies/:strategyId/copy` | 将可复制的公开策略复制为本人策略 | 写／复制 | 路径参数 | `apps/api/src/sharing/routes.ts:11` |

## 人工审阅重点

| 审阅点 | 对应接口 | 需要确认的业务问题 |
| --- | --- | --- |
| 产品表面是否收敛 | Research、Factor、Strategy 全组 | 每个入口是否对应反复使用、需要稳定契约的工作流；探索能力是否过多进入正式接口。 |
| 公开范围 | Library 与各 visibility 入口 | “公开资源”仍在登录门禁内是否符合预期；资源公开是否仅作用于预期对象。 |
| 同步和后台执行 | Research execution／proposal、embedded、Factor analysis、Strategy backtest／scan | 前端是否能区分等待结果、提交后台任务、任务终态和业务结果状态。 |
| 证据与保留段 | Research promote／handoff、Factor holdout／reveal／publish | 固化、交接、样本外揭示与发布是否有明确人工动作，是否避免误把草稿或尝试当成正式证据。 |
| 读接口副作用 | Factor weather GET、Research document GET | 刷新重触发和旧会话补建是否接受；代理、缓存、重试是否符合调用预期。 |
| 双轨记账 | Signals PATCH execution 与 fills／decision／resolution／revisions | 旧版和新版使用条件是否清楚；人工成交、修订、重放及失败恢复是否可追溯。 |
| 修订与幂等 | Cell 更新、提案接受／撤回、embedded runs、Signals fills | expectedRevision／expectedContentRevision 和 requestId／clientRequestId 的客户端使用是否完整。 |
| 缺省日期 | Market index series | 路由默认 end=20261231，是否应继续保留固定截止日期。 |
| 开发入口 | Auth dev/login | 部署是否保证 NODE_ENV=production，从而不注册直接登录路由。 |
| 语言服务边界 | Research language/python | documentId 是源码会话隔离键；客户端是否理解 rename 返回建议而非自动写入已保存文档。 |
| 订阅恢复 | Agent stream | 进程重启或 TTL 失效后，是否回读持久化详情；非 GET 明确拒绝入口是否仍需要。 |

## 审阅记录模板

按接口 ID 记录，可直接复制下表；未填写不表示通过。

| 接口 ID | 结论（保留／调整／合并／移除） | 问题与理由 | 后续动作 |
| --- | --- | --- | --- |
| API-___ | 待审 |  |  |

## 覆盖核对与范围边界

逐文件枚举显式 GET/POST/PATCH/PUT/DELETE/ALL 声明，并结合 server.ts、各模块 routes/index.ts 的挂载关系拼接路径；再以 TypeScript AST 独立遍历入口与子路由，核对完整路径、方法、源码行号及表格行数。本次未发现 PUT 路由；140 条声明与 140 条明细逐项一致，无漏项或重复。生产 138 条的计数包含探针，不包含非生产登录和 ALL 拒绝入口。

这是基准日期的源码接口清单与用途梳理，不代表各接口已通过行为验收或生产实测。内部 SDK／Agent 工具可以调用未单独暴露 HTTP 的业务能力，例如创建嵌入分析；没有对应 HTTP 路由时不虚构接口。sandboxd 使用内部 TCP 会话协议，上游数据提供者使用其自身接口，均不计入应用 HTTP 清单。
