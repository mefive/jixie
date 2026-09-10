# 后端架构重构基线

> 后续产品调整（2026-09-10）：Agent 快速回测工具及专用 Worker 已退役，见 [产品决策](agent-research-loop.md)。本文仍记录重构前基线，不回写历史文件清单与验收事实。

> 核对日期：2026-09-08。源码基线：`12ce90926acac65881f78dbc16228805f0a7848d`。
> 对应 [开发计划](backend-architecture-refactor.md) 的工作包 A / Commit 1；本文件记录迁移前事实与目标归属，目标路径尚未实施。
> 用途：供开发者核对后续提交的范围、调用方和行为等价性；不提供新的产品接口。

## 1. 范围与工作区

本次仅新增/更新本文与开发计划。开始时工作区已有已暂存的 `docs/books/穿透估值：读懂估值中的共识与博弈 - full.epub`，该文件不属于重构提交，保持暂存状态与内容。开发计划原为未跟踪文件，随 Commit 1 收录。源代码、配置、数据库 schema 和公开契约未修改。

API 源目录共 **455 个文件**：182 个 `.test.ts`，1 个 `.d.ts`，其余 272 个实现、Worker 开发入口或测试辅助文件。行数包含空行、注释和测试，仅用于评估阅读/迁移规模，不代表有效代码量。Vitest 另外发现 `apps/api/scripts/fundamentals` 下 3 个测试文件，故 API 测试总文件数为 185。

所有源码文件的内容/路径联合 SHA-256：`e4ad1dce886ca18558b125b848988a5d131080b1040165b759471d1ac2c41494`。

联合摘要算法：按仓库相对路径排序，每项拼接 `路径 + NUL + 文件内容 SHA-256 + 换行`，对 UTF-8 编码后的完整清单再计算 SHA-256。目录迁移会使联合摘要变化；公开契约另按固定路径校验。当前 HEAD 可用于取得原始逐文件内容，摘要只提供一致性核对，不代替行为测试。

| 原目录 | 文件数 | 其中测试文件 | 总行数 |
| --- | --- | --- | --- |
| (root) | 3 | 0 | 133 |
| agent | 42 | 15 | 7103 |
| commodity | 17 | 8 | 3501 |
| data-quality | 3 | 1 | 2279 |
| engine | 39 | 12 | 11311 |
| factor | 76 | 33 | 14905 |
| fundamentals | 13 | 6 | 4237 |
| i18n | 3 | 0 | 705 |
| lib | 25 | 8 | 2703 |
| llm | 2 | 0 | 206 |
| macro | 8 | 4 | 2827 |
| maintenance | 18 | 6 | 3449 |
| market | 11 | 4 | 3334 |
| rates | 8 | 4 | 1610 |
| research | 93 | 42 | 26221 |
| risk | 19 | 10 | 4009 |
| routes | 15 | 2 | 6048 |
| services | 2 | 1 | 274 |
| signals | 12 | 5 | 2397 |
| store | 9 | 4 | 3466 |
| strategy | 22 | 9 | 4123 |
| tushare | 13 | 8 | 2214 |
| types | 1 | 0 | 16 |
| util | 1 | 0 | 13 |

## 2. 已完成的验证

环境：macOS，Node `22.23.1`、pnpm `9.15.9`、Vitest `3.2.6`。根级 `pnpm typecheck` 包含 Research runtime、Research SDK、Factor SDK 三项生成物一致性检查，并检查 shared、sandboxd、API、Web、Docs。

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| pnpm typecheck | 通过 | 三项 Contract/生成物检查及全部 workspace 类型检查通过 |
| API 完整测试，4 个 Worker | 185 文件 / 956 测试全部通过 | ACCOUNTING_INTEGRATION=1；全新临时 SQLite + 一条合成 StockBasic 记录 |
| Agent core 单文件复核 | 28 / 28 通过 | 补入明确 fixture 后通过，未修改任何测试或业务代码 |
| pnpm --filter sandboxd test | 1 文件 / 8 测试通过 | 解除本地 Unix socket 沙箱限制后通过；使用假的 Docker/Podman 命令 |
| pnpm test:dev-shutdown | 1 / 1 通过 | 开发进程组清理测试 |
| node --test scripts/plan-deployment.test.mjs | 8 / 8 通过 | 部署影响分类现有规则 |

### 2.1 空数据库失败与复现条件

第一次 API 完整测试使用空 schema，结果为 184 个文件通过、1 个文件失败；954 项通过、2 项失败。两项都在 `agent/core.test.ts`：

- `applies a fenced code change + returns the explanation without the fence`：预期 changed=true，实际为 false。
- `threads prior history into the model call`：预期模型消息数为 3，实际为 9。

单文件复跑得到相同失败。源码核对与直接调用 `strategyProfile().artifact.validate` 证明：策略 fixture 使用 `600519.SH`，profile 会查询真实 Prisma 数据源并执行证券存在性检查，空数据库返回 `unknown or unsynced ts_code(s)`。测试未自行准备或 mock 该记录。随后修复轮次追加模型消息，mock 保存的同一消息数组也增长，因此第二个断言随之失败。

仅在隔离数据库插入下述记录后，Agent 28 项全部通过；再使用另一份全新数据库、相同记录和账户集成开关复跑全套，956 项全部通过。此问题记录为**现有测试依赖未自包含**，不归类为业务逻辑回归，也不在本次文档提交中修复或放宽证券校验。

```sql
INSERT INTO StockBasic (tsCode, symbol, name, listStatus)
VALUES ('600519.SH', '600519', 'Fixture instrument', 'L');
```

这是一条测试证券身份记录，不包含真实行情、公司财务或用户数据。账户集成测试自行写入固定用户/策略/成交，因此每次完整复跑都应使用新数据库，避免重复主键。

### 2.2 可复现的准备与命令

以下从仓库根目录运行，`DATABASE_URL` 使用临时目录中的绝对路径。Prisma 会提示读取 API `.env`，但显式传入的数据库 URL 指向临时库。不要省略这个覆盖。初次对不存在的 SQLite 文件执行 db push 曾返回没有细节的 `Schema engine error`；先创建空 SQLite 文件后成功。原因未进一步归因，保留这一准备步骤。

```bash
baseline_dir=$(mktemp -d /tmp/jixie-backend-baseline.XXXXXX)
export DATABASE_URL="file:$baseline_dir/api-test.db"
python3 - <<'PYTHON'
import os, sqlite3
sqlite3.connect(os.environ['DATABASE_URL'].removeprefix('file:')).close()
PYTHON
pnpm --filter api exec prisma db push --skip-generate
python3 - <<'PYTHON'
import os, sqlite3
with sqlite3.connect(os.environ['DATABASE_URL'].removeprefix('file:')) as database:
    database.execute(
        'INSERT INTO StockBasic (tsCode,symbol,name,listStatus) VALUES (?,?,?,?)',
        ('600519.SH', '600519', 'Fixture instrument', 'L'),
    )
PYTHON
ACCOUNTING_INTEGRATION=1 pnpm --filter api exec vitest run --maxWorkers=4
pnpm typecheck
pnpm --filter sandboxd test
pnpm test:dev-shutdown
node --test scripts/plan-deployment.test.mjs
```

实际未设置 `JIXIE_PYTHON_EXECUTABLE`、`JIXIE_PYTHON_LOCAL` 或 `JIXIE_SANDBOX_SOCKET` 的外部覆盖。各运行时测试按自己的现有 setup 启用本地 Python；默认 PATH Python 为 `3.14.6`，FCFF 测试显式使用仓库 `.venv/research-py-v1/bin/python3`（`3.13.3`）。所以本次通过表示当前本地测试通过，**不能等同于所有 Python 测试均在正式 research-py-v1 环境执行**。后续运行时提交须显式核对 Python 可执行文件、契约依赖及生产隔离环境。

### 2.3 环境限制与未执行项

- sandboxd 首次执行 8 项均因 `listen EPERM` 失败，原因是工具沙箱禁止创建本地 Unix socket；经工具权限审查允许在沙箱外执行相同测试，8 项通过。此为运行环境限制，源码未改。
- sandboxd 测试使用临时假的容器运行命令；未启动真实生产容器，不证明容器网络、镜像和资源限制满足生产要求。
- 本提交没有改变源码或 UI，未运行全仓 lint、完整构建、浏览器 E2E、生产 dist Worker smoke，也无 UI 截图。对应验证随受影响实现提交和最终验收执行。
- 没有运行真实市场同步、全量数据审计、真实邮件或 LLM 请求。db push 只创建隔离测试 schema，没有生成或修改 migration。
- 临时数据库只供本次基线使用。全部测试命令已退出，进程列表未发现残留 Vitest、Python runner、测试 sandboxd 或 Pyright 服务；lsof 确认两份临时数据库无打开连接。原始日志为临时证据，长期复现依赖本节步骤与固定源码 HEAD。

## 3. 当前启动与执行入口

### 3.1 API 启动与停止

当前 `index.ts` 读取 PORT（默认 3001）并调用 `server.ts:startServer`。后者先 buildApp，再并行执行 `markRunningJobsStale`、`markRunningAgentTurnsInterrupted`、`resetInterruptedFactorWeatherRefreshes`，等待完成；预置因子初始化是非阻塞任务，随后启动 Job 队列、监听 HTTP。开发 Python 探测在 startServer 返回后异步执行。

`lib/prisma.ts` 在 import 时创建客户端，并异步执行 WAL 与 busy_timeout PRAGMA。每个进程/Worker 有自己的模块实例。`server.ts` 当前没有保留/返回 HTTP server 关闭句柄，`index.ts` 没有统一 SIGTERM/SIGINT 清理入口；不能把目标 bootstrap 的关闭规划写成已有行为。

`startJobQueue` 的实际非测试调用只有 `server.ts`。其他路由和业务调用 `wakeJobQueue`；队列未启动时 wake 直接返回。`scripts/run-signals.ts` 和维护链路调用业务入队/等待，不自行启动队列，依赖正在运行的 API 消费持久化任务。重构时不能因为共享处理函数而让这些 CLI 多启动一个调度器。

### 3.2 Job 与非 Job 执行

| kind/机制 | 实际处理入口 | 执行形态 | 目标归属/约束 |
| --- | --- | --- | --- |
| backtest | strategy/backtest-job.ts → engine/backtest-worker.ts | Worker 线程 | strategy/backtest；保留报告与 Job 原子终态 |
| factor / analysis | factor/analysis-job.ts → factor/factor-worker.ts | Worker 线程 | factor/analysis；报告/Job 完成事务由业务拥有 |
| factor / correlation | factor/correlation-job.ts → factor/correlation-worker.ts | Worker 线程 | factor/analysis；payload.task 分支保持 |
| strategy-scan | strategy/scan-job.ts → engine/strategy-scan-worker.ts | 父 Worker 线程 + cell 子进程 | strategy/scans；不能统一改成线程或进程 |
| signal | signals/service.ts → engine/signal-worker.ts | fork 子进程 | signals/runs；按 runId 查询冻结配置 |
| research-curator | research/curator-job.ts → curator.ts | API 进程内异步操作 | research/curator；不是另一个 Worker |
| Agent turn | agent/turn-run.ts → core.ts | 进程内后台执行 + SSE | 不走 Job FIFO；断开流与取消是不同动作 |
| Research Cell/文档 | research/workbench.ts → workbench-runtime.ts | 文档级会话 + Python 执行 | 路由等待操作；保留互斥、stale/blocked 与证据冻结 |
| 维护参考数据 | maintenance/reference-worker-process.ts → reference-worker.ts | fork 子进程 | 留 maintenance，不挂到通用 Job 队列 |

Job 默认并发为全局 2、每用户 1；候选查询按 queuedAt/id 排序，最多取 200 条后选择可运行项。持久化 kind 为 backtest、factor、strategy-scan、signal、research-curator；状态为 queued/running/done/error/stale。payload 校验分别位于对应 runner，目录路径不进入持久化 kind。

`markRunningJobsStale` 使用一个跨实体事务；`failJobAndEntity` 同样统一处理 Job 与业务实体。回测/因子/扫描/信号完成助手已有事务。Curator 当前完成业务 run 与 `finishJob` 并非一个共同事务；这属于现状差异，Commit 4 核对时不得用“全部完成事务原本一致”的假设掩盖行为变化。日志在内存追加，终态持久化后延迟清理，保持现有 TTL 语义。

### 3.3 路径字符串与 Worker 清单

| 创建方（相对 src） | 入口 stem | 形态 | 目标目录 |
| --- | --- | --- | --- |
| strategy/backtest-job.ts | engine/backtest-worker | Worker | strategy/backtest/ |
| factor/analysis-job.ts | factor/factor-worker | Worker | factor/analysis/ |
| factor/correlation-job.ts | factor/correlation-worker | Worker | factor/analysis/ |
| strategy/scan-job.ts | engine/strategy-scan-worker | Worker | strategy/scans/ |
| engine/strategy-scan-worker.ts | engine/strategy-scan-cell-worker | fork | strategy/scans/ |
| signals/service.ts | engine/signal-worker | fork | signals/runs/ |
| agent/tools/run-quick-backtest.ts | engine/agent-backtest-worker | Worker | agent/tools/quick-backtest/ |
| agent/tools/read-only-sql.ts | agent/tools/sql-worker | Worker + node:sqlite 只读连接 | agent/tools/sql/ |
| maintenance/reference-worker-process.ts | maintenance/reference-worker | fork；直接选择 .ts/.js | maintenance/ |

前 8 项开发路径使用同 stem 的 `.boot.mjs`，再 import `.ts`；生产使用 `.js`。维护参考数据入口直接选择 `.ts/.js`。另有 `engine/walled-run.test-worker.mjs`，它是隔离计算一致性测试辅助，随 walled-run 测试迁移。

其他非普通 import 路径：

- `engine/walled-run.ts` 用 esbuild 选择 `wall-entry.ts/.js`，并把 prisma-port 替换为 stub；模拟核心接收 DataPort 后才能删除该替换。
- `strategy/python/session.ts` 的本地 runner 依赖 API cwd，通过 `../sandboxd/python/jixie_runner.py` 定位；生产使用 Unix socket。
- SQL 工具按 DATABASE_URL 和相对 Prisma 目录解析数据库文件。迁移到更深目录时必须核对层级，保持只读连接与白名单。
- `research/pyright-language-service.ts` 通过包解析定位 Pyright 服务，并写临时文档/stub；不能按普通相对 import 检查替代真实启动验证。
- `scripts/gen-stats-doc.ts` 使用 `new URL` 指向 stats 源码与生成目标，随 math 迁移一起更新。

独立 `apps/sandboxd` 的 Node 入口、帧协议、runtime 及 Python runner 路径保持；生产进程由部署设施管理，API 只管理自身连接/会话。

## 4. 依赖基线与需拆分的边界

使用 TypeScript AST 读取源码 import/re-export 与字面量动态 import，按 API tsconfig 解析相对模块。API src 共 1884 条声明边：普通 import/re-export 1478 条、显式 type-only 391 条、字面量动态 import 15 条；相对声明均可解析。普通声明可能最终被编译器消除，因此该分类是语法基线，不声称每一条都是运行时加载。

排除 `.test.ts` 与声明文件（Worker 测试启动辅助仍登记在图内），对普通边及字面量动态 import 联合分析，发现一组 5 文件的强连通分量。它包含延迟加载关系，不能直接等同于启动时同步循环加载：

| 调用方 | 依赖方 | 边类型 |
| --- | --- | --- |
| engine/prepare-custom-factors.ts | factor/publication.ts | runtime |
| engine/prepare-custom-factors.ts | factor/analysis-job.ts | runtime |
| factor/analysis-job.ts | lib/job-queue.ts | runtime |
| factor/publication.ts | factor/analysis-job.ts | runtime |
| lib/job-queue.ts | factor/analysis-job.ts | dynamic |
| lib/job-queue.ts | signals/service.ts | dynamic |
| signals/service.ts | engine/prepare-custom-factors.ts | runtime |
| signals/service.ts | lib/job-queue.ts | runtime |

Commit 4 通过将 runner 连接放在 bootstrap、队列只消费传入的处理函数，去掉通用队列对业务的反向依赖。其余需要沿实际职责处理的边界：

| 现有边界 | 当前事实 | 对应提交 |
| --- | --- | --- |
| HTTP → Prisma | 路由直接执行归属、状态和事务；迁入业务操作时仍须保留权限 | 2、6～11 各业务 |
| i18n → Hono | 纯翻译与请求 Context 辅助共享入口；会把 HTTP 依赖带入调用方 | 2 |
| Research/Factor → strategy/python | 公共通信路径误归策略；协议还混合领域 SDK | 3 |
| Engine → Prisma/业务准备 | run 默认 prismaDataPort；configured-run 与 prepare-custom-factors 是宿主编排 | 8 |
| data-quality → risk → 市场数据 | 整体审计混合基础数据与具体模型门槛 | 8、11 |
| Research handoff ↔ Agent 上层组合 | handoff 使用 core，profile/tool 使用业务；core 不应反向依赖 profile | 6、10 |
| Worker/包生成路径 | URL、cwd、esbuild alias 与非字面量 import 不在普通模块边检查内 | 3、7～12 |

AST 检查没有执行模块，不核验 HTTP 权限、反射、运行期条件加载或实际构建产物。8 个 `import(new URL(...).href)` 已通过 Worker 清单单列。最终边界门禁的实现属于 Commit 12，本提交只有基线文档，未添加检查器到构建链路。

## 5. 公开契约与持久化边界

保持 Prisma schema/migration、HTTP URL/方法/顺序、SSE 事件、Job kind/payload、报告 JSON、代码/结果哈希、Research/Factor SDK 和运行时依赖契约不变。以下摘要用于核对原始文件内容：

| 文件 | SHA-256 |
| --- | --- |
| apps/api/prisma/schema.prisma | `9e23e616d4e5901fa6a7faa3ad121a12a5adc7a5c0d21cd019db55f08fe00099` |
| packages/shared/src/research-sdk-contract.ts | `0709774ecb8e06f3521773ab164ac119db2a16f5a8ac5fe1dd094e9117f3a031` |
| packages/shared/src/factor-python-sdk.ts | `6f5648b2191aceda40e4f485ec07eef71ed38c015666fbff13fd6c2f46addea7` |
| packages/shared/src/research-python-runtime.ts | `1bdee37816e86f7be2aef0f4066cd5dea6bcb6fd37bd9656f5c653a851139d84` |
| apps/sandboxd/python/jixie_research_sdk.pyi | `da5f0231f305c422518d51e20bb3db983a6307f2aa64e378354028372f964196` |
| apps/sandboxd/python/jixie_factor_sdk.pyi | `121c5463e175cd484d5a5f72ae881aeacbda9519c551ca954739e76462c5d2ba` |
| apps/sandboxd/python/requirements-research-runtime.txt | `415f46a44d11e44a58d4235d90d3ec294c73530a2d17f3de226538b6c19f6469` |
| pnpm-lock.yaml | `5c9cccf45b6ccec52eaa8974365eccf0d1c00bfa6c1232d868dece5befe5f37a` |

- Prisma migrations：91 个文件，路径/内容联合摘要 `bc568f26d3d9d4fe8707d7a97263064a5f0845ed557c9cbffa500b4702a62f31`。
- packages/shared/src：29 个文件，路径/内容联合摘要 `0eef3d8e5c95f0308bf52b40ef733691652600718bea8f63f4973041cc22ee62`。
- sandboxd 源码与 Python：10 个文件，路径/内容联合摘要 `62144ef5d6043866e7d3b3efc2c0ade7022aa7f7c2654e9a28ef1f1c5c7406c2`。

存量 JSON 的等价比较仍需 fixture 测试，源码摘要不证明序列化语义未变。风险研究的产品入口仍为策略回测报告 `allocationAnalysis.risk`；Agent 快速回测的摘要不会因此新增风险字段。

## 6. HTTP 注册清单

以下来自 server 和各路由文件的静态 AST，按 server 挂载顺序递归展开。路径以挂载前缀加相对路径表达，根 `/` 子路由显示为挂载路径；不是运行中的路由 introspection，也不代替尾斜杠行为测试。共 132 条 HTTP 注册，含 1 条 `ALL` SSE 注册；不将 ALL 展开为多个方法。

全局先挂 logger；`/api/auth` 自行处理登录身份；`/api/maintenance/status` 为公开维护状态。`/api/app/*` 先经过 maintenanceGate，再经过 requireAuth，然后进入业务路由。字面量路径、参数路径及注册顺序必须一起保持。

| 顺序 | 方法 | 完整路径 | 当前文件:行 |
| --- | --- | --- | --- |
| 1 | GET | `/` | `apps/api/src/server.ts:57` |
| 2 | GET | `/api/health` | `apps/api/src/server.ts:58` |
| 3 | GET | `/api/auth/me` | `apps/api/src/routes/auth.ts:34` |
| 4 | POST | `/api/auth/logout` | `apps/api/src/routes/auth.ts:56` |
| 5 | POST | `/api/auth/email/request` | `apps/api/src/routes/auth.ts:87` |
| 6 | POST | `/api/auth/email/verify` | `apps/api/src/routes/auth.ts:188` |
| 7 | POST | `/api/auth/dev/login` | `apps/api/src/routes/auth.ts:264` |
| 8 | GET | `/api/maintenance/status` | `apps/api/src/maintenance/http.ts:8` |
| 9 | GET | `/api/app/agent/conversations` | `apps/api/src/routes/agent.ts:28` |
| 10 | GET | `/api/app/agent/conversations/:conversationId/messages` | `apps/api/src/routes/agent.ts:49` |
| 11 | GET | `/api/app/agent/turns/:turnId/detail` | `apps/api/src/routes/agent.ts:79` |
| 12 | GET | `/api/app/agent/turns/:turnId/stream` | `apps/api/src/routes/agent.ts:97` |
| 13 | GET | `/api/app/agent/turns/running` | `apps/api/src/routes/agent.ts:137` |
| 14 | POST | `/api/app/agent/turns/:turnId/cancel` | `apps/api/src/routes/agent.ts:143` |
| 15 | POST | `/api/app/agent/sql` | `apps/api/src/routes/agent.ts:152` |
| 16 | POST | `/api/app/agent/chart/compute` | `apps/api/src/routes/agent.ts:166` |
| 17 | ALL | `/api/app/agent/turns/:turnId/stream` | `apps/api/src/routes/agent.ts:176` |
| 18 | GET | `/api/app/market/names` | `apps/api/src/routes/market.ts:55` |
| 19 | GET | `/api/app/market/objects/:assetType/:id/series` | `apps/api/src/routes/market.ts:122` |
| 20 | GET | `/api/app/market/indices/valuation/catalog` | `apps/api/src/routes/market.ts:139` |
| 21 | GET | `/api/app/market/indices/:code/valuation` | `apps/api/src/routes/market.ts:165` |
| 22 | GET | `/api/app/market/weather` | `apps/api/src/routes/market.ts:198` |
| 23 | GET | `/api/app/market/industry-weather` | `apps/api/src/routes/market.ts:305` |
| 24 | GET | `/api/app/market/state` | `apps/api/src/routes/market.ts:405` |
| 25 | GET | `/api/app/market/indices/:code/series` | `apps/api/src/routes/market.ts:582` |
| 26 | GET | `/api/app/market/futures/:code/series` | `apps/api/src/routes/market.ts:593` |
| 27 | GET | `/api/app/strategies` | `apps/api/src/routes/strategies.ts:30` |
| 28 | GET | `/api/app/strategies/:id` | `apps/api/src/routes/strategies.ts:68` |
| 29 | POST | `/api/app/strategies` | `apps/api/src/routes/strategies.ts:116` |
| 30 | POST | `/api/app/strategies/:id/visibility` | `apps/api/src/routes/strategies.ts:157` |
| 31 | POST | `/api/app/strategies/:id` | `apps/api/src/routes/strategies.ts:180` |
| 32 | DELETE | `/api/app/strategies/:id` | `apps/api/src/routes/strategies.ts:224` |
| 33 | POST | `/api/app/factors/custom/:id/publish` | `apps/api/src/routes/factors.ts:104` |
| 34 | POST | `/api/app/factors/custom/:id/archive` | `apps/api/src/routes/factors.ts:117` |
| 35 | POST | `/api/app/factors/custom/:id/visibility` | `apps/api/src/routes/factors.ts:122` |
| 36 | POST | `/api/app/factors/composites/:id/publish` | `apps/api/src/routes/factors.ts:143` |
| 37 | POST | `/api/app/factors/composites/:id/archive` | `apps/api/src/routes/factors.ts:160` |
| 38 | POST | `/api/app/factors/composites/:id/visibility` | `apps/api/src/routes/factors.ts:165` |
| 39 | GET | `/api/app/factors/catalog` | `apps/api/src/routes/factors.ts:186` |
| 40 | GET | `/api/app/factors/composites/:id` | `apps/api/src/routes/factors.ts:315` |
| 41 | POST | `/api/app/factors/composites` | `apps/api/src/routes/factors.ts:325` |
| 42 | POST | `/api/app/factors/composites/:id` | `apps/api/src/routes/factors.ts:365` |
| 43 | DELETE | `/api/app/factors/composites/:id` | `apps/api/src/routes/factors.ts:400` |
| 44 | POST | `/api/app/factors/composites/:id/copy` | `apps/api/src/routes/factors.ts:410` |
| 45 | GET | `/api/app/factors/custom` | `apps/api/src/routes/factors.ts:514` |
| 46 | GET | `/api/app/factors/custom/:id` | `apps/api/src/routes/factors.ts:533` |
| 47 | POST | `/api/app/factors/custom` | `apps/api/src/routes/factors.ts:622` |
| 48 | POST | `/api/app/factors/custom/:id` | `apps/api/src/routes/factors.ts:683` |
| 49 | DELETE | `/api/app/factors/custom/:id` | `apps/api/src/routes/factors.ts:750` |
| 50 | POST | `/api/app/factors/custom/:id/copy` | `apps/api/src/routes/factors.ts:772` |
| 51 | GET | `/api/app/factor-weather` | `apps/api/src/routes/factor-weather.ts:28` |
| 52 | POST | `/api/app/factor-weather/pins` | `apps/api/src/routes/factor-weather.ts:61` |
| 53 | POST | `/api/app/factor-weather/pins/:id/refresh` | `apps/api/src/routes/factor-weather.ts:119` |
| 54 | DELETE | `/api/app/factor-weather/pins/:id` | `apps/api/src/routes/factor-weather.ts:134` |
| 55 | GET | `/api/app/signals/today` | `apps/api/src/routes/signals.ts:47` |
| 56 | GET | `/api/app/signals/deployments/current` | `apps/api/src/routes/signals.ts:49` |
| 57 | GET | `/api/app/signals/deployments/:id/execution-overview` | `apps/api/src/routes/signals.ts:54` |
| 58 | POST | `/api/app/signals/deployments` | `apps/api/src/routes/signals.ts:59` |
| 59 | POST | `/api/app/signals/deployments/:id/pause` | `apps/api/src/routes/signals.ts:89` |
| 60 | GET | `/api/app/signals/runs` | `apps/api/src/routes/signals.ts:96` |
| 61 | GET | `/api/app/signals/runs/:id` | `apps/api/src/routes/signals.ts:102` |
| 62 | PATCH | `/api/app/signals/executions/:id` | `apps/api/src/routes/signals.ts:107` |
| 63 | POST | `/api/app/signals/run` | `apps/api/src/routes/signals.ts:121` |
| 64 | GET | `/api/app/signals/jobs/:jobId` | `apps/api/src/routes/signals.ts:161` |
| 65 | GET | `/api/app/library` | `apps/api/src/routes/library.ts:13` |
| 66 | GET | `/api/app/library/strategies/:id` | `apps/api/src/routes/library.ts:181` |
| 67 | POST | `/api/app/library/strategies/:id/copy` | `apps/api/src/routes/library.ts:197` |
| 68 | POST | `/api/app/strategy/backtest` | `apps/api/src/routes/backtest.ts:39` |
| 69 | GET | `/api/app/strategy/backtest/running` | `apps/api/src/routes/backtest.ts:123` |
| 70 | GET | `/api/app/strategy/backtest/reports` | `apps/api/src/routes/backtest.ts:130` |
| 71 | GET | `/api/app/strategy/backtest/reports/:reportId` | `apps/api/src/routes/backtest.ts:152` |
| 72 | GET | `/api/app/strategy/backtest/:jobId` | `apps/api/src/routes/backtest.ts:186` |
| 73 | POST | `/api/app/strategy/scans/parameters` | `apps/api/src/routes/strategy-scans.ts:55` |
| 74 | POST | `/api/app/strategy/scans` | `apps/api/src/routes/strategy-scans.ts:70` |
| 75 | GET | `/api/app/strategy/scans` | `apps/api/src/routes/strategy-scans.ts:179` |
| 76 | GET | `/api/app/strategy/scans/running` | `apps/api/src/routes/strategy-scans.ts:188` |
| 77 | GET | `/api/app/strategy/scans/:reportId/job` | `apps/api/src/routes/strategy-scans.ts:202` |
| 78 | GET | `/api/app/strategy/scans/:reportId` | `apps/api/src/routes/strategy-scans.ts:217` |
| 79 | POST | `/api/app/strategy/agent` | `apps/api/src/routes/strategy.ts:82` |
| 80 | POST | `/api/app/strategy/name` | `apps/api/src/routes/strategy.ts:131` |
| 81 | POST | `/api/app/factor/agent` | `apps/api/src/routes/factor.ts:102` |
| 82 | POST | `/api/app/factor/qa` | `apps/api/src/routes/factor.ts:155` |
| 83 | POST | `/api/app/factor/metadata` | `apps/api/src/routes/factor.ts:176` |
| 84 | GET | `/api/app/factor/reports` | `apps/api/src/routes/factor.ts:213` |
| 85 | GET | `/api/app/factor/reports/:reportId` | `apps/api/src/routes/factor.ts:245` |
| 86 | GET | `/api/app/factor/analysis/job/:jobId` | `apps/api/src/routes/factor.ts:274` |
| 87 | GET | `/api/app/factor/research/window` | `apps/api/src/routes/factor.ts:297` |
| 88 | GET | `/api/app/factor/research/summary` | `apps/api/src/routes/factor.ts:305` |
| 89 | POST | `/api/app/factor/analysis/run` | `apps/api/src/routes/factor.ts:325` |
| 90 | POST | `/api/app/factor/reports/:reportId/holdout` | `apps/api/src/routes/factor.ts:449` |
| 91 | POST | `/api/app/factor/reports/:reportId/reveal` | `apps/api/src/routes/factor.ts:607` |
| 92 | GET | `/api/app/factor/correlation` | `apps/api/src/routes/factor.ts:1056` |
| 93 | GET | `/api/app/factor/correlation/running` | `apps/api/src/routes/factor.ts:1072` |
| 94 | POST | `/api/app/factor/correlation/run` | `apps/api/src/routes/factor.ts:1086` |
| 95 | GET | `/api/app/research/data-catalog` | `apps/api/src/routes/research.ts:103` |
| 96 | GET | `/api/app/research/artifacts/:artifactId` | `apps/api/src/routes/research.ts:116` |
| 97 | GET | `/api/app/research/documents` | `apps/api/src/routes/research.ts:222` |
| 98 | POST | `/api/app/research/language` | `apps/api/src/routes/research.ts:226` |
| 99 | POST | `/api/app/research/documents` | `apps/api/src/routes/research.ts:238` |
| 100 | POST | `/api/app/research/documents/from-backtest-report/:reportId` | `apps/api/src/routes/research.ts:242` |
| 101 | GET | `/api/app/research/documents/:documentId` | `apps/api/src/routes/research.ts:250` |
| 102 | POST | `/api/app/research/documents/:documentId/archive` | `apps/api/src/routes/research.ts:255` |
| 103 | POST | `/api/app/research/documents/:documentId/restore` | `apps/api/src/routes/research.ts:276` |
| 104 | GET | `/api/app/research/documents/:documentId/executions` | `apps/api/src/routes/research.ts:283` |
| 105 | GET | `/api/app/research/executions/:executionId` | `apps/api/src/routes/research.ts:288` |
| 106 | POST | `/api/app/research/executions/:executionId/promote` | `apps/api/src/routes/research.ts:295` |
| 107 | POST | `/api/app/research/executions/:executionId/factor-draft` | `apps/api/src/routes/research.ts:317` |
| 108 | POST | `/api/app/research/executions/:executionId/strategy-draft` | `apps/api/src/routes/research.ts:336` |
| 109 | POST | `/api/app/research/documents/:documentId/cells` | `apps/api/src/routes/research.ts:355` |
| 110 | PATCH | `/api/app/research/cells/:cellId` | `apps/api/src/routes/research.ts:368` |
| 111 | DELETE | `/api/app/research/cells/:cellId` | `apps/api/src/routes/research.ts:387` |
| 112 | POST | `/api/app/research/cell-change-proposals/:proposalId/apply` | `apps/api/src/routes/research.ts:399` |
| 113 | POST | `/api/app/research/cell-change-proposals/:proposalId/apply-for-review` | `apps/api/src/routes/research.ts:413` |
| 114 | POST | `/api/app/research/cell-change-proposals/:proposalId/accept-review` | `apps/api/src/routes/research.ts:430` |
| 115 | POST | `/api/app/research/cell-change-proposals/:proposalId/revert-review` | `apps/api/src/routes/research.ts:452` |
| 116 | POST | `/api/app/research/cell-change-proposals/:proposalId/reject` | `apps/api/src/routes/research.ts:474` |
| 117 | POST | `/api/app/research/cell-change-proposals/:proposalId/run-affected` | `apps/api/src/routes/research.ts:481` |
| 118 | POST | `/api/app/research/cells/:cellId/run` | `apps/api/src/routes/research.ts:520` |
| 119 | POST | `/api/app/research/cells/:cellId/run-affected` | `apps/api/src/routes/research.ts:540` |
| 120 | POST | `/api/app/research/documents/:documentId/analyze` | `apps/api/src/routes/research.ts:572` |
| 121 | POST | `/api/app/research/documents/:documentId/run` | `apps/api/src/routes/research.ts:577` |
| 122 | POST | `/api/app/research/documents/:documentId/interrupt` | `apps/api/src/routes/research.ts:601` |
| 123 | POST | `/api/app/research/documents/:documentId/reset` | `apps/api/src/routes/research.ts:606` |
| 124 | POST | `/api/app/research/curator/runs` | `apps/api/src/routes/research.ts:618` |
| 125 | GET | `/api/app/research/curator/runs/latest` | `apps/api/src/routes/research.ts:663` |
| 126 | GET | `/api/app/research/curator/runs/:runId` | `apps/api/src/routes/research.ts:667` |
| 127 | PATCH | `/api/app/research/curator/findings/:findingId` | `apps/api/src/routes/research.ts:672` |
| 128 | GET | `/api/app/research/conversations` | `apps/api/src/routes/research.ts:688` |
| 129 | POST | `/api/app/research/agent` | `apps/api/src/routes/research.ts:765` |
| 130 | PATCH | `/api/app/research/conversations/:id` | `apps/api/src/routes/research.ts:992` |
| 131 | DELETE | `/api/app/research/conversations/:id` | `apps/api/src/routes/research.ts:1007` |
| 132 | POST | `/api/app/research/universe/run` | `apps/api/src/routes/research.ts:1020` |

## 7. CLI、脚本与独立服务文件

API package scripts 中的命令名和参数保持；下表逐文件登记 `apps/api/scripts` 的脚本、fixture 与运行配置。没有 package 命令的文件仍可能被其他脚本调用，不能按“未在 package.json 注册”删除。Commit 表示相关依赖迁移时同步引用；脚本路径默认保留。历史 screen 迁移实现从 src 搬入 scripts 的例外见第 8 节。

| 文件 | package 命令 | 直接依赖的原 src 模块 | 处理 |
| --- | --- | --- | --- |
| apps/api/scripts/audit-data.ts | audit:data | data-quality, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/audit-etf-registry.ts | audit:etf | data-quality, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/audit-selected-financials.ts | audit:financial-selected | fundamentals, lib, market | 保留；随相关模块同步引用 |
| apps/api/scripts/audit-valuation-samples.ts | audit:valuation-samples | fundamentals, lib, market | 保留；随相关模块同步引用 |
| apps/api/scripts/backtest.ts | backtest | engine, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/backup-db.mjs | backup | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/canonicalize-stock-codes.ts | canonicalize:stock-codes | lib, maintenance | 保留；随相关模块同步引用 |
| apps/api/scripts/code-backtest.ts | code:backtest | engine, lib, strategy | 保留；随相关模块同步引用 |
| apps/api/scripts/com.jixie.backup.plist | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/create-fcff-research-replays.ts | 间接/独立入口、测试或配置 | lib, research | 保留；随相关模块同步引用 |
| apps/api/scripts/factor-report.ts | factor:report | factor, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/cninfo-announcement-probe.test.ts | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/cninfo-announcement-probe.ts | 间接/独立入口、测试或配置 | fundamentals | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/fixtures/financial-source-versions.json | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/main-business-probe.test.ts | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/main-business-probe.ts | 间接/独立入口、测试或配置 | tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/source-probe.test.ts | 间接/独立入口、测试或配置 | tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/fundamentals/source-probe.ts | 间接/独立入口、测试或配置 | fundamentals, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/gen-invite.ts | gen:invite | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/gen-stats-doc.ts | gen:stats-doc | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/jixie-backup.service | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/jixie-backup.timer | 间接/独立入口、测试或配置 | 无直接 src import | 保留；随相关模块同步引用 |
| apps/api/scripts/migrate-agent-conversations.ts | migrate:agent-conversations | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/migrate-factor-identity.ts | migrate:factor-identity | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/migrate-factor-report-history.ts | migrate:factor-report-history | factor, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/migrate-factor-research-discipline.ts | migrate:factor-research | factor, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/migrate-screen-to-research.ts | migrate:screen-to-research | lib, research | 保留；随相关模块同步引用 |
| apps/api/scripts/peek.ts | peek | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/probe-asset-allocation.ts | probe:asset-allocation | config.ts, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/probe-fundamentals.ts | probe:fundamentals | config.ts, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/probe-main-business.ts | probe:main-business | config.ts, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/remove-research-validation-protocols.ts | migrate:remove-research-validation-protocols | lib | 保留；随相关模块同步引用 |
| apps/api/scripts/run-maintenance.ts | maintenance | config.ts, lib, maintenance, market, signals, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/run-signals.ts | signals:run | lib, signals | 保留；随相关模块同步引用 |
| apps/api/scripts/smoke.ts | smoke | config.ts, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-basic.ts | sync:basic | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-commodity-continuous-returns.ts | sync:commodity-continuous | commodity, config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-commodity-futures.ts | sync:commodity-futures | commodity, config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-commodity-holdings.ts | sync:commodity-holdings | commodity, config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-commodity-warehouse-receipts.ts | sync:commodity-warehouse-receipts | commodity, config.ts, lib, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-credit-curves.ts | sync:credit-curves | config.ts, lib, rates, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-cross-market-benchmarks.ts | sync:cross-market-benchmarks | config.ts, lib, market, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-etf.ts | sync:etf | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-external-market.ts | sync:external-market | config.ts, lib, rates, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-fina.ts | sync:fina | config.ts, fundamentals, lib, maintenance, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-futures.ts | sync:futures | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-index-basic.ts | sync:index-basic | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-index-daily.ts | sync:index-daily | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-index.ts | sync:index | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-limit.ts | sync:limit | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-macro.ts | sync:macro | config.ts, lib, macro, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-market-reference.ts | sync:market-reference | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-market-state.ts | sync:market-state | lib, market | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-moneyflow.ts | sync:moneyflow | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-rates.ts | sync:rates | config.ts, lib, rates, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-stock-history.ts | sync:stock-history | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-sw-industry.ts | sync:sw-industry | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync-toplist.ts | sync:toplist | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/sync.ts | sync | config.ts, lib, store, tushare | 保留；随相关模块同步引用 |
| apps/api/scripts/turtle.ts | turtle | engine, lib | 保留；随相关模块同步引用 |
| apps/api/scripts/zeng-backtest.ts | zeng:backtest | engine, lib, strategy | 保留；随相关模块同步引用 |
| apps/api/scripts/zeng-timing.ts | zeng:timing | lib, strategy | 保留；随相关模块同步引用 |

另外核对根级入口：`scripts/dev.mjs` 组织开发进程；`scripts/process-group.*` 验证开发清理；三个 SDK/runtime 生成脚本与 package scripts 保持契约路径；`deploy/component-impact.json` 和部署测试沿用 apps/api 前缀分类。实际引入跨包构建依赖变化时，按根指令同步修改部署映射与测试。

| 独立服务文件 | 处理 |
| --- | --- |
| apps/sandboxd/src/frame.ts | 保留路径与行为；相关测试按受影响提交运行 |
| apps/sandboxd/src/index.test.ts | 保留路径与行为；相关测试按受影响提交运行 |
| apps/sandboxd/src/index.ts | 保留路径与行为；相关测试按受影响提交运行 |
| apps/sandboxd/src/runtime.ts | 保留路径与行为；相关测试按受影响提交运行 |
| apps/sandboxd/python/jixie_factor_runtime.py | 保留 runner/stub/运行时清单路径与公开语义 |
| apps/sandboxd/python/jixie_factor_sdk.pyi | 保留 runner/stub/运行时清单路径与公开语义 |
| apps/sandboxd/python/jixie_research_runtime.py | 保留 runner/stub/运行时清单路径与公开语义 |
| apps/sandboxd/python/jixie_research_sdk.pyi | 保留 runner/stub/运行时清单路径与公开语义 |
| apps/sandboxd/python/jixie_runner.py | 保留 runner/stub/运行时清单路径与公开语义 |
| apps/sandboxd/python/requirements-research-runtime.txt | 保留 runner/stub/运行时清单路径与公开语义 |

## 8. 逐文件迁移映射

本节覆盖当前 `apps/api/src` 全部 455 个文件，每个源路径恰好出现一次。源/目标路径默认相对 `apps/api/src`；以 `apps/` 开头者为仓库相对路径。目标写为目录或多个位置时，表示已经确定职责归属、实施时按函数拆分；不提前承诺内部函数名或最终文件数量。

测试优先随其验证的职责走。跨职责测试可以保留完整行为用例或按职责拆分，不能为迎合路径修改断言。Commit 是主迁移提交；前置提取或其他提交的调用方更新见备注与开发计划。这里保留已确认的 Agent core/profiles/tools 方案，不额外改变 Profile 归属。

### 8.1 (root)

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `config.ts` | market/providers/tushare/config.ts | 11 | Tushare 专用配置归位 |
| `index.ts` | index.ts | 4 | 保留进程入口；拆出装配 |
| `server.ts` | server.ts + bootstrap.ts | 4 | 拆分 HTTP 构建与启动 |

### 8.2 agent

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `agent/core.test.ts` | agent/core.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/core.ts` | agent/core.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/persistence.test.ts` | agent/conversations/ + agent/turns/ | 10 | 对话与 turn 轨迹持久化拆分 |
| `agent/persistence.ts` | agent/conversations/ + agent/turns/ | 10 | 对话与 turn 轨迹持久化拆分 |
| `agent/profiles/factor.ts` | agent/profiles/factor.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/profiles/qa.ts` | agent/profiles/qa.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/profiles/research.test.ts` | agent/profiles/research.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/profiles/research.ts` | agent/profiles/research.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/profiles/strategy.test.ts` | agent/profiles/strategy.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/profiles/strategy.ts` | agent/profiles/strategy.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/analyze-data.ts` | agent/tools/analyze-data.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/analyze-sandbox.test.ts` | agent/tools/analyze-sandbox.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/analyze-sandbox.ts` | agent/tools/analyze-sandbox.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/data-coverage.ts` | agent/tools/data-coverage.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/index.ts` | agent/tools/index.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/load-research-playbook.test.ts` | agent/tools/load-research-playbook.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/load-research-playbook.ts` | agent/tools/load-research-playbook.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/propose-research-cell-changes.test.ts` | agent/tools/propose-research-cell-changes.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/propose-research-cell-changes.ts` | agent/tools/propose-research-cell-changes.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/read-only-sql.test.ts` | agent/tools/sql/read-only-sql.test.ts | 10 | 只读 SQL 与线程入口 |
| `agent/tools/read-only-sql.ts` | agent/tools/sql/read-only-sql.ts | 10 | 只读 SQL 与线程入口 |
| `agent/tools/render-chart.ts` | agent/tools/charts/render-chart.ts | 10 | Agent 图表规格与工具 |
| `agent/tools/render-computed-chart.test.ts` | agent/tools/charts/render-computed-chart.test.ts | 10 | Agent 图表规格与工具 |
| `agent/tools/render-computed-chart.ts` | agent/tools/charts/render-computed-chart.ts | 10 | Agent 图表规格与工具 |
| `agent/tools/request-research-clarification.test.ts` | agent/tools/request-research-clarification.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/request-research-clarification.ts` | agent/tools/request-research-clarification.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/run-factor-analysis.test.ts` | agent/tools/run-factor-analysis.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/run-factor-analysis.ts` | agent/tools/run-factor-analysis.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/run-quick-backtest.test.ts` | agent/tools/quick-backtest/run-quick-backtest.test.ts | 10 | 快速回测工具与 Worker 同职责组 |
| `agent/tools/run-quick-backtest.ts` | agent/tools/quick-backtest/run-quick-backtest.ts | 10 | 快速回测工具与 Worker 同职责组 |
| `agent/tools/run-time-series-factor-analysis.test.ts` | agent/tools/run-time-series-factor-analysis.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/run-time-series-factor-analysis.ts` | agent/tools/run-time-series-factor-analysis.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/run-universe.ts` | agent/tools/run-universe.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/search-instruments.ts` | agent/tools/search-instruments.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/search-research-catalog.test.ts` | agent/tools/search-research-catalog.test.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/search-research-catalog.ts` | agent/tools/search-research-catalog.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/tools/sql-worker.boot.mjs` | agent/tools/sql/sql-worker.boot.mjs | 10 | 只读 SQL 与线程入口 |
| `agent/tools/sql-worker.ts` | agent/tools/sql/sql-worker.ts | 10 | 只读 SQL 与线程入口 |
| `agent/tools/types.ts` | agent/tools/types.ts | 10 | 保留 core/profiles/业务工具归属，更新依赖 |
| `agent/turn-bus.test.ts` | agent/turns/turn-bus.test.ts | 10 | 后台 turn 与 SSE 总线 |
| `agent/turn-bus.ts` | agent/turns/turn-bus.ts | 10 | 后台 turn 与 SSE 总线 |
| `agent/turn-run.ts` | agent/turns/turn-run.ts | 10 | 后台 turn 与 SSE 总线 |

### 8.3 commodity

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `commodity/commodity-carry.test.ts` | market/commodity/commodity-carry.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-carry.ts` | market/commodity/commodity-carry.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-continuous-return-quality.test.ts` | market/commodity/commodity-continuous-return-quality.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-continuous-return-quality.ts` | market/commodity/commodity-continuous-return-quality.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-continuous-returns.test.ts` | market/commodity/commodity-continuous-returns.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-continuous-returns.ts` | market/commodity/commodity-continuous-returns.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-futures.test.ts` | market/commodity/commodity-futures.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-futures.ts` | market/commodity/commodity-futures.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-holding-positions.test.ts` | market/commodity/commodity-holding-positions.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-holding-positions.ts` | market/commodity/commodity-holding-positions.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-holding-quality.test.ts` | market/commodity/commodity-holding-quality.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-holding-quality.ts` | market/commodity/commodity-holding-quality.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-warehouse-receipt-maintenance.ts` | market/commodity/commodity-warehouse-receipt-maintenance.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-warehouse-receipt-quality.test.ts` | market/commodity/commodity-warehouse-receipt-quality.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-warehouse-receipt-quality.ts` | market/commodity/commodity-warehouse-receipt-quality.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-warehouse-receipts.test.ts` | market/commodity/commodity-warehouse-receipts.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `commodity/commodity-warehouse-receipts.ts` | market/commodity/commodity-warehouse-receipts.ts | 11 | 整体迁移；保持子领域内部语义 |

### 8.4 data-quality

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `data-quality/audit.test.ts` | market/quality/ + maintenance/data-audit.ts | 8 | 先分离模型就绪检查；剩余市场整理在 Commit 11 |
| `data-quality/audit.ts` | market/quality/ + maintenance/data-audit.ts | 8 | 先分离模型就绪检查；剩余市场整理在 Commit 11 |
| `data-quality/etf-registry-audit.ts` | market/quality/etf-registry-audit.ts | 11 | ETF 注册表基础审计 |

### 8.5 engine

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `engine/agent-backtest-worker.boot.mjs` | agent/tools/quick-backtest/agent-backtest-worker.boot.mjs | 10 | Agent 快速回测线程与开发入口 |
| `engine/agent-backtest-worker.ts` | agent/tools/quick-backtest/agent-backtest-worker.ts | 10 | Agent 快速回测线程与开发入口 |
| `engine/allocation-analysis.test.ts` | engine/simulation/allocation-analysis.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/allocation-analysis.ts` | engine/simulation/allocation-analysis.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/backtest-worker.boot.mjs` | strategy/backtest/backtest-worker.boot.mjs | 8 | 回测线程与开发入口 |
| `engine/backtest-worker.ts` | strategy/backtest/backtest-worker.ts | 8 | 回测线程与开发入口 |
| `engine/conditional-orders.test.ts` | engine/simulation/conditional-orders.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/configured-run.ts` | strategy/execution/run-configured.ts | 8 | 已保存策略执行编排 |
| `engine/custom-factor.ts` | engine/factors/custom-factor.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/data-port.ts` | engine/data/data-port.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/data.ts` | engine/data/data.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/etf-rules.test.ts` | engine/simulation/etf-rules.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/factor-semantics.test.ts` | engine/simulation/factor-semantics.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/fixture-port.ts` | engine/testing/fixture-port.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/futures-portfolio.ts` | engine/simulation/futures-portfolio.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/futures-rules.test.ts` | engine/simulation/futures-rules.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/historical-stock-status.test.ts` | engine/simulation/historical-stock-status.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/index-valuation.test.ts` | engine/simulation/index-valuation.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/portfolio.ts` | engine/simulation/portfolio.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/prepare-custom-factors.test.ts` | strategy/execution/prepare-factors.test.ts | 8 | 已发布因子准备；测试随迁移 |
| `engine/prepare-custom-factors.ts` | strategy/execution/prepare-factors.ts | 8 | 已发布因子准备；测试随迁移 |
| `engine/prisma-port.ts` | engine/adapters/prisma-port.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/python-factor-host.ts` | engine/adapters/python-factor-host.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/resample.test.ts` | engine/simulation/resample.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/rules.test.ts` | engine/simulation/rules.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/run.ts` | engine/simulation/run.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/signal-worker.boot.mjs` | signals/runs/signal-worker.boot.mjs | 9 | 每日信号子进程与开发入口 |
| `engine/signal-worker.ts` | signals/runs/signal-worker.ts | 9 | 每日信号子进程与开发入口 |
| `engine/slippage.test.ts` | engine/simulation/slippage.test.ts | 8 | 模拟核心/适配或对应行为测试归位 |
| `engine/strategies.ts` | strategy/examples/strategies.ts | 8 | 仓库策略示例 |
| `engine/strategy-scan-cell-worker.boot.mjs` | strategy/scans/strategy-scan-cell-worker.boot.mjs | 8 | 扫描线程、cell 子进程及开发入口 |
| `engine/strategy-scan-cell-worker.ts` | strategy/scans/strategy-scan-cell-worker.ts | 8 | 扫描线程、cell 子进程及开发入口 |
| `engine/strategy-scan-worker.boot.mjs` | strategy/scans/strategy-scan-worker.boot.mjs | 8 | 扫描线程、cell 子进程及开发入口 |
| `engine/strategy-scan-worker.ts` | strategy/scans/strategy-scan-worker.ts | 8 | 扫描线程、cell 子进程及开发入口 |
| `engine/types.ts` | engine/types.ts | 8 | 保留引擎类型入口 |
| `engine/wall-entry.ts` | strategy/runtime/typescript/wall-entry.ts | 8 | 策略 isolate 宿主/入口与一致性测试 |
| `engine/walled-run.test-worker.mjs` | strategy/runtime/typescript/walled-run.test-worker.mjs | 8 | 策略 isolate 宿主/入口与一致性测试 |
| `engine/walled-run.test.ts` | strategy/runtime/typescript/walled-run.test.ts | 8 | 策略 isolate 宿主/入口与一致性测试 |
| `engine/walled-run.ts` | strategy/runtime/typescript/walled-run.ts | 8 | 策略 isolate 宿主/入口与一致性测试 |

### 8.6 factor

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `factor/analysis-job.test.ts` | factor/analysis/analysis-job.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/analysis-job.ts` | factor/analysis/analysis-job.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/analysis-policy.test.ts` | factor/analysis/analysis-policy.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/analysis.ts` | factor/analysis/analysis.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/asset-factor-data-cutoff.test.ts` | factor/observations/asset-factor-data-cutoff.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/asset-factor-data-cutoff.ts` | factor/observations/asset-factor-data-cutoff.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/builtin-factors.test.ts` | factor/definitions/builtin-factors.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/builtin-factors.ts` | factor/definitions/builtin-factors.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-carry-panel-observations.test.ts` | factor/observations/commodity-carry-panel-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-carry-panel-observations.ts` | factor/observations/commodity-carry-panel-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-carry-time-series-observations.test.ts` | factor/observations/commodity-carry-time-series-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-carry-time-series-observations.ts` | factor/observations/commodity-carry-time-series-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-warehouse-receipt-time-series-observations.test.ts` | factor/observations/commodity-warehouse-receipt-time-series-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/commodity-warehouse-receipt-time-series-observations.ts` | factor/observations/commodity-warehouse-receipt-time-series-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/compile-factor.test.ts` | factor/runtime/compile-factor.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/compile-factor.ts` | factor/runtime/compile-factor.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/compile-time-series-factor.test.ts` | factor/runtime/compile-time-series-factor.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/compile-time-series-factor.ts` | factor/runtime/compile-time-series-factor.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/composite.test.ts` | factor/composition/composite.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/composite.ts` | factor/composition/composite.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/correlation-job.ts` | factor/analysis/correlation-job.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/correlation-worker.boot.mjs` | factor/analysis/correlation-worker.boot.mjs | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/correlation-worker.ts` | factor/analysis/correlation-worker.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/correlation.ts` | factor/analysis/correlation.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/cross-sectional-inference.test.ts` | factor/analysis/cross-sectional-inference.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/cross-sectional-inference.ts` | factor/analysis/cross-sectional-inference.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/etf-trend-observations.test.ts` | factor/observations/etf-trend-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/etf-trend-observations.ts` | factor/observations/etf-trend-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/evaluation-scope.test.ts` | factor/analysis/evaluation-scope.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/evaluation-scope.ts` | factor/analysis/evaluation-scope.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/evaluator.test.ts` | factor/analysis/evaluator.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/evaluator.ts` | factor/analysis/evaluator.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/factor-codegen-prompt.ts` | factor/runtime/factor-codegen-prompt.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/factor-sdk.ts` | factor/runtime/factor-sdk.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/factor-v2-fields.ts` | factor/definitions/factor-v2-fields.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/factor-worker.boot.mjs` | factor/analysis/factor-worker.boot.mjs | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/factor-worker.ts` | factor/analysis/factor-worker.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-data-cutoff.test.ts` | factor/observations/macro-regime-data-cutoff.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-data-cutoff.ts` | factor/observations/macro-regime-data-cutoff.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-evaluator.test.ts` | factor/analysis/macro-regime-evaluator.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-evaluator.ts` | factor/analysis/macro-regime-evaluator.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-observations.test.ts` | factor/observations/macro-regime-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-observations.ts` | factor/observations/macro-regime-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-templates.test.ts` | factor/definitions/templates/macro-regime-templates.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/macro-regime-templates.ts` | factor/definitions/templates/macro-regime-templates.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/metadata.test.ts` | factor/definitions/metadata.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/metadata.ts` | factor/definitions/metadata.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-composite-publication.test.ts` | factor/publication/panel-composite-publication.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-composite-publication.ts` | factor/publication/panel-composite-publication.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-composite-source.ts` | factor/composition/panel-composite-source.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-evaluator.test.ts` | factor/analysis/panel-evaluator.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-evaluator.ts` | factor/analysis/panel-evaluator.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-observations.test.ts` | factor/observations/panel-observations.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-observations.ts` | factor/observations/panel-observations.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-templates.test.ts` | factor/definitions/templates/panel-templates.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/panel-templates.ts` | factor/definitions/templates/panel-templates.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/publication.test.ts` | factor/publication/publication.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/publication.ts` | factor/publication/publication.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-asset-factor-runtime.test.ts` | factor/runtime/python-asset-factor-runtime.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-asset-factor-runtime.ts` | factor/runtime/python-asset-factor-runtime.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-cross-sectional-runtime.test.ts` | factor/runtime/python-cross-sectional-runtime.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-cross-sectional-runtime.ts` | factor/runtime/python-cross-sectional-runtime.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-factor-validator.test.ts` | factor/runtime/python-factor-validator.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/python-factor-validator.ts` | factor/runtime/python-factor-validator.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/report-spec.test.ts` | factor/reports/report-spec.test.ts | 7 | 报告与 holdout 纪律 |
| `factor/report-spec.ts` | factor/reports/report-spec.ts | 7 | 报告与 holdout 纪律 |
| `factor/research.test.ts` | factor/reports/research-policy.test.ts | 7 | 报告与 holdout 纪律 |
| `factor/research.ts` | factor/reports/research-policy.ts | 7 | 报告与 holdout 纪律 |
| `factor/time-series-evaluator.test.ts` | factor/analysis/time-series-evaluator.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/time-series-evaluator.ts` | factor/analysis/time-series-evaluator.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/time-series-templates.test.ts` | factor/definitions/templates/time-series-templates.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/time-series-templates.ts` | factor/definitions/templates/time-series-templates.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/validate-factor-definition.test.ts` | factor/definitions/validate-factor-definition.test.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/validate-factor-definition.ts` | factor/definitions/validate-factor-definition.ts | 7 | 随领域职责归位；任务完成/恢复先在 Commit 4 提取 |
| `factor/weather.test.ts` | factor/weather/ | 7 | 按计算、查询及刷新状态拆分，保留行为测试 |
| `factor/weather.ts` | factor/weather/ | 7 | 按计算、查询及刷新状态拆分，保留行为测试 |

### 8.7 fundamentals

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `fundamentals/accounting-quality.ts` | market/fundamentals/accounting-quality.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/metrics.test.ts` | market/fundamentals/metrics.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/metrics.ts` | market/fundamentals/metrics.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/normalize.test.ts` | market/fundamentals/normalize.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/normalize.ts` | market/fundamentals/normalize.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/resolver.test.ts` | market/fundamentals/resolver.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/resolver.ts` | market/fundamentals/resolver.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/source-contract.test.ts` | market/fundamentals/source-contract.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/source-contract.ts` | market/fundamentals/source-contract.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/sync.test.ts` | market/fundamentals/sync.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/sync.ts` | market/fundamentals/sync.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/valuation-sample-audit.test.ts` | market/fundamentals/valuation-sample-audit.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `fundamentals/valuation-sample-audit.ts` | market/fundamentals/valuation-sample-audit.ts | 11 | 整体迁移；保持子领域内部语义 |

### 8.8 i18n

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `i18n/index.ts` | i18n/index.ts + infra/http/locale.ts | 2 | 分离纯翻译与 Hono 辅助导出 |
| `i18n/locale.ts` | infra/http/locale.ts | 2 | 请求语言解析归 HTTP |
| `i18n/messages.ts` | i18n/messages.ts | 2 | 保留纯消息目录 |

### 8.9 lib

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `lib/chart-spec.ts` | agent/tools/charts/spec.ts | 10 | 按实际职责归位 |
| `lib/chat-schema.ts` | agent/conversations/schema.ts | 10 | 按实际职责归位 |
| `lib/date.ts` | date.ts | 2 | 按实际职责归位 |
| `lib/email.ts` | infra/email/email.ts | 2 | 按实际职责归位 |
| `lib/httpError.ts` | infra/http/errors.ts | 2 | 按实际职责归位 |
| `lib/indicators.test.ts` | math/indicators.test.ts | 2 | 纯计算或生成说明归位 |
| `lib/indicators.ts` | math/indicators.ts | 2 | 纯计算或生成说明归位 |
| `lib/inference.test.ts` | math/inference.test.ts | 2 | 纯计算或生成说明归位 |
| `lib/inference.ts` | math/inference.ts | 2 | 纯计算或生成说明归位 |
| `lib/inviteCode.ts` | auth/invite-code.ts | 2 | 按实际职责归位 |
| `lib/isolate-run.ts` | infra/runtime/typescript/isolate-run.ts | 3 | 按实际职责归位 |
| `lib/job-queue.test.ts` | infra/jobs/queue.ts + bootstrap.ts | 4 | 队列调度与任务连接分开；测试随职责拆分 |
| `lib/job-queue.ts` | infra/jobs/queue.ts + bootstrap.ts | 4 | 队列调度与任务连接分开；测试随职责拆分 |
| `lib/jobs-backtest-report.test.ts` | infra/jobs/ + 各领域 complete/recovery 操作 | 4 | 通用记录/日志与跨实体事务拆分 |
| `lib/jobs.test.ts` | infra/jobs/ + 各领域 complete/recovery 操作 | 4 | 通用记录/日志与跨实体事务拆分 |
| `lib/jobs.ts` | infra/jobs/ + 各领域 complete/recovery 操作 | 4 | 通用记录/日志与跨实体事务拆分 |
| `lib/prisma.ts` | infra/database/prisma.ts | 2 | 按实际职责归位 |
| `lib/sandbox-console.test.ts` | infra/runtime/console.test.ts | 3 | 按实际职责归位 |
| `lib/sandbox-console.ts` | infra/runtime/console.ts | 3 | 按实际职责归位 |
| `lib/session.ts` | auth/session.ts + auth/http/ | 2 | 按实际职责归位 |
| `lib/stats-doc-gen.ts` | math/stats-doc-gen.ts | 2 | 纯计算或生成说明归位 |
| `lib/stats-doc.test.ts` | math/stats-doc.test.ts | 2 | 纯计算或生成说明归位 |
| `lib/stats-doc.ts` | math/stats-doc.ts | 2 | 纯计算或生成说明归位 |
| `lib/stats.test.ts` | math/stats.test.ts | 2 | 纯计算或生成说明归位 |
| `lib/stats.ts` | math/stats.ts | 2 | 纯计算或生成说明归位 |

### 8.10 llm

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `llm/agent-llm.ts` | infra/llm/agent-llm.ts | 2 | 供应商通信适配 |
| `llm/deepseek.ts` | infra/llm/deepseek.ts | 2 | 供应商通信适配 |

### 8.11 macro

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `macro/as-of.test.ts` | market/macro/as-of.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/as-of.ts` | market/macro/as-of.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/china-macro.test.ts` | market/macro/china-macro.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/china-macro.ts` | market/macro/china-macro.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/regime-score.test.ts` | market/macro/regime-score.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/regime-score.ts` | market/macro/regime-score.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/us-headline-cpi.test.ts` | market/macro/us-headline-cpi.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `macro/us-headline-cpi.ts` | market/macro/us-headline-cpi.ts | 11 | 整体迁移；保持子领域内部语义 |

### 8.12 maintenance

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `maintenance/canonicalize-stock-codes.ts` | maintenance/canonicalize-stock-codes.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/daily-schedule.test.ts` | maintenance/daily-schedule.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/daily-schedule.ts` | maintenance/daily-schedule.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/daily.ts` | maintenance/daily.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/http.ts` | maintenance/http.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/quality.ts` | maintenance/quality.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/reference-periods.test.ts` | maintenance/reference-periods.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/reference-periods.ts` | maintenance/reference-periods.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/reference-worker-process.test.ts` | maintenance/reference-worker-process.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/reference-worker-process.ts` | maintenance/reference-worker-process.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/reference-worker.ts` | maintenance/reference-worker.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/repair.ts` | maintenance/repair.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/self-heal.test.ts` | maintenance/self-heal.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/self-heal.ts` | maintenance/self-heal.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/state.test.ts` | maintenance/state.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/state.ts` | maintenance/state.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/weekly.test.ts` | maintenance/weekly.test.ts | 11 | 保留；同步上游路径，接入整体审计 |
| `maintenance/weekly.ts` | maintenance/weekly.ts | 11 | 保留；同步上游路径，接入整体审计 |

### 8.13 market

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `market/cross-market-benchmarks.test.ts` | market/sync/ + market/queries/ | 11 | 拆分基准同步和读取；测试覆盖两者 |
| `market/cross-market-benchmarks.ts` | market/sync/ + market/queries/ | 11 | 拆分基准同步和读取；测试覆盖两者 |
| `market/index-valuation.test.ts` | market/valuation/compute.test.ts | 11 | 迁移；按已有职责提取 |
| `market/index-valuation.ts` | market/valuation/compute.ts | 11 | 迁移；按已有职责提取 |
| `market/instrument-resolver.ts` | market/instruments/instrument-resolver.ts | 11 | 迁移；按已有职责提取 |
| `market/instrument-series.ts` | market/queries/instrument-series.ts | 11 | 迁移；按已有职责提取 |
| `market/market-state.test.ts` | market/state/compute.test.ts | 11 | 迁移；按已有职责提取 |
| `market/market-state.ts` | market/state/compute.ts | 11 | 迁移；按已有职责提取 |
| `market/stock-identity.test.ts` | market/instruments/stock-identity.test.ts | 11 | 迁移；按已有职责提取 |
| `market/stock-identity.ts` | market/instruments/stock-identity.ts | 11 | 迁移；按已有职责提取 |
| `market/sync-market-indicators.ts` | market/sync/market-indicators.ts | 11 | 迁移；按已有职责提取 |

### 8.14 rates

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `rates/china-treasury-curve.test.ts` | market/rates/china-treasury-curve.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/china-treasury-curve.ts` | market/rates/china-treasury-curve.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/chinabond-credit-curves.test.ts` | market/rates/chinabond-credit-curves.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/chinabond-credit-curves.ts` | market/rates/chinabond-credit-curves.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/external-market-drivers.test.ts` | market/rates/external-market-drivers.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/external-market-drivers.ts` | market/rates/external-market-drivers.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/signal-readiness.test.ts` | market/rates/signal-readiness.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `rates/signal-readiness.ts` | market/rates/signal-readiness.ts | 11 | 整体迁移；保持子领域内部语义 |

### 8.15 research

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `research/agent-context.test.ts` | research/agent-context.test.ts | 6 | 保留研究上下文入口 |
| `research/agent-context.ts` | research/agent-context.ts | 6 | 保留研究上下文入口 |
| `research/backtest-report-document.test.ts` | research/documents/from-backtest-report.test.ts | 6 | 报告转换为研究文档 |
| `research/backtest-report-document.ts` | research/documents/from-backtest-report.ts | 6 | 报告转换为研究文档 |
| `research/backtest-report-result.test.ts` | research/datasets/results/backtest-report-result.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/backtest-report-result.ts` | research/datasets/results/backtest-report-result.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/catalog.test.ts` | research/catalog/catalog.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/catalog.ts` | research/catalog/catalog.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/commodity-dataset.test.ts` | research/datasets/commodity-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/commodity-dataset.ts` | research/datasets/commodity-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concept-binding-resolver.test.ts` | research/catalog/concept-binding-resolver.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concept-binding-resolver.ts` | research/catalog/concept-binding-resolver.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concept-bindings.test.ts` | research/catalog/concept-bindings.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concept-bindings.ts` | research/catalog/concept-bindings.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concepts.test.ts` | research/catalog/concepts.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/concepts.ts` | research/catalog/concepts.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/cross-market-data-contracts.test.ts` | research/datasets/cross-market-data-contracts.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/cross-market-data-contracts.ts` | research/datasets/cross-market-data-contracts.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/curator-job.ts` | research/curator/curator-job.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/curator-reference-search.test.ts` | research/curator/curator-reference-search.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/curator-reference-search.ts` | research/curator/curator-reference-search.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/curator.test.ts` | research/curator/curator.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/curator.ts` | research/curator/curator.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/data-catalog.test.ts` | research/catalog/data-catalog.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/data-catalog.ts` | research/catalog/data-catalog.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-dataset.test.ts` | research/datasets/equity-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-dataset.ts` | research/datasets/equity-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-classification-evidence.ts` | research/templates/fcff/equity-fcff-classification-evidence.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-classification-template.ts` | research/templates/fcff/equity-fcff-classification-template.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-evidence-template.test.ts` | research/templates/fcff/equity-fcff-evidence-template.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-evidence-template.ts` | research/templates/fcff/equity-fcff-evidence-template.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-replay-cases.test.ts` | research/templates/fcff/equity-fcff-replay-cases.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-replay-cases.ts` | research/templates/fcff/equity-fcff-replay-cases.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-valuation-template.test.ts` | research/templates/fcff/equity-fcff-valuation-template.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/equity-fcff-valuation-template.ts` | research/templates/fcff/equity-fcff-valuation-template.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/factor-report-result.test.ts` | research/datasets/results/factor-report-result.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/factor-report-result.ts` | research/datasets/results/factor-report-result.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/financial-dataset.test.ts` | research/datasets/financial-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/financial-dataset.ts` | research/datasets/financial-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/financial-values.test.ts` | research/datasets/financial-values.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/financial-values.ts` | research/datasets/financial-values.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/fingerprints.test.ts` | research/evidence/fingerprints.test.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/fingerprints.ts` | research/evidence/fingerprints.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/market-reference-dataset.test.ts` | research/datasets/market-reference-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/market-reference-dataset.ts` | research/datasets/market-reference-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/playbooks.ts` | research/catalog/playbooks.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/pyright-language-service.test.ts` | research/language/pyright-language-service.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/pyright-language-service.ts` | research/language/pyright-language-service.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-cell-change-attempt-records.ts` | research/proposals/research-cell-change-attempt-records.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/research-cell-change-records.ts` | research/proposals/research-cell-change-records.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/research-clarification-records.ts` | research/proposals/research-clarification-records.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/research-execution-records.test.ts` | research/evidence/research-execution-records.test.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/research-execution-records.ts` | research/evidence/research-execution-records.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/research-factor-drafts.test.ts` | research/handoff/research-factor-drafts.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-factor-drafts.ts` | research/handoff/research-factor-drafts.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-factor-handoff.test.ts` | research/handoff/research-factor-handoff.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-factor-handoff.ts` | research/handoff/research-factor-handoff.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-handoff-context.ts` | research/handoff/research-handoff-context.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-language-document.test.ts` | research/language/research-language-document.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-language-document.ts` | research/language/research-language-document.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-language-stubs.ts` | research/language/research-language-stubs.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-series-proposal-validation.test.ts` | research/proposals/series-validation.test.ts | 6 | 数据调用提案校验 |
| `research/research-series-proposal-validation.ts` | research/proposals/series-validation.ts | 6 | 数据调用提案校验 |
| `research/research-strategy-drafts.test.ts` | research/handoff/research-strategy-drafts.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-strategy-drafts.ts` | research/handoff/research-strategy-drafts.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-strategy-handoff.test.ts` | research/handoff/research-strategy-handoff.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/research-strategy-handoff.ts` | research/handoff/research-strategy-handoff.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/result-dataset.test.ts` | research/datasets/results/result-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/result-dataset.ts` | research/datasets/results/result-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/screen-data-migration.test.ts` | apps/api/scripts/migrations/screen-to-research.test.ts | 6 | 历史迁移实现与测试；CLI 对外行为不变 |
| `research/screen-data-migration.ts` | apps/api/scripts/migrations/screen-to-research.ts | 6 | 历史迁移实现与测试；CLI 对外行为不变 |
| `research/series.ts` | research/datasets/series.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/source-decisions.test.ts` | research/catalog/source-decisions.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/source-decisions.ts` | research/catalog/source-decisions.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/spec.ts` | research/datasets/spec.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/supplemental-dataset.test.ts` | research/datasets/supplemental-dataset.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/supplemental-dataset.ts` | research/datasets/supplemental-dataset.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/universe.test.ts` | research/datasets/universe.test.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/universe.ts` | research/datasets/universe.ts | 6 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-artifacts.test.ts` | research/evidence/workbench-artifacts.test.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-artifacts.ts` | research/evidence/workbench-artifacts.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-backtest-report-runtime.test.ts` | research/sdk/workbench-backtest-report-runtime.test.ts | 6 | 报告 SDK 运行契约测试 |
| `research/workbench-cell-change-attempts.test.ts` | research/proposals/workbench-cell-change-attempts.test.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-cell-change-attempts.ts` | research/proposals/workbench-cell-change-attempts.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-cell-changes.ts` | research/proposals/workbench-cell-changes.ts | 5 | 按职责迁移，相关测试与引用同步 |
| `research/workbench-document-management.test.ts` | research/documents/workbench-document-management.test.ts | 5 | 文档管理回归测试 |
| `research/workbench-factor-report-runtime.test.ts` | research/sdk/workbench-factor-report-runtime.test.ts | 6 | 报告 SDK 运行契约测试 |
| `research/workbench-runtime.test.ts` | research/execution/python-session.ts + research/sdk/dispatch.ts | 5 | 拆分会话与 SDK 请求分派；Commit 6 完成 SDK/数据整理 |
| `research/workbench-runtime.ts` | research/execution/python-session.ts + research/sdk/dispatch.ts | 5 | 拆分会话与 SDK 请求分派；Commit 6 完成 SDK/数据整理 |
| `research/workbench-sdk.test.ts` | research/sdk/validation.test.ts | 6 | 公开 SDK 请求校验 |
| `research/workbench-sdk.ts` | research/sdk/validation.ts | 6 | 公开 SDK 请求校验 |
| `research/workbench.test.ts` | research/documents/ + research/dependencies/ + research/execution/ | 5 | 按完整操作和生命周期拆分 |
| `research/workbench.ts` | research/documents/ + research/dependencies/ + research/execution/ | 5 | 按完整操作和生命周期拆分 |

### 8.16 risk

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `risk/alpha-risk-overlap.test.ts` | strategy/analysis/risk/alpha-risk-overlap.test.ts | 8 | 随回测风险报告归位 |
| `risk/alpha-risk-overlap.ts` | strategy/analysis/risk/alpha-risk-overlap.ts | 8 | 随回测风险报告归位 |
| `risk/backtest-risk-analysis.test.ts` | strategy/analysis/risk/backtest-risk-analysis.test.ts | 8 | 随回测风险报告归位 |
| `risk/backtest-risk-analysis.ts` | strategy/analysis/risk/backtest-risk-analysis.ts | 8 | 随回测风险报告归位 |
| `risk/macro-risk-axes.test.ts` | market/macro/macro-risk-axes.test.ts | 8 | 宏观轴数据口径 |
| `risk/macro-risk-axes.ts` | market/macro/macro-risk-axes.ts | 8 | 宏观轴数据口径 |
| `risk/macro-risk-model.test.ts` | strategy/analysis/risk/macro-risk-model.test.ts | 8 | 随回测风险报告归位 |
| `risk/macro-risk-model.ts` | strategy/analysis/risk/macro-risk-model.ts | 8 | 随回测风险报告归位 |
| `risk/macro-risk-quality.test.ts` | market/macro/risk-axis-quality.ts + strategy/analysis/risk/data-readiness.ts | 8 | 拆分基础质量与模型门槛；测试随责任拆分 |
| `risk/macro-risk-quality.ts` | market/macro/risk-axis-quality.ts + strategy/analysis/risk/data-readiness.ts | 8 | 拆分基础质量与模型门槛；测试随责任拆分 |
| `risk/market-risk-drivers.test.ts` | market/state/market-risk-drivers.test.ts | 8 | 市场驱动序列 |
| `risk/market-risk-drivers.ts` | market/state/market-risk-drivers.ts | 8 | 市场驱动序列 |
| `risk/market-risk-model.test.ts` | strategy/analysis/risk/market-risk-model.test.ts | 8 | 随回测风险报告归位 |
| `risk/market-risk-model.ts` | strategy/analysis/risk/market-risk-model.ts | 8 | 随回测风险报告归位 |
| `risk/market-risk-quality.test.ts` | market/quality/market-risk-drivers.ts + strategy/analysis/risk/data-readiness.ts | 8 | 拆分基础质量与模型门槛；测试随责任拆分 |
| `risk/market-risk-quality.ts` | market/quality/market-risk-drivers.ts + strategy/analysis/risk/data-readiness.ts | 8 | 拆分基础质量与模型门槛；测试随责任拆分 |
| `risk/risk-research-contract.test.ts` | strategy/analysis/risk/risk-research-contract.test.ts | 8 | 随回测风险报告归位 |
| `risk/risk-scenarios.test.ts` | strategy/analysis/risk/risk-scenarios.test.ts | 8 | 随回测风险报告归位 |
| `risk/risk-scenarios.ts` | strategy/analysis/risk/risk-scenarios.ts | 8 | 随回测风险报告归位 |

### 8.17 routes

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `routes/agent.ts` | agent/http/agent.ts | 10 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/auth.ts` | auth/http/auth.ts | 2 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/backtest-report-route.test.ts` | strategy/http/backtest-report-route.test.ts | 8 | 回测 HTTP 回归测试 |
| `routes/backtest.ts` | strategy/http/backtest.ts | 8 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/factor-weather.ts` | factor/http/factor-weather.ts | 7 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/factor.ts` | factor/http/factor.ts | 7 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/factors.ts` | factor/http/factors.ts | 7 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/library.ts` | library/http/library.ts | 10 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/market.ts` | market/http/market.ts | 11 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/multi-user-permissions.test.ts` | auth/http/multi-user-permissions.test.ts | 2 | 保留跨模块权限回归测试；随其他路由逐次更新引用 |
| `routes/research.ts` | research/http/research.ts | 6 | HTTP 适配归领域；完整操作提取到所属业务，按 HTTP 子职责拆分 |
| `routes/signals.ts` | signals/http/signals.ts | 9 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/strategies.ts` | strategy/http/strategies.ts | 8 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/strategy-scans.ts` | strategy/http/strategy-scans.ts | 8 | HTTP 适配归领域；完整操作提取到所属业务 |
| `routes/strategy.ts` | strategy/http/strategy.ts | 8 | HTTP 适配归领域；完整操作提取到所属业务 |

### 8.18 services

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `services/strategy-service.test.ts` | strategy/definitions/ | 8 | 按保存/命名等业务操作拆分；测试随操作 |
| `services/strategy-service.ts` | strategy/definitions/ | 8 | 按保存/命名等业务操作拆分；测试随操作 |

### 8.19 signals

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `signals/accounting.integration.test.ts` | signals/accounting/accounting.integration.test.ts | 9 | 按业务职责迁移 |
| `signals/accounting.test.ts` | signals/accounting/accounting.test.ts | 9 | 按业务职责迁移 |
| `signals/accounting.ts` | signals/accounting/accounting.ts | 9 | 按业务职责迁移 |
| `signals/factor-dependency-lineage.test.ts` | signals/factor-inputs/factor-dependency-lineage.test.ts | 9 | 按业务职责迁移 |
| `signals/factor-dependency-lineage.ts` | signals/factor-inputs/factor-dependency-lineage.ts | 9 | 按业务职责迁移 |
| `signals/factor-inputs.test.ts` | signals/factor-inputs/factor-inputs.test.ts | 9 | 按业务职责迁移 |
| `signals/factor-inputs.ts` | signals/factor-inputs/factor-inputs.ts | 9 | 按业务职责迁移 |
| `signals/notifier.test.ts` | signals/notifier.test.ts | 9 | 保留调度/同步/通知具体入口，更新依赖 |
| `signals/notifier.ts` | signals/notifier.ts | 9 | 保留调度/同步/通知具体入口，更新依赖 |
| `signals/scheduler.ts` | signals/scheduler.ts | 9 | 保留调度/同步/通知具体入口，更新依赖 |
| `signals/service.ts` | signals/deployments/ + signals/runs/ | 9 | 拆分部署/运行操作与子进程管理 |
| `signals/sync.ts` | signals/sync.ts | 9 | 保留调度/同步/通知具体入口，更新依赖 |

### 8.20 store

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `store/etf-market-sync.test.ts` | market/sync/etf.test.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/etf-market-sync.ts` | market/sync/etf.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/etf-presets.ts` | market/registry/etf-presets.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/etf-research-registry.test.ts` | market/registry/etf-research-registry.test.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/etf-research-registry.ts` | market/registry/etf-research-registry.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/index-presets.test.ts` | market/registry/index-presets.test.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/index-presets.ts` | market/registry/index-presets.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/sync-reference.test.ts` | market/sync/sync-reference.test.ts | 11 | 迁移；静态注册表与写库操作分开 |
| `store/sync.ts` | market/sync/ | 11 | 按现有基础行情同步职责拆分 |

### 8.21 strategy

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `strategy/backtest-job.ts` | strategy/backtest/backtest-job.ts | 8 | 回测任务入口；Commit 4 先提取完成/恢复操作 |
| `strategy/code/codegen-prompt.test.ts` | strategy/runtime/typescript/codegen-prompt.test.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/codegen-prompt.ts` | strategy/runtime/typescript/codegen-prompt.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/compile.test.ts` | strategy/runtime/typescript/compile.test.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/compile.ts` | strategy/runtime/typescript/compile.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/params.test.ts` | strategy/runtime/typescript/params.test.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/run.ts` | strategy/runtime/typescript/run.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/schema.ts` | strategy/runtime/typescript/schema.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/sdk-reference.test.ts` | strategy/runtime/typescript/sdk-reference.test.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/sdk.test.ts` | strategy/runtime/typescript/sdk.test.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/code/sdk.ts` | strategy/runtime/typescript/sdk.ts | 8 | 策略 TS SDK 与运行适配 |
| `strategy/python/codegen-prompt.test.ts` | strategy/runtime/python/codegen-prompt.test.ts | 3 | 策略 Python SDK 与运行适配 |
| `strategy/python/codegen-prompt.ts` | strategy/runtime/python/codegen-prompt.ts | 3 | 策略 Python SDK 与运行适配 |
| `strategy/python/protocol.test.ts` | infra/runtime/python/protocol.ts + 领域协议 | 3 | 公共帧与领域 SDK 协议拆分；测试跟随 |
| `strategy/python/protocol.ts` | infra/runtime/python/protocol.ts + 领域协议 | 3 | 公共帧与领域 SDK 协议拆分；测试跟随 |
| `strategy/python/runtime.test.ts` | strategy/runtime/python/runtime.test.ts | 3 | 策略 Python SDK 与运行适配 |
| `strategy/python/runtime.ts` | strategy/runtime/python/runtime.ts | 3 | 策略 Python SDK 与运行适配 |
| `strategy/python/session.ts` | infra/runtime/python/session.ts | 3 | 公共 Python 传输 |
| `strategy/scan-job.ts` | strategy/scans/scan-job.ts | 8 | 参数扫描 |
| `strategy/scan.test.ts` | strategy/scans/scan.test.ts | 8 | 参数扫描 |
| `strategy/scan.ts` | strategy/scans/scan.ts | 8 | 参数扫描 |
| `strategy/zeng.ts` | strategy/examples/zeng.ts | 8 | 仓库策略示例 |

### 8.22 tushare

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `tushare/api.ts` | market/providers/tushare/api.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/asset-allocation-probe.test.ts` | market/providers/tushare/asset-allocation-probe.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/asset-allocation-probe.ts` | market/providers/tushare/asset-allocation-probe.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/capability-catalog.ts` | market/providers/tushare/capability-catalog.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/capability-probe-store.ts` | market/providers/tushare/capability-probe-store.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/client.ts` | market/providers/tushare/client.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/etf-api.test.ts` | market/providers/tushare/etf-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/financial-statement-api.test.ts` | market/providers/tushare/financial-statement-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/futures-api.test.ts` | market/providers/tushare/futures-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/index-daily-basic-api.test.ts` | market/providers/tushare/index-daily-basic-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/market-reference-api.test.ts` | market/providers/tushare/market-reference-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/reference-data-api.test.ts` | market/providers/tushare/reference-data-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |
| `tushare/stock-reference-api.test.ts` | market/providers/tushare/stock-reference-api.test.ts | 11 | 整体迁移；保持子领域内部语义 |

### 8.23 types

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `types/node-sqlite.d.ts` | agent/tools/sql/node-sqlite.d.ts | 10 | SQL worker 的类型补充 |

### 8.24 util

| 当前文件 | 目标路径/职责 | Commit | 处理 |
| --- | --- | --- | --- |
| `util/log.ts` | infra/logging.ts | 2 | 日志辅助 |

## 9. Commit 1 交付与后续使用

- 交付仅为开发计划和本基线，供后续重构评审使用；无新增用户可访问能力。
- 源码迁移完成后按目标归属更新阅读地图，本文保留原始基线事实；每个提交记录实际 hash 和验证结果，不能用目标目录覆盖历史事实。
- 任何与本基线不同的测试结果先区分源码变化、fixture、环境和生产隔离条件。原有不自包含测试、Curator 事务差异、API 关闭能力缺口分别记录，不混入纯迁移。
- Commit 1 已完成验证并于 2026-09-08 获得提交授权。455/455 源文件映射覆盖且无重复；Markdown 代码围栏、空白与文档链接检查通过。开始时已跟踪文件逐个内容摘要核对无变化，已有 EPUB 暂存内容保持。
- 提交说明：`记录后端架构重构计划与实施基线`。Commit 2 在具体实施范围确认后开始。
