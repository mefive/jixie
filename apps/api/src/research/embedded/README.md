# Embedded Python analysis

Factor／Strategy 对话通过 `runEmbeddedAnalysis` 创建可编辑 Python 草稿及内部单 Cell 文档。内部文档不进入普通 Research 列表、编辑、Agent 或执行接口；分析、结果与图片始终按用户授权。

| 入口 | 职责 |
| --- | --- |
| `versions.ts` | 创建、复制、更新草稿，检查归属、revision 和活动任务；成功后仍可更新 |
| `submit.ts` | 原子占用 activeRunId；按 version/requestId 幂等；Job payload 暂存本次代码、参数和 revision；替换该版本先前的终态运行与 Job |
| `execute.ts`、`job-lifecycle.ts` | 用临时输入启动干净 Python 会话，处理取消、超时和运行状态 |
| `finish.ts` | 终态事务保存输出、释放占用并清空 Job payload；失败、取消和启动回收同样清空 |
| `read.ts` | 读取当前草稿代码及最近运行输出；run.revision 与 version.revision 不同表示输出过期 |
| `continuation.ts` | 复制当前代码和参数到普通文档，运行时重新取数；重复接续打开同一副本 |

执行预算为 30 秒、16 次 SDK 请求、累计响应 32 MiB，由 Bridge 在内存中检查，不保存请求与响应。握手元数据仅用于运行能力协商，不保存环境指纹。图片归属与私有读取见 [outputs](../outputs/README.md)。

新提交只保留该草稿最近一次运行，不保证旧聊天卡片中的 runId 永远可用；被清理的旧 ID 明确返回不存在。源码不作为历史快照展示。报告只保留可选 ID，读取仍受当前报告存在性和权限约束，不存整份报告上下文。

升级前排队的旧 Job 缺少新的临时输入结构，会明确失败并释放占用，用户需重新提交；不从旧证据还原输入。没有成功后冻结、输入留存、retained/current 模式或自动交接。
