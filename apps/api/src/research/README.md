# Research 后端阅读地图

业务错误统一在 [errors.ts](errors.ts) 定义，调用点直接抛出模块错误；HTTP 分类与翻译由公共边界完成。约定及例外见 [错误设计](../../../../docs/design/api-errors.md)。

Research 提供带 Markdown / Python Cell 的研究文档、可回看的执行证据和 Agent 辅助编辑，也承载 Factor / Strategy 宿主内的嵌入分析。市场同步归 Market，交接后的草稿写入归目标模块，通用对话循环归 Agent。

## 按业务问题进入

| 要找什么 | 子能力与责任 |
| --- | --- |
| 文档列表／详情、创建、归档和编辑 Cell | [documents](documents/README.md)：内容、修订及旧会话详情补建兼容 |
| 变量依赖、下游 stale 和删除阻塞 | [dependencies](dependencies/README.md)：AST 分析、失效协调与纯运行计划 |
| 单 Cell、全文、受影响分支、取消／重置 | [document-runs](document-runs/README.md)：普通同步执行、文档锁与结果回写 |
| Python 会话如何复用和释放 | [runtime](runtime/README.md)：会话管理、串行通信、能力协商 |
| 宿主中的分析版本、Job、输入留存和接续 | [embedded](embedded/README.md)：独立生命周期及 retained/current 模式 |
| 冻结完整执行、固化和私有图片 | [evidence](evidence/README.md)：快照、哈希、产物和归属读取 |
| Agent 修改如何审阅、接受／撤回、尝试 | [proposals](proposals/README.md)：修订绑定、消息同步、尝试与澄清 |
| Python 读取市场数据／私人报告 | [datasets](datasets/README.md)：字段和 PIT 切片；[results](datasets/results/README.md)：业务结果授权与独立映射 |
| SDK 请求怎样校验、取数、重放 | [sdk](sdk/README.md)：纯参数解析与有副作用的分派、留存输入回放 |
| 找数据、概念、支持的方法和来源 | [catalog](catalog/README.md)：可发现能力、语义绑定与来源决策 |
| 编辑器补全、诊断和跨 Cell 符号 | [language](language/README.md)：Pyright、虚拟文档和 stub |
| 新文档示例内容 | [templates](templates/README.md)：模板选择；[FCFF](templates/fcff/README.md)：分类证据和回放案例 |
| 固化研究生成因子／策略草稿 | [handoff](handoff/README.md)：证据准入、生成与目标模块协作 |
| Research 对话启动 | [agent](agent/README.md)：文档上下文、澄清和 attempt 解释 |
| 整理已有研究发现及人工反馈 | [curator](curator/README.md)：候选准备、后台发布和反馈查询 |

## 主要协作流程

编辑经 documents 保存修订，再由 dependencies 更新关系、stale/blocked。document-runs 取得进程内文档锁，通过 runtime 执行；Python 请求交给 sdk，再由 datasets 读取市场或私有报告。干净全文运行冻结开始时的源码和 DAG，evidence 保存完整结果，成功后可固化并交接。

Agent 提案通过 proposals 审阅；接受不会自动运行，用户明确发起 attempt 后才走执行计划。attempt 是尝试记录，不替代完整证据。handoff 先查询已有目标草稿，未命中才校验证据并生成，目标模块保存结果。

embedded Job 独立管理版本、取消、预算和输入留存，复用 runtime／SDK／产物；接续生成普通文档后可用原输入重放。Curator 是另一类 Job，事务外生成候选，完成事务内查重发布发现；两者不改变普通文档直接等待执行结果的方式。

## 模块入口与共同约束

[routes/index.ts](routes/index.ts) 导出 `researchRoute`，组合 document / execution / evidence / proposal / agent / curator / data / language / embedded 九组，挂载 `/api/app/research`。[schema.ts](schema.ts) 是 API 输入校验，[errors.ts](errors.ts) 定义执行／审阅业务错误和运行时技术异常，公共 HTTP 边界负责映射；具体业务函数和直接调用方见各子文档。路由迁移范围见 [设计记录](../../../../docs/design/api-route-naming.md#research-路由职责整理2026-09-11)，嵌入入口见其能力说明。

普通文档与嵌入内部文档共用部分存储和 runtime，但授权及生命周期分开；普通固化／交接不能读内部嵌入文档。修订号防止旧结果覆盖新内容，冻结快照不随编辑改变。单进程运行锁、数据库事务、Python 通信队列是不同机制，不能互相替代。

SDK 的参数错误、数据查询失败和输入回放失败有不同边界；公开 Contract 来自 shared，不复制 ORM 字段作为协议。各调用链的事务、取消和资源收尾以子能力说明为准，运行路径见 [运行清单](../../../../docs/backend-runtime-entries.md)。整体权限／HTTP 场景在 [routes/index.integration.test.ts](routes/index.integration.test.ts)。

背景与历史验收见 [Commit 6](../../../../docs/design/backend-architecture-refactor.md#76-commit-6-实现与验证记录2026-09-081bba29cd)、[服务边界设计](../../../../docs/design/core-business-service-boundaries.md)、[嵌入分析设计](../../../../docs/design/embedded-python-analysis.md)。旧备份的迁移限制仍有效，详见 [一次性迁移退役记录](../../../../docs/design/backend-architecture-refactor.md#一次性数据迁移退役2026-09-09)。跨模块依赖规则见 [后端边界](../../../../docs/backend-boundaries.md)。
