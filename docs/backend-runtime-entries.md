# 后端运行入口清单

此清单补充 [架构地图](backend-architecture.md)。import 检查不等于进程/资源路径检查；下面这些入口必须在源码和干净编译目录分别验证。路径以 `apps/api/src` 为基准；表中 `.boot.mjs` 是开发入口，不要求 tsc 复制它们到生产目录。

## 线程、进程与 bundle

| 发起方 | 源码入口 | 编译入口 | 执行与收尾 |
| --- | --- | --- | --- |
| `strategy/backtest-job.ts` | `engine/backtest-worker.boot.mjs` → `backtest-worker.ts` | `engine/backtest-worker.js` | 回测线程；回传结果，主线程按 Job 契约完成事务 |
| `strategy/scan-job.ts` | `strategy/scans/strategy-scan-worker.boot.mjs` → `.ts` | `strategy/scans/strategy-scan-worker.js` | 参数扫描线程；汇总 cell 结果 |
| 扫描 Worker | `strategy/scans/strategy-scan-cell-worker.boot.mjs` → `.ts` | `strategy/scans/strategy-scan-cell-worker.js` | fork 各 cell；独立执行并退出，扫描父线程判定退出结果 |
| `factor/analysis-job.ts`、`factor/weather/refresh.ts` | `factor/analysis/factor-worker.boot.mjs` → `.ts` | `factor/analysis/factor-worker.js` | 因子分析与天气刷新线程；任务/天气调用方分别拥有最终持久化 |
| `factor/correlation-job.ts` | `factor/analysis/correlation-worker.boot.mjs` → `.ts` | `factor/analysis/correlation-worker.js` | 只返回相关性结果；缓存写入在主线程 complete 事务 |
| `signals/signal-job.ts` | `signals/runs/signal-worker.boot.mjs` → `.ts` | `signals/runs/signal-worker.js` | IPC 子进程；结果交给主线程，子进程断开 Prisma 和 IPC |
| `agent/tools/sql/read-only-sql.ts` | 同目录 `sql-worker.boot.mjs` → `.ts` | 同目录 `sql-worker.js` | Node SQLite 只读线程，按需创建/重建；原生查询可能使 terminate 延后到查询返回 |
| `maintenance/reference-worker-process.ts` | 同目录 `reference-worker.ts`，继承 tsx execArgv | 同目录 `reference-worker.js`，不继承源码 execArgv | financial_statements / financials / dividends 分批子进程；接收 summary 且正常退出才完成 |
| `strategy/runtime/typescript/wall-bundle.ts` | 同目录 `wall-entry.ts` | 同目录 `wall-entry.js` | esbuild neutral bundle，实际 Engine 核心，不带宿主 Prisma/Node 导入；进程内缓存 bundle |
| `infra/runtime/typescript/isolate-run.ts` | 相对 URL 定位 `math/stats.ts` | 对应 `math/stats.js` | 为调用方加载 isolate 模块；不是常驻独立服务 |
| `strategy/runtime/typescript/walled-run.test-worker.mjs` | 测试辅助入口，使用 `engine/testing/fixture-port` | 不作为生产入口 | 测试专用；生产不能导入 `.test-worker.mjs` 或 testing fixture |

7 个开发 `.boot.mjs` 都先注册 tsx，再通过 `import(new URL(...).href)` 加载源文件。它们在边界检查中显示为非字面量导入，需要核对本表；检查器不声称推断任意表达式的运行时路径。

2026-09-10 已移除 Agent 快速回测工具及其 Worker，当前运行入口以上表为准；下方 Commit 12 验证保留当时的历史事实。决策与退役验证见 [Agent 研究闭环](design/agent-research-loop.md)。

## Python、语言服务与资源目录

| 资源/路径 | 解析规则与归属 |
| --- | --- |
| `infra/runtime/python/session.ts` | 生产通过 `JIXIE_SANDBOX_SOCKET` 连接独立 sandboxd；仅非生产可使用本地 runner 分支 |
| 本地 Python runner | 相对 API 工作目录解析 `../sandboxd/python/jixie_runner.py`；CLI/验证必须使用 `apps/api` 为 cwd，不能从任意目录裸跑 |
| `apps/sandboxd/src/index.ts` | 独立 Node daemon，接收 socket 会话并管理 runner；local 模式与生产隔离模式分别验收 |
| `research/language/pyright-service.ts` | 从 API 依赖解析 pyright 包，管理语言服务子进程与临时 workspace；`language/document.ts`/`stubs.ts` 提供文档与类型映射 |
| 公开 Python stub | `apps/sandboxd/python/jixie_research_sdk.pyi`、`jixie_factor_sdk.pyi` 由 shared Contract 生成；路径移动不得手工改生成结果 |
| API Prisma | `DATABASE_URL` 的相对 file 路径按 `apps/api/prisma/schema.prisma` 所在目录解析 |
| Agent SQL databasePath | `agent/tools/sql/read-only-sql.ts` 将相对数据库 URL 按上述 Prisma 目录转换；与工具目录深度绑定，不能按 cwd 猜测 |
| Curator 仓库检索 | `research/curator/reference-search.ts` 仍使用约定的 API 工作目录定位项目资料；不是外部任意文件读取服务 |
| API CLI | 入口按 `apps/api/scripts/{sync,audit,probes,maintenance,research,generators}` 分组，见 [脚本索引](../apps/api/scripts/README.md)；TS 入口源码 tsx，生产编译 `.js`，各自负责 Prisma 收尾。备份直接执行 `scripts/maintenance/backup-db.mjs`，默认数据库路径仍锚定 API 的 `prisma/dev.db`；systemd 维护入口为 `dist/scripts/maintenance/run-maintenance.js` |

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
