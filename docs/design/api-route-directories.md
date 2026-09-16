# 业务路由目录整理

## 范围与约定

- 提交信息：`refactor(api): group HTTP handlers in routes directories`。
- Strategy、Factor、Research、Signals、Agent、Market 的 28 个 `xxx-routes.ts` 实现移至各自的 `routes/xxx.ts`。
- 六个模块的总入口移至 `routes/index.ts`，保留组合、具名导出和既有注册顺序；外部显式导入 `routes/index.js`，不保留根级转发文件。
- Strategy、Factor、Research 的 HTTP 错误映射移至 `routes/errors.ts`；业务错误类型保留原位置。
- Strategy 回测专属测试移至 `routes/backtest.test.ts`；模块整体路由测试保持根级。
- Auth、Sharing、Application Maintenance 的单文件路由保持根级。API 入参与共用业务配置仍在根级 `schema.ts`。
- 边界检查器识别业务根级 `routes.ts` 及同级 `routes/` 目录，继续禁止业务反向依赖 HTTP、HTTP 直接导入 Prisma；相邻或更深业务目录不会因此放行 Hono，应用级 `src/routes/` 仍属于已退役目录。
- 同步根级项目约定、架构/路径文档和六个模块阅读地图。无 HTTP 路径、字段、响应、鉴权、数据语义、SDK、数据库迁移或用户界面变更。

## 验证记录

- 范围与提交信息已获确认；人工 review 反馈进一步确认将六个总入口移至 `routes/index.ts`，按 review-gated-development 流程完成修订。
- 静态检查：全仓 `pnpm typecheck` 通过，包含全部 workspace 类型、Research runtime/SDK、Factor SDK 生成契约一致性和后端依赖边界（684 个文件，0 违规）；50 个改动源码/测试文件的 ESLint（零警告）及 Prettier 检查通过，`git diff --check` 通过。
- 静态迁移核对：48 个迁移或引用调整文件，规范化导入路径并忽略格式后内容一致，包含路由注册顺序及专属测试的 mock 路径；旧实现文件均已移除。
- 人工 code review：用户已确认修订后的代码，并授权验证通过后提交。
- 行为验证：下列命令全部通过；边界检查器 28 项测试通过，10 个 API 测试文件共 203 项测试通过，API 构建通过。测试进程已正常退出。
- 提交：验证完成，按约定提交信息随本变更提交；不推送。

```sh
pnpm test:backend-boundaries
pnpm --filter api test \
  src/strategy/routes.integration.test.ts \
  src/strategy/routes/backtest.test.ts \
  src/factor/routes.integration.test.ts \
  src/factor/questions/conversations.integration.test.ts \
  src/auth/multi-user-permissions.test.ts \
  src/research/routes.integration.test.ts \
  src/research/embedded/lifecycle.integration.test.ts \
  src/signals/routes.integration.test.ts \
  src/agent/routes.integration.test.ts \
  src/market/routes.test.ts
pnpm --filter api build
```
