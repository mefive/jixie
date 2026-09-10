# 认证

本模块拥有用户登录、邀请码消费、验证码 challenge 与 Session 生命周期，供登录 HTTP 和需要检查会话的入口使用。

- `email-login.ts`：请求验证码与验证登录；包含发送失败清理、重放保护和用户/邀请码事务。
- `session.ts`：创建、删除、查询会话；返回业务状态，不接收 Hono Context。
- `development-login.ts`：开发登录操作，仅由非生产路由注册后暴露。
- `invite-code.ts`：邀请码生成、规范化和格式校验。
- `verification-email.ts`：登录邮件模板；实际发送由 `infra/email/email.ts` 提供。
- `errors.ts`：认证操作的失败结果，不包含 HTTP 状态或框架类型。
- `routes.ts`：保持 `/api/auth/*` 的 URL、参数校验与响应。
- `cookies.ts`：Session Cookie 读写与安全属性。
- `middleware.ts`：鉴权中间件和 Hono 用户上下文声明。

现有顺序必须保留：验证码验证成功后先标记 consumed，再处理注册；创建用户和消费邀请码在同一事务内，Session 随后创建。未登录的 `/me` 返回 `{ user: null }`；受保护请求仍返回 401。生产不注册开发登录路由。

`routes.test.ts` 用全新临时 SQLite 和替代邮件传输验证注册、登录、重放、失败清理、事务回滚和 Cookie；`multi-user-permissions.test.ts` 保留跨用户业务权限回归。模块不依赖其他业务目录，HTTP 适配之外不导入 Hono。

`server.ts` 从本模块根级 `routes.ts` 导入 `authRoute` 并挂载 `/api/auth`，从 `middleware.ts` 导入 `requireAuth` 保护 `/api/app/*`。登录路由调用登录/会话业务，再通过 `cookies.ts` 设置或清除 Cookie；鉴权中间件读取 Cookie，调用 `session.ts` 解析状态，并映射为 401 或当前用户上下文。资源归属校验仍由各业务模块负责。
