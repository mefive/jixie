# 业务输入 schema 集中整理

> 后续共享 HTTP 请求契约已完成实现、人工 review 与验证，当前放置规则见 [共享请求契约](api-request-contracts.md)。本文保留前序提交的实施与验收记录。

## 范围与约定

- 提交信息：`refactor(api): centralize business input schemas`。
- 将 Strategy、Factor、Research、Signals、Agent、Market、Auth 的 API 入参与共用业务配置定义集中到各自的 `schema.ts`，按职责分组，迁移消费者引用并移除空文件。
- `codeConfigSchema` 从 Strategy 的 TypeScript runtime 移至业务根目录，保留 TypeScript/Python 双语言校验。
- Factor 报告/组合配置与 Research 股票池配置一并归位；原文件保留默认值构造、规范化、指纹计算或语义检查。
- 把 Research 的 `parseResearchRequestFrame` 及返回类型从 `sdk/dispatch.ts` 原样移到 `sdk/request.ts`，让嵌入式引用校验复用纯解析而不加载数据查询实现。
- 保留各协议、任务内部 payload、Agent 工具、SDK 专用校验和 LLM 输出校验的归属；接口路径、字段、默认值、转换、拒绝规则及数据库结构不变，无数据迁移。
- 用户操作、帮助、公开 SDK 契约和双语文案不变，无需更新产品文档或翻译资源。

放置约定与入口见 [后端架构阅读地图](../backend-architecture.md#输入-schema-的位置)。

## 验证记录

- 2026-09-16：范围、提交信息与人工 code review 均已获确认，随后完成行为验证。
- 静态检查：全仓 `pnpm typecheck` 通过，包含后端依赖边界、Research runtime/SDK、Factor SDK 生成一致性及各 workspace 类型检查；改动 TypeScript 文件 ESLint（零警告）、Prettier 和 `git diff --check` 通过。
- 静态迁移核对：105 个迁移声明的表达式/函数体在忽略空白、尾逗号和明确的变量重命名后相同；七个 schema 的源文件运行时依赖闭包不包含数据库、LLM、任务执行或 SDK dispatch。
- 行为验证：下列 15 个测试文件全部通过，共 247 个用例；`pnpm --filter api build` 通过。Agent 错误日志来自预期的失败场景 fixture，相关用例通过。涉及数据库的集成测试使用各自临时数据库，结束时断开连接并删除目录。
- 提交门禁：人工 review、静态检查、行为验证和 API 构建均已通过。

```sh
pnpm --filter api test \
  src/auth/routes.test.ts \
  src/market/routes.test.ts \
  src/agent/routes.integration.test.ts \
  src/strategy/routes.integration.test.ts \
  src/strategy/backtest-routes.test.ts \
  src/strategy/execution/prepare-factors.test.ts \
  src/factor/routes.integration.test.ts \
  src/factor/reports/spec.test.ts \
  src/factor/questions/conversations.integration.test.ts \
  src/research/routes.integration.test.ts \
  src/research/datasets/universe.test.ts \
  src/research/embedded/data-references.test.ts \
  src/research/embedded/lifecycle.integration.test.ts \
  src/research/sdk/dispatch.test.ts \
  src/signals/routes.integration.test.ts
pnpm --filter api build
```
