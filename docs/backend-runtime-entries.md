# 后端运行入口清单

此清单补充 [架构地图](backend-architecture.md)。import 检查不等于进程/资源路径检查；下面这些入口必须在源码和干净编译目录分别验证。路径以 `apps/api/src` 为基准；表中 `.boot.mjs` 是开发入口，不要求 tsc 复制它们到生产目录。

## 线程、进程与 bundle

API 的原生包内别名由 `apps/api/package.json#imports` 定义：`development` 条件指向 `src`，默认指向 `dist/src`。API 开发和 CLI 的 pnpm 脚本显式传入 `--conditions=development`；手动源码执行也须传入该参数。Vitest 为模块解析及测试子进程设置相同条件，真实 Worker/fork 继承启动条件。esbuild SDK bundle 根据当前入口为 `.ts` 或 `.js` 选择源码或编译映射。生产 Node 不启用 `development`，且部署保留 API package.json；不能把 dist 脱离该包配置单独搬运。Worker URL 和非模块资源路径仍按本表解析。

| 发起方 | 源码入口 | 编译入口 | 执行与收尾 |
| --- | --- | --- | --- |
| `strategy/backtests/job-lifecycle.ts` | `strategy/backtests/worker.boot.mjs` → `worker.ts` | `strategy/backtests/worker.js` | 回测线程；回传结果，主线程按 Job 契约完成事务 |
| `strategy/scans/job-lifecycle.ts` | `strategy/scans/worker.boot.mjs` → `.ts` | `strategy/scans/worker.js` | 参数扫描线程；同一线程串行调用共享模拟并汇总，异常使用通用 Worker.terminate |
| `factor/evaluations/job-lifecycle.ts`、`factor/weather/refresh.ts` | `factor/execution/worker.boot.mjs` → `.ts` | `factor/execution/worker.js` | 因子分析与天气刷新线程；任务/天气调用方分别拥有最终持久化 |
| `factor/correlations/job-lifecycle.ts` | `factor/correlations/worker.boot.mjs` → `.ts` | `factor/correlations/worker.js` | 只返回相关性结果；缓存写入在主线程 complete 事务 |
| `signals/runs/job-lifecycle.ts` | `signals/runs/worker.boot.mjs` → `.ts` | `signals/runs/worker.js` | IPC 子进程；结果交给主线程，子进程断开 Prisma 和 IPC |
| `agent/tools/sql/read-only-sql.ts` | 同目录 `sql-worker.boot.mjs` → `.ts` | 同目录 `sql-worker.js` | Node SQLite 只读线程，按需创建/重建；原生查询可能使 terminate 延后到查询返回 |
| `market/fundamentals/reference-worker-process.ts` | 同目录 `reference-worker.ts`，继承 tsx execArgv | 同目录 `reference-worker.js`，不继承源码 execArgv | financial_statements / financials / dividends 分批子进程；逐项报告完成，父进程等待调用方回调持久化后确认；收到完整 summary、所有确认且进程关闭后才完成；回调失败终止并回收子进程 |
| `strategy/runtime/typescript/sandbox-bundle.ts` | 同目录 `sandbox-entry.ts` | 同目录 `sandbox-entry.js` | esbuild neutral bundle，仅 SDK/指标与沙箱适配，不含 Engine 或宿主 Prisma/Node 导入；进程内缓存 bundle |
| `engine/adapters/factor-host.ts` | TS/Python 因子均由一次运行内的 FactorHost 管理 | 对应 `factor-host.js` | Engine 通过独立 FactorExecutionPort 使用；TS/Python 共享 execution/simulation 在 finally 关闭，初始化失败也清理已建立实例 |
| `infra/runtime/typescript/isolate-run.ts` | 相对 URL 定位 `math/stats.ts` | 对应 `math/stats.js` | 仅供 Agent 历史图表转换工具加载 isolate 模块；Factor 已使用公共 TypeScriptTransport |
| `strategy/runtime/typescript/runtime.test-worker.mjs` | 测试辅助入口，使用 `engine/testing/fixture-port` | 不作为生产入口 | 测试专用；生产不能导入 `.test-worker.mjs` 或 testing fixture |
| `factor/runtime/typescript/runtime-benchmark.test-worker.mjs` | 性能验证子进程；固定读取 `4464a616` 的 TS Factor 工厂／SDK bundler，和当前 FactorRuntime 比较横截面、窗口、资产序列及日志负载 | 不作为生产入口 | 仅测试；临时旧模块 finally 删除，记录结果哈希、耗时、逻辑载荷字节及新 transport 实测帧字节 |
| `strategy/runtime/typescript/runtime-benchmark.test-worker.mjs` | 显式性能验证子进程；固定读取 `f276bfbd` 的旧墙内源码、`04f62a16` 的历史 runtime/bridge，以及 `4464a616` 的本次重构前 runtime/bridge；后两者使用固定 `4464a616` 的 sandbox-entry，与当前 runtime 分进程比较 | 不作为生产入口 | 仅测试；旧 SDK 路径映射至现有 SDK，临时 bundle 保留旧调用入口；非字面量 import 指向本次生成的旧版本模块，finally 删除临时目录 |

7 个开发 `.boot.mjs` 都先注册 tsx，再通过 `import(new URL(...).href)` 加载源文件。它们在边界检查中显示为非字面量导入，需要核对本表；检查器不声称推断任意表达式的运行时路径。

2026-09-10 已移除 Agent 快速回测工具及其 Worker，当前运行入口以上表为准；下方 Commit 12 验证保留当时的历史事实。决策与退役验证见 [Agent 研究闭环](design/agent-research-loop.md)。

## API 命令分派

`pnpm sync <任务>`、`pnpm data:audit <任务>`、`pnpm probe <任务>` 分别转发到 API 的
`scripts/sync/index.ts`、`scripts/audit/index.ts`、`scripts/probes/index.ts`（源码带 `development` 条件及 tsx）。
编译入口为 `apps/api/dist/scripts/{sync,audit,probes}/index.js`，例如从 API 目录执行 `node dist/scripts/sync/index.js <任务>`。
显式任务清单的 `.js` 路径相对 API 源码/编译根解析；源码由 tsx 映射到 `.ts`，编译形式定位 `dist` 下的目标。
公共 `scripts/command-entry.ts` 中的非字面量动态导入由清单覆盖测试与源码/编译隔离分派测试验证。
参数校验后才切换至 `apps/api`、加载其 `.env`、设置原 CLI 的 `process.argv` 并导入选中入口；
不会预加载全部业务模块，帮助和非法参数不加载业务配置。各原 CLI 保留自己的异步任务及资源收尾，财报子进程沿用既有执行器。
`maintenance` / `import:data` 继续负责锁和整轮任务编排；新入口不替代它们。

## Factor Job kind 旧库恢复

2026-09-18 用户确认生产后端已完成部署与旧 Job 转换。本次退役 `db:migrate:factor-job-kinds`、
其转换脚本和专属迁移测试，以及 bootstrap 中的调用和专属失败标记；新安装数据库、当前已升级数据库不再执行该步骤。
当前业务直接创建 `factor-analysis` / `factor-correlation`。历史 payload 中的 `task` 字段仍可读取、执行和恢复，
相关业务回归继续保留。此清理不删除或修改 `apps/api/prisma/migrations/` 中的 schema 迁移历史。

若恢复转换前的旧备份，或使用尚未转换的开发库：

1. 停止 API 并备份数据库，先在隔离副本完成恢复核验；按当前版本准备 Prisma Client 和 schema migrations。
2. 从已验证的历史提交提取一次性脚本到 API 的临时脚本位置：
   ```sh
   git show a3c768fe:apps/api/scripts/migrations/split-factor-job-kinds.ts > apps/api/scripts/restore-factor-job-kinds.ts
   ```
3. 配置 API `.env` 指向待恢复数据库，然后执行：
   ```sh
   pnpm --filter api exec node --import tsx --env-file=.env scripts/restore-factor-job-kinds.ts
   ```
4. 确认 `Job` 中 `kind = 'factor'` 的行数为 0，再启动当前 API，并移除临时提取的脚本。

历史脚本按 `payload.task === 'correlation'` 选择新 kind，其余转为 `factor-analysis`；保留 payload、状态、关联和日志。
转换失败时保持停服，排查后可重跑。当前 bootstrap 不再替旧库自动完成此转换。旧代码回退也不能只回退二进制，
需要匹配其数据库 kind 和 payload 约定。

## Python、语言服务与资源目录

| 资源/路径 | 解析规则与归属 |
| --- | --- |
| `infra/runtime/sandbox-runtime.ts`、`exchange.ts` | 三业务共同生命周期与命令循环；TS/Python 启动均显式发送命令 |
| `infra/runtime/typescript/transport.ts` | Factor/Strategy 共用 isolate 和帧传输；加载受信任的业务 sandbox-entry，用户源码在后续启动命令内执行 |
| `infra/runtime/python/session.ts` | 生产通过 `JIXIE_SANDBOX_SOCKET` 连接独立 sandboxd；仅非生产可使用本地 runner 分支 |
| `strategy/runtime/bridge.ts` | 共享业务 bridge；由 TS/Python runtime 创建，runtime 显式发送启动命令并负责关闭；bridge 提供 metadata/execute，Engine onBar 仅在 strategy/execution/simulation 适配。协议位于同目录 `protocol.ts`，不创建额外 Worker，也不运行用户源码 |
| `research/runtime/pool.ts` | 普通文档运行、提案尝试、嵌入分析与依赖分析共用同一会话管理器；按文档 ID 获取/回收，经公共 Python session 连接 runner。文档锁归 `document-runs/`，嵌入分析取消/超时归 `embedded/`；不新增 Worker |
| 本地 Python runner | 相对 API 工作目录解析 `../sandboxd/python/jixie_runner.py`；CLI/验证必须使用 `apps/api` 为 cwd，不能从任意目录裸跑 |
| `apps/sandboxd/src/index.ts` | 独立 Node daemon，接收 socket 会话并管理 runner；local 模式与生产隔离模式分别验收 |
| `research/language/pyright-service.ts` | 从 API 依赖解析 pyright 包，管理语言服务子进程与临时 workspace；`language/document.ts`/`stubs.ts` 提供文档与类型映射 |
| Python Strategy SDK/runtime | `apps/api/src/strategy/sdk/python.py` / `apps/api/src/strategy/runtime/python/runner.py`；通用 runner 在 `-I` 模式下显式加入相邻 API src 路径；镜像以仓库根为上下文并保留这组目录结构，只复制 `.dockerignore` 允许的模块；变更业务 Python 同时部署 API/sandboxd，打包回归在 `strategy/runtime/python/packaging.test.ts` |
| Strategy TS 公开类型 | `packages/shared/src/sdk/strategy/reference.ts` → 同目录 `contract.ts`；`setup:sandbox` 生成/校验，API 使用 `@jixie/shared/sdk/strategy/contract` 的类型入口；Monaco 继续动态调用同一声明生成器 |
| Python Factor SDK/runtime | `apps/api/src/factor/sdk/python.py` / `apps/api/src/factor/runtime/python/runner.py`；与 Strategy 使用相同业务目录导入和镜像显式打包方式，同时影响 API/sandboxd；三种分析类型的打包回归见 `factor/runtime/python/packaging.test.ts` |
| TS Factor SDK bundle | `factor/runtime/typescript/sandbox-bundle.ts` 从同目录 `sandbox-entry.ts`（开发）或 `.js`（编译后）打包协议入口、SDK 工厂、Context 实现及纯 `infra/runtime/log-buffer`；宿主缓存源码，每个 isolate 独立执行；验收须分别检查源码及 dist 两种路径 |
| Factor 公开契约 | `packages/shared/src/sdk/factor/reference.ts` → `contract.ts`，TS 编辑器和 API 共用签名来源；`python.ts` 生成原路径 Factor `.pyi`，Pyright/Agent 的既有 shared 导出保持兼容 |
| Research Python SDK / runner | `apps/api/src/research/sdk/python/` 的 data/results/valuation/charts 与 `runtime/python/` 的 runner/analysis/bridge/environment/outputs 通过通用 runner 加载；Docker 逐项 COPY 所有 Python 输入，同目录 TS 文件不进入镜像；源码变更同时影响 API/sandboxd |
| Research 宿主协议 | `research/runtime/host/` 拥有参数/帧校验、分派与输入回放；`runtime/research-runtime.ts` 调用它，SDK Python 不反向导入宿主 |
| 公开 Python stub | `apps/sandboxd/python/jixie_research_sdk.pyi`、`jixie_factor_sdk.pyi` 由 shared Contract 生成；路径移动不得手工改生成结果 |
| API Prisma | `DATABASE_URL` 的相对 file 路径按 `apps/api/prisma/schema.prisma` 所在目录解析 |
| Agent SQL databasePath | `agent/tools/sql/read-only-sql.ts` 将相对数据库 URL 按上述 Prisma 目录转换；与工具目录深度绑定，不能按 cwd 猜测 |
| Curator 仓库检索 | `research/curator/reference-search.ts` 仍使用约定的 API 工作目录定位项目资料；不是外部任意文件读取服务 |
| API CLI | 28 个应用入口位于 `apps/api/src/{market,maintenance,signals,auth}/cli/`；审计和探针入口保留在 `apps/api/scripts/{audit,probes}`，见 [脚本索引](../apps/api/scripts/README.md)；TS 入口源码 tsx，生产编译 `.js`，各自负责 Prisma 收尾。备份直接执行 `scripts/backup-db.mjs`，默认数据库路径仍锚定 API 的 `prisma/dev.db`；systemd 维护入口为 `dist/src/maintenance/cli/run-maintenance.js` |

Market 业务归属整理保留 CLI 名称与参数；`sync fina` 入口迁至 `market/cli/sync-fina.ts`，参考 Worker 迁至 `market/fundamentals` 并使用逐项完成确认协议，见 [整理记录](design/maintenance-business-boundaries.md)。CLI 和 Maintenance 分别调用 stocks、etfs、indices、futures、calendar、cross-market、state 等业务入口；Signals 每日需求编排仍在 Signals。涉及迁移的 CLI 须以隔离数据库和本地 provider 替身验证调用、输出及退出；不以导入成功代替执行。

## Commit 12 本轮验证（2026-09-09）

本轮人工 review 与整体验收已通过。以下区分 C12 初次验证和报告部署业务提交后的复跑，详见 [开发计划 §7.12](design/backend-architecture-refactor.md)。

| 运行链 | 本轮证据 |
| --- | --- |
| 项目门禁与测试 | 收尾复跑 14 项边界测试、8 项部署规划、1 项进程组退出测试通过；API 初次 203 文件/1101 用例，业务改动后 204 文件/1108 用例通过；sandboxd 8 用例通过 |
| 干净构建 | `/tmp/jixie-c12-verification/clean` 无旧 dist，Shared/API/sandboxd/Web/Docs 全部构建通过；workspace shared 链接指向新构建 |
| Job / 启动恢复 | 源码与干净编译的真实 index→bootstrap 启动均将 running fixture Job 恢复为 stale；Worker harness 另验证业务报告与 Job 的完成、失败、恢复 |
| Research / Python / Pyright | 源码和编译 Pyright 真实子进程补全通过；Research 文档执行、冻结、封存和删除草稿后证据保留 E2E 通过；真实 Python TS/策略结果一致性通过 |
| Factor / Strategy | 两种产物的 Factor 分析与相关性 Worker、TS/Python 回测、参数扫描线程与 cell 子进程通过；因子发布/历史/holdout、回测历史与三种扫描 E2E 通过 |
| Signals | 初次源码/编译 IPC 验证通过；报告部署业务提交 `3c55fd2f` 后再次通过两种入口、启动恢复及 report-deployments/daily-signals 浏览器完整流程 |
| Agent 工具 | 源码/编译 SQL、计算图表 isolate、快速回测 Worker、只读约束、超时重建/取消通过；Cell 上下文和提案审阅 E2E 使用受控 HTTP/SSE fixture |
| Market / Maintenance | 两种产物分别完成 52 次本地 provider 请求、4 个参考数据/CLI 子进程、SQLite 回滚/幂等、SQL 派生和 9 个路由对照；Market 四种维度、历史抽屉和移动布局 E2E 通过 |

日志与结果存于 `/tmp/jixie-c12-verification`。所有写入使用独立临时数据库，无真实行情/付费模型请求或邮件发送。编译 Python 分支的 socket 对端桥接真实本地 runner；sandboxd 测试使用容器命令替身。这些结果**不等于生产 Docker 隔离验收**。完整外部行情维护日批也未执行。

开发启动仍使用 `apps/api` 为 cwd。生产入口的 SQL 相对路径 smoke 按实际模块 realpath 计算 schema 锚点，避免临时符号链接目录层级造成误报。检查器不替代这些运行路径验证。

原定 12 组浏览器验收均已通过，包含失败后的针对性复跑。报告部署与 Monaco 修复后的 7 组回归见 `/tmp/jixie-report-deployment-verification`；C12 最终补跑受影响执行、中断和 Cell Agent 上下文 3 组用例，源码/编译启动恢复也通过，日志在 `/tmp/jixie-c12-final`。已检查本次 Research 截图；临时 API/Web、Worker、Python/Pyright 和模型替身已关闭，端口和数据库句柄已释放。

### Job Worker 输出契约

Backtest、Scan、Factor execution、Factor correlation、Signals 的 worker-protocol.ts 同时约束发送
和接收端；结果 schema 按领域维护。Scan 只有整任务的 Worker 消息，不再有 cell IPC 或 stop schema。Weather 共用 Factor execution 消息 schema 和 runWorker 资源收尾。
协议回归见 apps/api/tests/job-worker-protocol.test.ts；源码/编译入口验证仍使用既有 Worker 集成测试。
