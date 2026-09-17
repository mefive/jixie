# Web API 模块

前端按业务直接导入请求函数，例如 `@src/api/strategy` 的 `submitBacktest`、
`@src/api/research` 的 `getResearchDocument`。模块间不建立总转导出入口。

| 文件 | 责任 |
| --- | --- |
| `client.ts` | JSON 请求、查询序列化、`ApiError`、维护和服务不可用事件 |
| `auth.ts` | 当前用户、开发登录、邮箱登录和退出 |
| `maintenance.ts` | 维护状态类型和状态查询 |
| `agent.ts` | 通用 turn/会话查询、取消、SSE 订阅与解析、历史 SQL/计算图表 |
| `strategy.ts` | 策略定义、可见性、回测报告与任务、参数扫描、策略 Agent |
| `signals.ts` | 部署、信号运行、任务查询和实际执行记录 |
| `factor.ts` | 因子与组合、发布、分析报告、holdout、相关性、天气、因子 Agent/问答 |
| `market.ts` | 证券和指数序列、名称、估值、市场状态与天气 |
| `sharing.ts` | 公开库目录和公开策略复制 |
| `research.ts` | 文档/Cell、执行与交接、提案、研究 Agent、Curator、数据查询与语言服务 |
| `research-embedded.ts` | 嵌入式分析、版本、草稿、运行、保留输入和继续研究 |
| `client.typecheck.ts` | 编译期请求约束断言，直接引用各业务模块 |

业务专属 Agent 请求随所属业务放置；通用 SSE 协议放在 `agent.ts`。请求输入继续从
`@jixie/shared/api/<业务>` 仅导入类型，输出复用 shared 的领域类型。模块内专属类型随实现保留，
不新增集中式 `types.ts`。Signals 的任务查询沿用现有 `BacktestJob` 返回类型，通过 `import type`
引用 Strategy；通用错误通知仅以类型引用 `MaintenanceStatus`，不产生反向运行时依赖。

业务请求依赖 `client.ts`，不复制错误处理。SSE 保留原有直接 fetch 和流式解析；复用通用错误通知，
保持原来的取消、语言头、Cookie 和非 JSON 错误行为。添加接口时按业务归属选模块，调用方直接导入。
