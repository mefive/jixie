# 宿主内的嵌入式分析

Factor / Strategy Agent 在宿主页面发起独立 Python 分析；此能力拥有私有分析、版本、异步 Job、留存输入和接续。它复用普通 Research 的 runtime、SDK、执行表和产物，保持自己的生命周期。

| 文件 / 入口 | 使用方与作用 |
| --- | --- |
| [context.ts](context.ts) `captureEmbeddedContext` | Factor/Strategy Agent 启动与版本创建；服务端检查宿主／报告权限，捕获已保存代码和上下文，不信任请求中的 owner |
| [versions.ts](versions.ts) `createEmbeddedAnalysis`、`deriveEmbeddedVersion`、`updateEmbeddedVersion` | Agent 工具创建分析；embedded 路由和 Agent 工具派生／更新版本及单 Cell 内部文档，更新检查 revision、冻结和活动运行 |
| [submit.ts](submit.ts) `submitEmbeddedRun` | 路由与 Agent；同一事务冻结源码、参数和上下文，建立 Execution/CellExecution/Job，条件占用 activeRunId |
| [job-lifecycle.ts](job-lifecycle.ts) `researchEmbeddedAnalysisLifecycle` | onExecute 解析与执行、onSuccess 保存结果；onFailure/onInterrupted 按真实关联清理 |
| [read.ts](read.ts) `getEmbeddedRun`、`getEmbeddedInput` 及 list/get 分析／版本入口 | 本人分页和快照查询；运行详情只带输入元数据，单输入入口返回完整留存响应 |
| [cancel.ts](cancel.ts) `cancelEmbeddedRun` | 路由取消；事务写终态、结束 Job 和释放占用，再中断本进程解释器 |
| [continuation.ts](continuation.ts) `continueEmbeddedResearch`、`changeEmbeddedInputMode` | 创建普通可编辑接续文档；切换 retained/current 要求文档修订并使 Python 输出过期 |

## 运行、冻结和留存

HTTP 路由与 Agent 工具在调用创建、派生、更新和提交入口前解析完整参数，业务函数接收 schema 的输出类型，负责归属、修订、冻结与运行互斥检查。工具从模型字段与宿主上下文组合参数后仍须校验；派生时若继承 parent 的数据库 JSON，则在该读取分支解析 draft，避免损坏存储进入新版本。

version + requestId 唯一，同一请求可重取；重取比较该次运行冻结的 contentRevision 与 expectedRevision，新提交才核对当前版本 revision。activeRunId 条件更新限制分析同时运行，排队即有 runId。提交后唤醒队列，执行开始后初始化并写入日志。

[execute.ts](execute.ts) 的 `executeEmbeddedRun` 每次关闭旧解释器，独立 30 秒预算覆盖运行准备、取数和 Python，排队及最终提交另计。超时／取消关闭会话并丢弃迟到结果；已发出的数据库查询不保证立即终止。source 限 20,000 字符，parameters JSON 限 16 KiB；参数显式传入，不依赖旧会话变量。

[inputs.ts](inputs.ts) 的 `embeddedInputRecorder` 在请求前留痕、响应发送给 Python 前保存实际内容。每次最多 16 请求，参数和响应累计 32 MiB，超限失败而非截断；报告输入同样留存，原来源删除不抹除已保存输入。SDK 与 [evidence](../evidence/README.md) 的单次取数和输出限制继续生效。

[finish.ts](finish.ts) 的 `completeEmbeddedRun` 在 onSuccess 事务里保存输出／图片，并在首次成功时冻结版本；缺失环境、未完成输入或保存失败不能成为成功。Job done 表示流程结束，业务成功以运行 status/errorCode 为准。失败／取消只终结尚未终结记录；启动恢复将 running 标为 cancelled/interrupted，不自动重算，queued 继续排队。

普通列表、编辑、执行、提案、Agent、固化和交接排除内部文档；私有图片仍走 evidence 的归属查询。宿主删除／公开不级联删除／公开分析。接续只接受本人成功且输入已完整保存的运行；同用户／runId 重复接续返回同一文档，并恢复已归档会话。文档默认 retained，SDK 按原输入重放，失败不回退当前数据，见 [runtime/host](../runtime/host/README.md)。切换输入模式取得文档运行锁、拒绝开放审阅，在事务中更新模式及 Python 修订／stale，变更后关闭旧会话；选择当前模式不产生修改。

改版本／幂等／取消看 [lifecycle.integration.test.ts](lifecycle.integration.test.ts)，改沙箱参数／留存看 [python.integration.test.ts](python.integration.test.ts) 和 [data-references.test.ts](data-references.test.ts)；存量关系看 [migration.integration.test.ts](migration.integration.test.ts)。设计取舍和历史验收集中在 [嵌入式分析设计](../../../../../docs/design/embedded-python-analysis.md)。

[返回 Research 总览](../README.md)

输入契约位于 [job-payload.ts](job-payload.ts)：researchEmbeddedAnalysisJobPayloadSchema / ResearchEmbeddedAnalysisJobPayload；提交与读取共用严格的 runId 对象契约。
