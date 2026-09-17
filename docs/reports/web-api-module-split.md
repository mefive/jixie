# Web API 按业务拆分

## 范围与状态

- 2026-09-17：拆分范围与人工代码 review 均已获确认；静态检查、构建和行为验证通过，随本提交交付。
- 固定提交信息：`refactor(web): split API client by business domain`。
- 从单一 `apps/web/src/api/client.ts` 拆出 10 个业务模块，保留通用请求设施。
- 迁移 28 个调用文件（包含编译期断言），同步前端约定；模块地图见 `apps/web/src/api/README.md`。
- 面向代码维护者，没有新增用户入口。HTTP 路径、参数、请求体、共享类型约束、错误事件和 SSE 行为保持原状。
- 不涉及后端、数据库、公开 SDK、依赖或部署组件变化。

## 实现取舍

业务函数名称与签名保留，调用方直接从业务模块导入，不保留业务总转导出入口。
通用请求与错误设施继续位于 `client.ts`。业务专属 Agent 请求随业务归属；通用流协议和历史图表归 Agent。
嵌入式分析有独立的版本与运行生命周期，因此与普通 Research 请求分文件。

类型依赖维持既有语义：Signals 继续使用 Strategy 的 `BacktestJob`，通用错误设施仅以类型引用
Maintenance 状态。这两处不引入反向运行时依赖，也不借重构改变返回契约。

本次开始实施时工作区干净，基线提交为 `90de8824`；此前策略页面重命名已经提交。

## 审查前静态验证

- 静态 AST 比对：151 个声明保持一致，仅 5 个通用辅助函数增加 export；无声明遗漏或增加。
- 对 28 个调用文件去除导入后做 AST 比对，实现保持一致；导入名称、别名和类型导入性质保持一致。
- `pnpm typecheck` 通过：shared、API、Web、Docs、sandboxd 全部通过；包含后端边界及三项 SDK/runtime 生成一致性检查。
- 改动 TS/TSX 的 ESLint（`--max-warnings 0`）、Prettier 检查与 `git diff --check` 全部通过。

上述比对只解析源码，没有执行应用或业务函数。

## 审查通过后验证

以下验证已在人工代码 review 通过后完成：

1. `pnpm --filter @jixie/shared build`、`pnpm --filter web build` 均通过。
2. 对生产构建的临时 Vite preview（`127.0.0.1:5187`）执行两项浏览器验证：
   - `test:e2e:login-error`：非 JSON 网关错误被转换为本地化错误，没有泄漏 JSON 解析错误。
   - `test:e2e:maintenance-fallback`：服务不可用时阻断页面，恢复后自动返回原认证路由并保留 query，无浏览器 pageerror。
3. 检查了 `apps/web/acceptance/login-service-unavailable.png`、`maintenance-service-unavailable.png`、
   `maintenance-service-recovered.png`。登录请求收到 502 后按现有逻辑显示全局服务不可用遮罩。
4. 浏览器已由测试 finally 关闭；临时预览服务已停止，确认 5187 无监听。未启动后端或数据库连接。

登录测试首次因缺少启动时的维护状态 mock，被全局遮罩阻挡而失败。仅在
`apps/web/e2e/login-error.mjs` 补齐正常维护状态 fixture，保留原有断言；该测试文件的 ESLint、Prettier
通过，重跑通过，没有修改产品代码。

构建报告 embedded-analysis-card 的静态/动态混合导入及大 chunk 警告，未阻断构建；
相关组件和打包配置不在本次改动内。本轮浏览器验证覆盖请求错误及恢复链路，未重跑全部业务 E2E。
