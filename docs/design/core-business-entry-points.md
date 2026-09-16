# 核心业务模块入口整理

## 范围与交付

- 提交信息：`refactor(api): organize business module entry points`。
- 用户已确认五个核心业务模块：Factor、Strategy、Research、Market、Signals；本轮先实现并交人工 review。
- 根级保留 `README.md`、`schema.ts` 和按需存在的业务 `errors.ts`。业务子目录按实际职责保留，不要求每个模块具有相同目录。
- 原有 API 路径、导出函数名称、入参校验、业务行为、Job kind/payload、事务、算法和存储模型保持。无数据库迁移、公开 SDK、UI 或跨 package 构建依赖变化。
- Bootstrap、Agent、Maintenance、测试等消费者同步更新引用；不调整这些模块的目录结构。

## 迁移清单

| 模块 | 迁移后的入口 |
| --- | --- |
| Factor | `agent/turn.ts`；`analysis/job.ts`、`analysis/correlation-job.ts`、`analysis/job-dispatch.ts`；`errors.ts` |
| Strategy | `agent/turn.ts`、`agent/context.ts`；`backtest/job.ts`、`scans/job.ts`；`errors.ts` |
| Research | `agent/turn.ts`、`agent/context.ts`；`curator/job.ts`、`embedded/job.ts` |
| Signals | `runs/job.ts`、`runs/notifier.ts`；`daily/scheduler.ts`、`daily/sync.ts` |
| Market | 业务目录保持，整体 HTTP 测试归 `routes/index.test.ts` |

其余四个核心业务的整体 HTTP 测试归 `routes/index.integration.test.ts`；专属 Agent、Job、通知测试跟随实现。26 个原文件完成移动或更名，不保留兼容转发。

Factor 从原 `analysis-job.ts` 提取纯来源类型、运行时来源校验、解析、快照、哈希及语言判断到 `analysis/source-snapshot.ts`。发布、天气、模板、holdout 和 Strategy 执行依赖准备直接引用纯模块；任务提交、结果读取和生命周期仍在 `analysis/job.ts`。既有函数体与兼容分支保持。

当前规则同步至根级 CLAUDE、五个模块 README、架构地图及运行入口清单；历史设计记录保留当时路径，当前文件位置以本清单和模块 README 为准。

## 静态检查与 review 状态

- 全仓 `pnpm typecheck` 通过，包含全部 workspace、Research runtime/SDK 与 Factor SDK 生成契约一致性；后端边界扫描 685 个文件，0 违规。
- 73 个改动源码/测试文件的 ESLint（零警告）及 Prettier 检查通过。
- 静态迁移核对：72 个原文件的 448 个顶层声明/语句，在规范化路径并计入纯模块提取后内容一致；26 个旧路径均已移除。
- 五个 Worker 发起方的 10 个源码/编译 URL 分支已做静态定位检查，目标源文件存在；该检查不代替进程实际启动验证。
- `git diff --check` 与更新文档的本地链接检查通过。
- 人工代码 review：用户已确认并要求提交；本轮产品代码未在 review 后变更。

## Review 后的验证结果

以下测试覆盖迁移文件及其直接消费者、Job 注册与事务、Agent 上下文、因子快照消费、路由和信号记账。测试使用隔离数据库与既有替身。首轮 20 个文件、291 项通过，账户集成测试按默认开关跳过；随后在全新隔离 SQLite 中设置 `ACCOUNTING_INTEGRATION=1` 单独运行并通过。合计 21 个文件、292 项全部通过。

API 构建通过，实际命令为 `pnpm --filter api build --outDir <新建临时目录>/dist`，使用从未构建过的输出目录，避免旧产物掩盖路径问题。

```sh
pnpm --filter api test \
  src/bootstrap.test.ts \
  tests/job-lifecycle.integration.test.ts \
  src/factor/analysis/job.test.ts \
  src/factor/routes/index.integration.test.ts \
  src/factor/publication/factor.test.ts \
  src/factor/publication/panel-composite.test.ts \
  src/factor/questions/conversations.integration.test.ts \
  src/factor/weather/refresh.test.ts \
  src/strategy/routes/index.integration.test.ts \
  src/strategy/routes/backtest.test.ts \
  src/strategy/execution/prepare-factors.test.ts \
  src/research/agent/context.test.ts \
  src/research/curator/runs.test.ts \
  src/research/embedded/lifecycle.integration.test.ts \
  src/research/routes/index.integration.test.ts \
  src/market/routes/index.test.ts \
  src/signals/runs/notifier.test.ts \
  src/signals/routes/index.integration.test.ts \
  src/signals/accounting/flow.integration.test.ts \
  src/agent/routes.integration.test.ts \
  src/auth/multi-user-permissions.test.ts
pnpm --filter api build
```

五个 Worker 发起方已分别在源码（development + tsx）和干净编译产物（默认 Node 条件）下通过真实任务 `prepare().execute()` 启动 Worker/IPC 并正常退出，共 10 次。回测、因子分析和信号分别验证既有运行时版本拒绝、来源类型拒绝、运行不存在的错误回传；扫描使用空组合，相关性使用空行情数据库完成。该检查验证入口、模块解析、消息与退出，不代表完整市场数据上的算法验收。两种模式下六个 Job 注册 loader 及 Signals 每日入口也均加载成功。

所有验证进程已退出，数据库连接已释放，临时数据库已删除。无真实行情、邮件或付费模型请求。按预告信息随本变更提交，不推送。
