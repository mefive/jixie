# 因子定义与草稿

这里拥有可编辑因子的身份、源码、展示元数据及内置定义。分析记录归 [evaluations](../evaluations/README.md)，发布状态转换归 [publication](../publication/README.md)，定义删除不立即删除保留报告。

## 调用入口

| 文件 / 入口 | 消费者与用途 | 输入、返回与副作用 |
| --- | --- | --- |
| [catalog.ts](catalog.ts) `listFactorCatalog`；[read.ts](read.ts) `listOwnedFactors`、`readFactorDefinition` | 定义路由读取目录、列表及详情 | 按 userId 选择可读内容；详情可调用 runtime 检查目标资产，不能当成仅有数据库读取的投影 |
| [drafts.ts](drafts.ts) `createFactorDraft`、`updateFactorDraft`、`deleteFactorDraft`、`copyFactorDraft` | 定义路由的草稿操作 | 校验身份、语言与分析类型；修改已发布定义须遵循草稿状态规则，复制产生自己的草稿 |
| [metadata.ts](metadata.ts) `refreshOwnedFactorMetadata` | 定义路由显式刷新 | 检查所有者和 draft，缺失／非草稿报业务错误；调用模型并更新展示元数据 |
| 同文件 `refreshFactorMetadata`、`generateFactorMetadata` | Factor Agent 完成回调；生成器供刷新复用 | 低层刷新遇到不存在／非草稿直接返回；生成器返回元数据、不保存定义。模型调用与写入不在一个总事务内 |
| [from-research.ts](from-research.ts) `findResearchFactorDraft`、`createFactorDraftFromResearch` | Research handoff 先查复用，再传入生成结果 | 按用户和 sourceExecutionId 复用；创建接收代码、messages、来源元数据，返回目标信息及 reused，不调用生成器 |
| [seed.ts](seed.ts) `seedBuiltinFactors` | bootstrap 启动时等待初始化 | 仅补缺失内置版本，已有代码、状态及发布关联不变；不是查询目录时的自动动作 |

## 文件与规则

[builtin-factors.ts](builtin-factors.ts) 保存静态定义、内置 key 和 `builtinCatalog`；[views.ts](views.ts) 只做 strategy key、语言和分析类型映射；[fields.ts](fields.ts) 定义输入字段及适用资产。三者不经 seed 或 publication 取得纯事实。代码模板见 [templates](templates/README.md)，编译检查见 [sandbox](../sandbox/README.md)。

Research 创建负责最多 100 次 key 尝试、32 字符限制与 `_2` 后缀，同时避开 Factor、Composite 和内置 key；P2002 后发现相同源执行的并发胜者则返回 reused，其他冲突继续尝试，未知数据库错误抛出。普通复制使用 [copy-key.ts](copy-key.ts) 的 `nextCopyKey`，保留 `_v2` 规则，不能拿交接命名规则替换。

元数据 HTTP 入口和低层刷新各做一次前置检查，不能把它描述为模型调用后再次校验源码／状态的原子更新。定义读取和复制仅允许本人及内置因子，内置因子的作者上下文不对外提供。

## 修改定位

- 草稿权限、复制与归属校验：drafts/read 与 [路由集成测试](../routes/index.integration.test.ts)。
- 内置定义及种子：[builtin-factors.test.ts](builtin-factors.test.ts)、[seed.integration.test.ts](seed.integration.test.ts)。
- 元数据或 Research 交接：[metadata.test.ts](metadata.test.ts)、[from-research.test.ts](from-research.test.ts)，并读 [Research handoff](../../research/handoff/README.md)。

[返回 Factor 总览](../README.md)

内置源码升级使用新 key；目录、定义、分析与 Agent 上下文均读取数据库保存的版本，静态模板仅供初始化。
