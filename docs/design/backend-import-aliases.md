# 后端原生模块别名

## 范围与约定

使用 Node package imports 缩短 API 跨顶层模块导入：`#infra/jobs/records.js`、`#factor/definitions/fields.js` 等。根级纯日期辅助为 `#date`。模块内部保持相对路径，跨 workspace 保持包名；不增加 barrel、不改变依赖边界，也不改变 HTTP、数据库或业务行为。

映射唯一来源为 `apps/api/package.json#imports`。开发条件映射源码，默认映射 `dist/src`；TypeScript、tsx、Vitest、真实 Worker/子进程和 esbuild wall bundle 使用对应条件。CLI 源码执行显式传入 `--conditions=development`。生产保留 API package.json 并使用默认条件。资源 URL 保留相对路径。

## 提交与 review

计划提交：`refactor(api): 使用原生模块别名替换跨模块相对导入`

方案及人工代码 review 已获批准。2026-09-10 行为验证完成；review 后未修改产品代码或配置，仅更新本记录，按上述提交信息提交。

## 验证计划与记录

- Review 前：格式、lint、全仓类型、生成契约一致性和后端边界静态检查。
- Review 后：API 测试、边界检查器回归测试、干净构建；源码及编译启动、CLI、Worker/子进程与 wall bundle 验证。使用临时数据库，结束后清理进程。
- 专项回归覆盖原生别名的源码目标、非法跨域依赖、未知/缺失内部导入，以及 Node 主进程和 Worker 的源码解析、生产默认解析。

2026-09-10 静态结果：全仓 `pnpm typecheck` 通过（含三项生成契约一致性）；后端边界检查扫描 632 文件、2260 条运行时边和 564 条类型边，0 违规。改动文件 ESLint、Prettier 检查及 `git diff --check` 通过。

全仓 `pnpm lint` 扫入本地 `.venv` 中 Notebook 的第三方 JavaScript，出现 ESLint 环境注释警告并耗时过长，已停止该命令，使用改动文件的定向 lint 完成验证；未修改无关 lint 配置。

## Review 后行为验证（2026-09-10）

- API 全套首次运行 1097 项通过、9 项因沙箱禁止 Unix socket 失败、1 项账户集成条件跳过。获得本地 socket 权限后，9 项 transport 测试与独立数据库下的账户集成共 10 项通过；累计 1107 项用例通过，无剩余失败或跳过。
- 后端边界检查器 16 项测试通过，含原生别名解析、跨域违规及未知/缺失内部导入。
- `/tmp/jixie-alias-verification/clean` 从当前源码建立，无旧 dist 或 tsbuildinfo，shared 依赖指向该副本的新产物；根级 `pnpm build` 完成全部 workspace 构建。前端仅有现有 bundle 大小警告。
- 源码和干净编译版均验证真实 index 启动、健康检查、孤立 running Job 恢复及内置因子初始化。
- 两种运行方式均通过 TS/Python 回测、扫描 Worker 与 cell 子进程、任务完成/失败/恢复，以及真实 Signals IPC、冻结配置、因子血缘、账户结算及失败重试。
- 两种运行方式均通过因子分析/相关性 Worker、真实 Pyright、SQL Worker 只读约束/超时重建及图表 isolate；回测同时覆盖真实 esbuild wall bundle。
- Market 两种运行方式各完成 52 次本地行情替身请求、4 个参考数据/CLI 子进程，并验证回滚、幂等及派生数据。未请求真实行情、模型或邮件服务。
- 临时验证脚本复用了既有合成 fixture；旧 Signals 脚本先因已退役的 `deployStrategy` 接口失败，改用现行报告部署 harness 后通过。编译 SQL 首次因 harness 使用旧构建目录的相对数据库锚点失败，修正临时路径后通过。上述修复仅涉及 `/tmp` 中的验证脚本，未修改产品代码。
- 所有验证子进程正常退出；启动端口关闭，Worker/Python/Pyright 和 Prisma 已清理，`lsof` 确认临时数据库无打开句柄。

日志、运行结果与验证脚本位于 `/tmp/jixie-alias-verification`；初次 API 和边界测试日志分别为 `/tmp/jixie-alias-tests.log`、`/tmp/jixie-alias-boundary-tests.log`。本轮未涉及 UI 改动或浏览器 E2E，也不代表生产 Docker 隔离验收。

## 包级测试归档（2026-09-10）

计划提交：`refactor(api): 将包级测试迁入 tests 目录`。

用户已确认范围：`import-aliases.test.ts` 与 `job-lifecycle.integration.test.ts` 迁至 `apps/api/tests`，分别归包级运行配置契约和跨模块任务集成契约；模块内测试继续与源码同目录。迁移只调整 lifecycle 的 bootstrap/server 相对引用，别名测试与 API 根目录的相对位置不变。TypeScript 和边界检查器继续覆盖新目录，生产代码不能导入该目录内的测试或辅助文件。

静态检查完成后等待检查器代码 review；批准后运行迁移的两组测试及边界检查器回归测试，验证测试发现、类型覆盖及内部导入解析。无业务行为、数据库或部署组件变化。

本次静态结果：`pnpm typecheck`（含后端边界及生成契约一致性）、改动文件 ESLint、Prettier 和 `git diff --check` 均通过。新增三项边界回归用例覆盖 tests 目录扫描、语法/导入错误与生产代码误导入测试辅助文件。

人工 review 已批准。迁移后的两个测试文件共 35 项用例通过，边界检查器 19 项回归通过，无失败或跳过。任务生命周期测试使用独立临时 SQLite，结束后断开 Prisma 并移除 fixture；别名测试的 Node/Worker 已退出，未启动常驻服务。日志为 `/tmp/jixie-tests-directory-tests.log`、`/tmp/jixie-tests-directory-boundaries.log`；按计划提交，无新增产品行为改动。
