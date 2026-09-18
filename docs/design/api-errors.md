# API 业务错误统一

状态：人工代码审查及全部计划验证已通过，本提交完成统一错误迁移。

计划提交：`fix(api): unify business errors and HTTP failure handling`

## 阅读与调用约定

Strategy、Factor、Research、Signals、Market、Agent、Auth、Sharing、Maintenance
均在模块根目录 `errors.ts` 定义错误。业务代码直接使用：

```ts
throw new StrategyError('strategy_not_found');
throw new ResearchError('cell_revision_conflict', {
  details: { reason: 'cell_revision_changed', currentCell },
});
```

模块错误继承 `infra/errors.ts` 的 `BusinessError`，reason 在所属模块形成字面量联合。
错误定义集中决定 category 和 i18n messageKey；调用点只补动态 params、details、cause。
不提供单纯包装 throw 的函数，不保留单独的路由错误文件。定义层不导入 Hono、Prisma、LLM 或业务操作。

操作成功直接返回成功数据；预期拒绝抛出模块错误。业务内部的可选查询、没有活动任务、
最新记录不存在、幂等取消的布尔结果，以及已执行任务的成功/失败/中断状态，仍按数据表达。
这些不是请求失败，不统一改成异常。Auth 的会话检查状态仍用于 `/me` 返回合法的匿名用户。

自定义技术异常也移至模块根级 `errors.ts`，保持各自协议字段：Research Python 输出、
中断指纹、JSON-RPC code，以及 Market 上游状态码和重试信息。技术异常不继承 BusinessError，
不因为有 Error 类名就自动映射成客户端错误。原生 Error 继续用于基础设施故障和内部不变量失败；
不为 Engine 等纯内部计算目录补没有实际用途的空 errors.ts。

## HTTP 和非 HTTP 边界

`server.ts` 注册 `app.onError(handleApiError)`；映射唯一入口为 `infra/http/errors.ts`。
各业务路由只处理入参、调用及成功响应，不重复 catch 和错误转换。

| 分类 | HTTP | 响应 code |
| --- | --- | --- |
| invalid | 400 | VALIDATION_FAILED |
| missing | 404 | NOT_FOUND |
| conflict | 409 | CONFLICT |
| unauthorized | 401 | UNAUTHORIZED |
| forbidden | 403 | FORBIDDEN |
| unavailable | 503 | SERVICE_UNAVAILABLE |
| maintenance | 503 | MAINTENANCE |
| 未知异常 | 500 | INTERNAL_ERROR |

维持 `{ error: { code, message, details? } }`。HTTP 按 Accept-Language 格式化，cause 不进入响应。
未知异常打印原始诊断，仅向用户返回双语通用文案。外部 schema/JSON 校验仍是 400；
存储解码、数据库、Worker 启动等未知错误不能因为被某条路由捕获就变成 400。

用户代码校验由运行边界的 `UserCodeError` 标识，再由业务入口转为领域拒绝。
SQL Worker 仅把 SQLite 的 SQL 语句错误返回为原有诊断帧，其他故障走 Worker 失败通道；
没有改变 IPC 帧形状。原始编译/SQL 诊断作为面向作者的上下文保留，外层文案可翻译。

Job/Worker 等使用 `errorMessage(error, locale)` 在输出处翻译；仍保留用于命名、任务持久化、
通知和研究生成的 locale。CLI/Agent 没有语言上下文时使用默认英文 Error.message。
Research 嵌入式执行的持久化 errorCode、取消和输出字段保持原契约。

## 本次行为调整与兼容边界

- 忙碌、只读、发布版本变化、Signals 未就绪或暂停等预期状态拒绝统一为 409。
- 原先被路由统一包装成 400 的未知异常改为安全的 500；业务不存在统一抛 missing。
- Signals 业务函数移除错误联合，日调度在单个部署的已知业务拒绝后继续；未知异常向上报告。
- Auth 抛错前仍保存验证码失败次数；不把这段写入放进会因异常回滚的事务。
- Research 乐观并发 details 保留具体类型；已执行任务的 error 状态及输出不是 HTTP 异常。
- 保留归属检查、事务、幂等提交、上游重试、SSE、维护 Retry-After 和缓存策略。
- 不涉及数据库/schema 迁移、Research/Factor SDK、依赖、部署组件或持久化协议修改。
- 公开页面和使用步骤未增加；用户可见新错误文案已补中英双语，无需新增帮助入口。

## 验证记录

审查前仅执行静态检查：变更文件 ESLint、Prettier、全仓 `pnpm typecheck`
（含后端边界、Research Runtime/SDK、Factor SDK 生成物一致性）及 `git diff --check`。
2026-09-17：以上静态检查全部通过。后端边界扫描 724 个文件、2764 条运行时依赖、629 条类型依赖，0 违规；五个 workspace 的类型检查及三组生成物一致性均通过。变更 TS 文件 ESLint 0 告警，Prettier 和差异空白检查通过。静态检查不代替行为验证。

已准备公共错误矩阵（九模块、双语、revision details、cause 隐藏、未知/内部解码失败 500、
外部输入 400、维护响应头）、Strategy 扫描用户代码/基础设施失败分类、Agent SQL 故障隔离和 Signals 调度继续/失败测试；同步更新模块接口、归属、状态、
事务回滚、Auth 失败次数、Research 取消及运行时异常断言。

2026-09-17 人工审查批准后的验证结果：

- API 全量首轮覆盖 234 文件、1436 用例：225 文件/1407 用例通过，28 项失败，1 项会计集成按现有环境开关跳过。
- 失败原因均为验证环境或旧测试断言：系统 Python 3.14 缺少 numpy/pandas；沙箱禁止测试 Unix socket；
  部分测试仍期待旧 code 字段、中文业务 Error.message、400 分类或以 null 表示非法操作。
  修正仅涉及测试断言及运行环境，未修改人工已审查的产品代码，保留原有权限、持久化和故障断言。
- 使用项目 `.venv/research-py-v1/bin/python3`（CPython 3.13.3）及允许本地 socket 的执行环境，
  复跑失败文件和相关 Python/语言服务：15 文件、159 用例全部通过。
- 独立临时 SQLite 库初始化后启用 `ACCOUNTING_INTEGRATION=1`，会计录入/结算/重放的 1 项集成通过。
  综合首轮、复跑和这项独立集成，234 文件中的 1436 个唯一用例均已有通过结果，无待验证跳过项。
- `pnpm --filter api build` 通过；测试修正后的 API typecheck、ESLint、Prettier、差异检查通过。
- 源码和编译产物分别执行真实 SQL Worker 查询、非法列拒绝后恢复查询、底层数据库缺失故障、
  图表 isolate 成功/用户代码失败、Strategy 参数检查成功/编译诊断以及 buildApp 健康与 JSON 输入错误；全部通过。
  SQL 底层启动失败保持普通异常，用户 SQL 语句错误保持业务拒绝。
- 临时数据库已删除；验证子进程已退出，不启动常驻 API 服务，不调用真实行情、模型或邮件服务。

验证日志：`/private/tmp/jixie-api-errors-tests.log`（首轮）、
`/private/tmp/jixie-api-errors-retest.log`（复跑）、`/private/tmp/jixie-api-errors-runtime.log`（独立集成及源码/编译验证）、
`/private/tmp/jixie-api-errors-build.log`（构建）。
