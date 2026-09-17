# Factor 后端阅读地图

Factor 拥有因子定义、组合、正式评估、holdout、发布和持续观察。Research 可交接草稿或读取结果，Strategy 消费可用因子，通用 Agent 执行对话；因子的所有权、状态和准入由本模块决定。

## 按业务问题进入

| 要找什么 | 子能力与责任 |
| --- | --- |
| 因子目录、草稿、复制、元数据、Research 交接 | [definitions](definitions/README.md)：可编辑定义与身份；[templates](definitions/templates/README.md)：各分析类型的模板构造 |
| 组合定义和组件如何协作 | [composition](composition/README.md)：组合读写、复制及组合计算／来源 |
| 何时允许发布、归档或公开 | [publication](publication/README.md)：报告证据、源码和状态核对 |
| 输入数据从哪里来、何时可得 | [observations](observations/README.md)：各资产与 PIT 观察值、截止日 |
| 提交分析、读报告、holdout 与统计 | [evaluations](evaluations/README.md)：冻结正式报告和 Job 生命周期 |
| 计算如何被评估和天气复用 | [execution](execution/README.md)：共享计算与 Worker；[cross-sectional](execution/cross-sectional/README.md)：数据、序列、政策、统计及推断 |
| 因子间相关性如何缓存 | [correlations](correlations/README.md)：独立任务与缓存，不创建正式报告 |
| 来源、快照和哈希在哪里定义 | [sources](sources/README.md)：纯来源与指纹、需要查库的来源解析 |
| 如何查询任务归属 | [jobs](jobs/README.md)：独立 kind 与报告关系，不拥有业务生命周期 |
| 定义检查和双语言执行 | [runtime](runtime/README.md)：共享验证／提示词；[TypeScript](runtime/typescript/README.md)、[Python](runtime/python/README.md)：各自编译、协议与资源 |
| 固定因子版本、持续观察 | [weather](weather/README.md)：pin、月度结果与独立刷新状态 |
| 编辑对话和私有只读问答 | [agent](agent/README.md)：草稿 authoring；[questions](questions/README.md)：稳定因子身份、私有历史与上下文 |

## 主要协作流程

普通分析由 evaluations 接收来源与研究配置，冻结报告并入队；其 Job 调用 execution，后者通过 observations 和 runtime 计算，结果回到评估生命周期保存。相关性只复用横截面数据／序列；天气复用计算 Worker，各自持有产物和状态。

探索报告可进入 holdout，完成后需揭示才能读取封存内容；publication 核对证据与当前代码／运行时后发布。Strategy 的 [因子准备](../strategy/factor-inputs/README.md) 消费已批准来源，草稿编辑不会让旧报告自动证明新代码。

编辑 Agent 使用本人草稿上下文并在完成后刷新元数据；只读 questions 建立独立私有会话。Research [handoff](../research/handoff/README.md) 负责证据准入与生成，definitions 负责目标草稿复用、命名和持久化。

## 模块入口与共同约束

[routes/index.ts](routes/index.ts) 具名导出 `factorRoute`，组合 definition / composite / agent / analysis / correlation / weather 六组路由，挂载 `/api/app/factors`。路由处理参数、用户／locale 和 HTTP 映射；[schema.ts](schema.ts) 定义输入校验，[errors.ts](errors.ts) 定义共用业务拒绝，具名函数及主要调用方见子能力说明。完整 HTTP 路径见 [路由设计](../../../../docs/design/api-route-naming.md)。

定义、冻结报告、后台 Job、相关性缓存和天气 pin 是不同对象。访问控制在相应业务入口完成；低层计算／来源函数不能替代授权。公开读取不能泄露作者私有消息或研究来源；holdout 的报告与日志封存由 evaluations 统一处理。

各生命周期保持自己的事务和收尾，提交后才唤醒相应队列；天气刷新不属于通用 Job。Worker、isolate 和 Python 路径以 [运行清单](../../../../docs/backend-runtime-entries.md) 为准。整体 HTTP 回归定位在 [routes/index.integration.test.ts](routes/index.integration.test.ts)，能力算法／状态测试见各 README。

跨模块规则见 [后端边界](../../../../docs/backend-boundaries.md)。背景与历史验收集中在 [架构重构记录](../../../../docs/design/backend-architecture-refactor.md#77-commit-7-实现与验证记录2026-09-08014899ba)、[内部结构设计](../../../../docs/design/core-business-internal-structure.md)、[服务边界设计](../../../../docs/design/core-business-service-boundaries.md) 和 [路由迁移记录](../../../../docs/design/api-route-naming.md#factor-路由职责整理2026-09-10)。
