# 后端依赖边界门禁

入口是 [check-backend-boundaries.mjs](../scripts/check-backend-boundaries.mjs)，命令为 `pnpm check:backend-boundaries`。根级 `pnpm typecheck` 和 `pnpm build` 先执行该静态门禁，再执行已有 SDK 检查与各 workspace 命令。检查失败退出码为 1，不启动应用、不连接数据库。

## 检查什么

扫描 `apps/api/src`、`apps/api/scripts` 和 `apps/api/tests` 的 TS/JS/MJS 文件。使用已有 TypeScript AST 和 API tsconfig 路径解析，支持 `.js` → `.ts`、路径 alias、静态 import、重导出、字面量动态 import、import type 查询和 require。

- Hono 只出现在路由、HTTP 辅助与启动适配；业务操作不能反向导入 HTTP 文件。HTTP 不直接导入 Prisma，业务操作可以使用 Prisma。Auth 的根级 `routes.ts`、`cookies.ts` 与 `middleware.ts` 属于 HTTP 适配，`session.ts` 属于会话业务；Cookie 与中间件按精确文件路径识别，不放行整个 auth 目录。
- `infra/runtime`、`infra/jobs` 不能直接或经基础设施中转反向依赖业务。
- `index → bootstrap → server` 为启动依赖方向；业务/CLI 不导入整应用启动模块。
- Engine simulation/data/factors/types 核心不能导入宿主适配器、数据库、HTTP 或任务流程。4 条现有纯契约依赖逐条登记。
- Math/date/i18n 只依赖纯辅助、shared 契约和已有 dayjs 能力；Market registry 不依赖数据库、通道或同步。
- Market 不能直接或间接回调 Strategy、Research、Agent、Signals 或 Maintenance。整体审计由 Maintenance 组合。
- 应用根目录不新增汇总实现的重导出 barrel。旧顶层 lib/routes/services/store/tushare/data-quality/types/risk/library 等模块不可重新出现；fundamentals/rates/macro/commodity 只保留在 Market 内。
- 生产代码不能导入 `.test`、`.spec`、`.test-worker`、testing 目录或 `apps/api/tests`。测试本身可跨边界构造 fixture，但仍检查语法与导入是否能解析。`apps/api/tests` 承载包级配置与跨模块应用契约测试；模块内测试继续与源码同目录。
- 通过强连通分量寻找跨业务模块的运行时循环；字面量动态导入也加入循环图，不因延迟执行就忽略。

类型边指显式 `import type`、全部 type 绑定、type 重导出和 import 类型查询；混合导入保守记为运行时边。类型边仍受所有权约束，但不形成运行时循环。2026-09-09 收尾扫描为 650 个文件、2313 条运行时边、576 条类型边，跨业务运行时循环为 0。

## 4 条既有纯依赖

[backend-boundaries.json](../scripts/backend-boundaries.json) 保存完整源路径、目标路径、类型/运行时种类和原因，不使用目录通配放行。

| 源 → 目标（省略 `apps/api/src/`） | 理由 |
| --- | --- |
| `engine/data/engine-data.ts` → `market/instruments/stock-identity.ts` | 历史证券身份的纯规则，不查询市场数据库 |
| `engine/factors/custom-factor.ts` → `factor/runtime/typescript/sdk.ts` | 仅使用 Factor 编写契约类型 |
| `engine/factors/custom-factor.ts` → `factor/definitions/fields.ts` | 复用字段常量与纯函数 |
| `engine/simulation/run.ts` → `market/registry/index-presets.ts` | 复用纯静态基准代码 |

例外目标也被检查：不能新增宿主或业务流程依赖，避免允许的契约变成绕过边界的入口。例外不再使用时门禁报错，要求删除过时记录。循环基线目前为空；如果今后确需例外，必须解释具体边，新增循环边不会因节点落在旧循环里而自动放行。

这些例外不是遗留数据库耦合，不需要为消除目录之间所有箭头而复制字段、搬到 common 或重写业务。

API 跨顶层模块使用 `package.json#imports` 的 `#infra/*` 等原生别名。检查器读取 API tsconfig 的 `development` 条件，将别名解析到源码后执行相同的所有权与循环检查；未知别名或不存在的内部目标也报 `unresolved-import`，不能作为外部依赖绕过门禁。

## 检查的界限

本工具检查模块依赖，不证明函数无副作用，也不推断所有 JavaScript 行为。外部包的内部依赖由包与 bundle 验证负责；不解析任意 `eval`、字符串拼接或 require 别名。没有解析到的相对 import 会报错；非字面量动态 import 单独列出，当前 8 项均为 `.boot.mjs`。

Worker URL、fork 路径、esbuild entry、Python/Prisma/Pyright 的资源目录另见 [运行入口清单](backend-runtime-entries.md)。这些不能用“类型检查已通过”代替实际启动。根级命令不自动运行行为测试，保持本项目先静态检查、人工 review 后验证的工作流。

修改门禁后，人工 review 通过再执行 `pnpm test:backend-boundaries`。正式用例使用临时目录构造合法/非法依赖，覆盖别名解析、类型与动态边、HTTP/Infra/Market/Engine 规则、例外变脏/过时、新增循环、测试边界和语法错误。用例不依赖本仓库恰好有多少行代码或多少文件。
