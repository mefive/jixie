# 前后端共享 HTTP 请求契约

## 状态与范围

- 2026-09-17：用户确认计划、提交信息与人工代码 review；实现、静态检查、行为测试及构建均已通过，随本提交交付。
- 约定提交信息：`refactor(api): share request schemas and types across web and api`。
- 一次完成当前 Web → API 的 JSON body、query 和已有 params 契约共享，覆盖 Auth、Strategy、Factor、Research、Signals、Agent、Market。
- 交付给前后端维护者，没有新增用户入口。HTTP 字段、默认值、转换、拒绝规则、权限、数据库与公开 Python SDK 行为保持现状；不需要数据迁移或产品帮助／i18n 更新。

## 结构与消费方式

`packages/shared/src/api/<模块>.ts` 是公共请求结构及纯校验规则的唯一来源；通过 `@jixie/shared/api/<模块>` 子路径导出。
Zod 复用 API 已有的 `^4.4.3` 版本，锁定解析仍是 4.4.3。现有 shared 根级运行时 barrel 不导出 schema。

| 契约文件 | 内容与实际消费者 |
| --- | --- |
| `auth.ts` | 邮箱登录、验证、开发登录；Auth 路由与 Web client |
| `strategy.ts` | 策略配置、创建／更新、可见性、回测、扫描、Agent 与已有路径参数；路由、业务／任务解码、Web client |
| `factor.ts` | 草稿、元数据、发布、组合、分析、相关性、报告、天气、Agent／问答；路由、业务／任务解码、Web client |
| `research.ts` | 股票池、文档／Cell、运行、封存、提案、Curator、语言服务、嵌入式分析与引用结构；路由、工具、业务解码、Web client |
| `signals.ts` | 部署、运行、分页、成交录入；路由与 Web client |
| `market.ts` | 证券序列／名称、状态与天气；路由与 Web client |
| `agent.ts` / `chart.ts` | 对话、运行查询、SQL／历史图表，以及草稿可写消息的嵌套结构；路由、Strategy／Factor 契约、Web client |

schema 自身推导两类类型，不手写对应 interface：

```ts
export type CreateStrategyRequest = z.input<typeof createStrategySchema>;
export type CreateStrategyInput = z.output<typeof createStrategySchema>;
```

请求类型采用 `Request`、`RequestQuery`、`RequestParams` 后缀。后端业务继续接收具名 output 类型；Signals 的路径
deploymentId 与 body 组合仍属于后端内部业务类型。没有输入对象的接口不人为增加空对象或新校验。

Web client 的 46 处 JSON 序列化和 22 处 query 序列化都用共享类型约束完整对象。对象入参直接使用请求类型；有意义的
标量便捷接口保留。query 统一经 URLSearchParams 编码，省略 undefined，原有空值判断保留；空格可能从 `%20` 改为 `+`，
服务端解码后的参数一致。前端只 `import type`，不执行 schema、默认值补齐或后端转换。

已有 `FactorQuestionInputV1`、`ResearchEmbeddedDraftInputV1`、`ResearchLanguageRequestV1`、`ActualExecutionUpdate`、
`RunFactorAnalysisRequest`、`PublishFactorRequest` 等名称保留为 schema 派生类型或共享请求别名。
`ResearchExecutionPromotionInputV1` 同时是业务入参，仍派生 output，保留必填 tags；HTTP 请求使用单独的 input 类型。
领域输出模型继续保持各自语义，例如完整 ChatMessage 包含的服务端消息片段不全是草稿写入接口接受的片段。

## 校验边界与兼容性

- 纯字段规则、trim、default、refine 和无宿主依赖的转换迁入 shared。query 数值字段使用 `z.coerce.number<string>()`，
  显式区分字符串输入与数字输出；这是类型约束，Zod 的运行时转换没有改变。
- Factor composite schema 的宽泛 `ZodType` 注解／断言改为 `satisfies`，避免其 input 默认为 unknown，保留完整推导。
- Auth 的邀请码规范化留在 `apps/api/src/auth/schema.ts`，复用共享字段并附加既有 transform。
- Research 的引用集合共享元素结构、数量／字节限制与默认值；后端向同一集合构造函数传入带 SDK 校验的元素 schema。
  Strategy Agent、Factor Agent、Factor 问答使用后端组合，仍在业务执行前拒绝未知 SDK 方法和非法参数。
- UTF-8 大小检查用标准 TextEncoder 替代 Buffer，JSON 序列化、字节阈值和拒绝文案不变；shared 不依赖 Node。
- Market 状态允许的指数常量移到既有 shared/market-state，由公开类型、HTTP schema 和后端查询共同使用，值和顺序不变。
- 不扩大后端接受的聊天片段，不删除持久化 JSON、Job／Worker、SDK、Agent 工具或 LLM 输出的独立校验。

删除不再有后端专属内容的 Agent / Market schema 文件和旧 chart spec 文件；调用方直接导入 shared，不留兼容转导出层。
其他业务 schema 文件仅保留必要的后端组合。项目约定、后端地图和模块 README 已同步。

## 静态检查方式

前端保留项目规定的 `strictNullChecks: false`，shared 使用严格模式。直接让前端编译 shared 源码会用前端配置重新检查它，
且旧 dist 不能代表本次改动。根级 typecheck 因此使用 `scripts/checks/typecheck-workspaces.mjs`：

1. 按 shared 自己的配置检查，生成仅存在于内存中的声明；没有 JavaScript 输出，没有落盘。
2. 从 shared package exports 读取类型入口，使用这些最新声明按各应用自己的配置执行 noEmit 检查。
3. 不回退到旧 shared dist 声明；实际运行和构建仍由既有 shared build 提供 JavaScript。

编译期断言分别位于 API tests 与 Web API 目录，覆盖默认字段的 input/output 区别、query 字符串、后端组合结构一致性、
未知 composite 输入，以及前端当前配置下必填字段／错误类型／不可写消息片段的拒绝。
TypeScript 类型不替代正则、长度、范围、refine 或服务端权限检查，也不改变前端已有的空值检查边界。

没有新增 workspace、部署组件或 workspace 构建依赖边。现有 `deploy/component-impact.json` 的 sharedPrefixes 已覆盖
新契约目录，保持原有全组件部署策略；部署计划测试增加该子路径的回归样例。shared 的新外部 Zod 依赖记录在 manifest 和 lockfile。

## 检查与验证记录

人工 review 前已完成：

- 根级 `pnpm typecheck` 通过：包含后端边界、三项已有 SDK/runtime 生成一致性，以及 shared、API、Web、Docs、sandboxd 的最新类型检查。
- 后端边界：724 个文件，2,774 条运行时边，641 条类型边，0 违规、0 跨业务循环。
- 改动 TS / TSX / MJS 的 ESLint 零警告、Prettier 与 `git diff --check` 通过。
- 对 119 个迁移变量初始化表达式做去类型／格式后的静态 AST 比较：116 个一致；3 个差异正是 Auth 邀请码后端组合、
  embeddedDraft 的 TextEncoder 替换、embeddedDataReferences 的共享集合与后端 SDK 校验组合。

人工代码 review 获确认后，下列行为验证全部通过，无需修改实现或测试：

- 18 个 API／Web 请求契约与集成测试文件，266 个用例全部通过。Agent 的两条错误日志来自预期失败场景 fixture，相关用例通过。
- 新增 13 个回归用例覆盖 input/output 默认值、query 转换、严格校验、邀请码规范化、UTF-8 字节上限、后端 SDK 校验组合，
  以及真实 Web client 的序列化、Unicode 编码、零游标与省略字段；browser bundle 确认未引入 Zod 或共享运行时校验器。
- shared、API 与 Web 构建通过。Web 构建提示部分 chunk 超过 500 kB；本次没有调整代码分块。
- 部署计划测试 9 个用例全部通过，包括新增 shared 请求契约路径触发全组件部署的回归。
- 涉及数据库的集成测试使用各自临时数据库，结束时断开连接并删除临时目录；测试进程已退出。
  Web client 回归使用内存 browser bundle 与 mock fetch，全程未启动开发服务或浏览器。

```sh
pnpm --filter @jixie/shared build
pnpm --filter api test \
  tests/api-request-contracts.test.ts \
  tests/web-request-contracts.test.ts \
  tests/agent-input-boundaries.test.ts \
  src/auth/routes.test.ts \
  src/market/routes/index.test.ts \
  src/strategy/routes/index.integration.test.ts \
  src/strategy/routes/backtest.test.ts \
  src/factor/routes/index.integration.test.ts \
  src/factor/execution/spec.test.ts \
  src/factor/questions/conversations.integration.test.ts \
  src/research/routes/index.integration.test.ts \
  src/research/datasets/universe.test.ts \
  src/research/datasets/equity.test.ts \
  src/research/embedded/lifecycle.integration.test.ts \
  src/research/embedded/data-references.test.ts \
  src/agent/routes.integration.test.ts \
  src/agent/tools/run-embedded-analysis.test.ts \
  src/signals/routes/index.integration.test.ts
pnpm --filter api build
pnpm --filter web build
node --test scripts/deploy/plan-deployment.test.mjs
```

人工 review、静态检查、行为验证与构建均已通过，使用约定信息提交；不推送。
