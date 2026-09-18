# 命令入口收敛

计划提交：`refactor(repo): consolidate command entry points and retire legacy migration`。

## 范围与接口

2026-09-18 全项目审计发现 6 个 package.json 共 177 个 script 注册，其中 Web 的 87 个注册有 82 个属于 E2E 命令族。
用户确认将 E2E、同步、审计和探针收敛为独立入口，帮助图片生成单独管理，并退役生产已完成的 Factor Job 转换；保留原有业务与测试能力。

- 根级 `pnpm e2e <任务>` / `--group <组>`：显式清单、顺序执行、首败停止、退出码与进程组清理。
- 根级 `pnpm docs:images <任务>`：分离 14 个页面截图任务与 3 个已有图片标注任务。
- 根级 `pnpm sync <任务> [参数]`，API 包保留一个 `sync` 注册：24 个任务的帮助、校验与分派。
- 根级 `pnpm data:audit <任务>` / `pnpm probe <任务>`：4 个审计、2 个外部探针，API 各保留一个注册。`pnpm audit` 继续为依赖漏洞检查。
- 无参数、`--list`、单项 `--help` 不执行工作；三个 API 入口共用 `command-entry.ts`，读取 `.env` 和导入业务模块之前完成参数校验。
- 删除 `peek` 的两处注册和实现；原 Web 默认 `test:e2e` 与 `research-executions` 合并为一个任务。
- 7 个此前仅能按文件运行的浏览器检查纳入清单；fixture 和代码样例不纳入。
- 部署和批量导入迁移至统一的 sync/data:audit/probe 命令；`maintenance` / `import:data` 的锁、恢复及编排不变。
- 用户确认生产已完成 Factor Job 转换；删除一次性转换脚本、专属测试、package 注册、部署调用与专属失败标记。保留当前 Job kind 下历史 payload 的业务回归及 Prisma schema 迁移历史。旧库恢复流程记录在运行入口文档。

收敛后 package scripts 共 66 个（根 32、API 16、Web 5、Docs 5、sandboxd 5、shared 3）。
浏览器任务 71 个、图片任务 17 个、同步任务 24 个、审计任务 4 个和探针 2 个由清单管理，不再每项注册 package script。

## 兼容性与边界

旧 `sync:*` / `audit:*` / `probe:asset-allocation` / `smoke` / Web、Docs `test:e2e*` 命令移除，迁移对照见当前脚本 README。
同步位置参数顺序、各任务省略参数的默认值与数据语义保留；新入口拒绝未知选项、多余参数、非法日期/选择器。
财报 `--start` / `--end` 必须与 `--repair-code` 配合，避免参数拼错后进入全量导入。
E2E 保留原 app 工作目录、Node 参数（包括 FCFF reuse 的 tsx）、环境开关和 learning-cases 原顺序。
浏览器检查/图片采集需要各自已有服务与数据；运行器不会自动运行整套开发环境。历史设计/验收报告保留原命令。

没有新增依赖、workspace、跨包构建依赖、产品页面/API、数据库 schema 或 migration。
部署映射无需改变：根级 `scripts/` 已属于全量部署；补充其新入口路径的回归用例。

## 验证状态

- 范围与代码审查：用户均已批准。
- 扩展范围后的静态检查已通过：全仓 `pnpm typecheck`（包含后端边界与生成契约检查）、改动 TS/MJS 文件 ESLint、改动 TS/MJS/JSON 文件 Prettier、部署与导入脚本 `bash -n`、部署测试脚本语法检查以及 `git diff --check`。后端边界检查覆盖 734 个文件，0 违规。
- 最终静态清点确认 6 个 package.json 共 66 个注册；退役迁移仅在恢复文档和断言其不存在的测试中保留引用，无运行时调用。
- 原清单静态核对：原 Web 80 个不同文件全部保留，新增 Docs 入口和 7 个独立浏览器检查后共 88 个浏览器/图片文件；24 个同步任务与原脚本路径逐项一致。
- 审查后验证全部通过：Node 测试 23 项（入口选择、参数与退出码透传、首败停止、中断及后代进程清理、部署流程与部署影响范围）；API Vitest 6 个文件共 162 项（参数校验、源码及编译形式的隔离分派、CLI 契约、隔离数据库中的 Job 生命周期与 Factor 路由回归）。
- `pnpm --filter api build` 通过；`pnpm e2e/docs:images/sync/data:audit/probe --help` 五个实际入口均输出帮助并以 0 退出。测试已完成自身临时数据库断开与目录清理。
- 不执行全量 E2E、真实数据同步或生产部署；本次验证聚焦命令分派和迁移退役，不以帮助命令通过代替产品 E2E 验收。
- 已完成验证，按批准的提交信息提交；不推送。
