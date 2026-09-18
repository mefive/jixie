# 后端运行入口清单

此清单补充 [架构地图](backend-architecture.md)。import 检查不等于进程/资源路径检查；下面这些入口必须在源码和干净编译目录分别验证。路径以 `apps/api/src` 为基准；表中 `.boot.mjs` 是开发入口，不要求 tsc 复制它们到生产目录。

## 线程、进程与 bundle

API 的原生包内别名由 `apps/api/package.json#imports` 定义：`development` 条件指向 `src`，默认指向 `dist/src`。API 开发和 CLI 的 pnpm 脚本显式传入 `--conditions=development`；手动源码执行也须传入该参数。Vitest 为模块解析及测试子进程设置相同条件，真实 Worker/fork 继承启动条件。esbuild wall bundle 根据当前入口为 `.ts` 或 `.js` 选择源码或编译映射。生产 Node 不启用 `development`，且部署保留 API package.json；不能把 dist 脱离该包配置单独搬运。Worker URL 和非模块资源路径仍按本表解析。

| 发起方 | 源码入口 | 编译入口 | 执行与收尾 |
| --- | --- | --- | --- |
| `strategy/backtests/job.ts` | `strategy/backtests/worker.boot.mjs` → `worker.ts` | `strategy/backtests/worker.js` | 回测线程；回传结果，主线程按 Job 契约完成事务 |
| `strategy/scans/job.ts` | `strategy/scans/strategy-scan-worker.boot.mjs` → `.ts` | `strategy/scans/strategy-scan-worker.js` | 参数扫描线程；汇总 cell 结果 |
| 扫描 Worker | `strategy/scans/strategy-scan-cell-worker.boot.mjs` → `.ts` | `strategy/scans/strategy-scan-cell-worker.js` | fork 各 cell；独立执行并退出，扫描父线程判定退出结果 |
| `factor/evaluations/job.ts`、`factor/weather/refresh.ts` | `factor/execution/worker.boot.mjs` → `.ts` | `factor/execution/worker.js` | 因子分析与天气刷新线程；任务/天气调用方分别拥有最终持久化 |
| `factor/correlations/job.ts` | `factor/correlations/worker.boot.mjs` → `.ts` | `factor/correlations/worker.js` | 只返回相关性结果；缓存写入在主线程 complete 事务 |
| `signals/runs/job.ts` | `signals/runs/signal-worker.boot.mjs` → `.ts` | `signals/runs/signal-worker.js` | IPC 子进程；结果交给主线程，子进程断开 Prisma 和 IPC |
| `agent/tools/sql/read-only-sql.ts` | 同目录 `sql-worker.boot.mjs` → `.ts` | 同目录 `sql-worker.js` | Node SQLite 只读线程，按需创建/重建；原生查询可能使 terminate 延后到查询返回 |
| `application-maintenance/reference-worker-process.ts` | 同目录 `reference-worker.ts`，继承 tsx execArgv | 同目录 `reference-worker.js`，不继承源码 execArgv | financial_statements / financials / dividends 分批子进程；接收 summary 且正常退出才完成 |
| `strategy/runtime/typescript/wall-bundle.ts` | 同目录 `wall-entry.ts` | 同目录 `wall-entry.js` | esbuild neutral bundle，实际 Engine 核心，不带宿主 Prisma/Node 导入；进程内缓存 bundle |
| `infra/runtime/typescript/isolate-run.ts` | 相对 URL 定位 `math/stats.ts` | 对应 `math/stats.js` | 为调用方加载 isolate 模块；不是常驻独立服务 |
| `strategy/runtime/typescript/walled-run.test-worker.mjs` | 测试辅助入口，使用 `engine/testing/fixture-port` | 不作为生产入口 | 测试专用；生产不能导入 `.test-worker.mjs` 或 testing fixture |

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
| `infra/runtime/python/session.ts` | 生产通过 `JIXIE_SANDBOX_SOCKET` 连接独立 sandboxd；仅非生产可使用本地 runner 分支 |
| `research/runtime/python-session.ts` | 普通文档运行、提案尝试、嵌入分析与依赖分析共用同一会话管理器；按文档 ID 获取/回收，经公共 Python session 连接 runner。文档锁归 `document-runs/`，嵌入分析取消/超时归 `embedded/`；不新增 Worker |
| 本地 Python runner | 相对 API 工作目录解析 `../sandboxd/python/jixie_runner.py`；CLI/验证必须使用 `apps/api` 为 cwd，不能从任意目录裸跑 |
| `apps/sandboxd/src/index.ts` | 独立 Node daemon，接收 socket 会话并管理 runner；local 模式与生产隔离模式分别验收 |
| `research/language/pyright-service.ts` | 从 API 依赖解析 pyright 包，管理语言服务子进程与临时 workspace；`language/document.ts`/`stubs.ts` 提供文档与类型映射 |
| 公开 Python stub | `apps/sandboxd/python/jixie_research_sdk.pyi`、`jixie_factor_sdk.pyi` 由 shared Contract 生成；路径移动不得手工改生成结果 |
| API Prisma | `DATABASE_URL` 的相对 file 路径按 `apps/api/prisma/schema.prisma` 所在目录解析 |
| Agent SQL databasePath | `agent/tools/sql/read-only-sql.ts` 将相对数据库 URL 按上述 Prisma 目录转换；与工具目录深度绑定，不能按 cwd 猜测 |
| Curator 仓库检索 | `research/curator/reference-search.ts` 仍使用约定的 API 工作目录定位项目资料；不是外部任意文件读取服务 |
| API CLI | 28 个应用入口位于 `apps/api/src/{market,application-maintenance,signals,auth}/cli/`；审计和探针入口保留在 `apps/api/scripts/{audit,probes}`，见 [脚本索引](../apps/api/scripts/README.md)；TS 入口源码 tsx，生产编译 `.js`，各自负责 Prisma 收尾。备份直接执行 `scripts/backup-db.mjs`，默认数据库路径仍锚定 API 的 `prisma/dev.db`；systemd 维护入口为 `dist/src/application-maintenance/cli/run-maintenance.js` |

Market 的领域目录调整不改变 CLI 名称、参数、源码/编译入口或 Worker 协议。CLI 和 Maintenance 分别调用 stocks、etfs、indices、futures、calendar、cross-market、state 等业务入口；Signals 每日需求编排仍在 Signals。涉及迁移的 CLI 须以隔离数据库和本地 provider 替身验证调用、输出及退出；不以导入成功代替执行。

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
