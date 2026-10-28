# Market 后端阅读地图

业务错误统一在 [errors.ts](errors.ts) 定义，调用点直接抛出模块错误；HTTP 分类与翻译由公共边界完成。约定及例外见 [错误设计](../../../../docs/design/api-errors.md)。

Market 拥有行情与领域数据的身份、获取、同步、查询和基础质量。Research 数据集、Factor 观察值、Strategy/Engine 数据加载消费这些能力；统一分区计划与发布编排归 [Maintenance](../maintenance/README.md)。

## 按业务问题进入

| 要找什么 | 子能力与责任 |
| --- | --- |
| ETF 与境内指数的共同身份 | [registry](registry/README.md)：固定标识与来源支持范围；[下载名单](downloads/README.md) 由管理员 CLI 维护 |
| 股票历史代码、名称和证券解析 | [instruments](instruments/README.md)：纯身份、查库解析与有写入的代码合并 |
| Tushare 参数、限流、重试和能力探测 | [providers/tushare](providers/tushare/README.md)：通道与供应商映射 |
| 开市日和上海收盘截止 | [calendar](calendar/README.md)：日历同步、读取和 SSE 已完成日 |
| 股票名录、日行情、估值与交易限制 | [stocks](stocks/README.md)：范围同步及核心四表发布 |
| ETF 全量目录、名单内行情与复权 | [etfs](etfs/README.md)：按名单回补、增量与覆盖质量 |
| 指数成员、精简收盘响应 | [indices](indices/README.md)：指数原始数据与专用读取 |
| 质量结果契约与交易日覆盖摘要 | [quality](quality/README.md)：跨数据域共用的 finding 与统计，不含维护发布策略 |
| 跨资产图表行情 | [queries](queries/README.md)：股票／ETF／指数统一对象序列 |
| 指数官方估值与历史展示 | [valuation](valuation/README.md)：覆盖目录、数据读取与纯计算 |
| 财报来源、版本、PIT、财务指标与分红 | [fundamentals](fundamentals/README.md)：同步、版本选择、标准化和审计 |

## 主要协作流程

CLI 或 Maintenance 调用各数据域同步：通过 provider 取候选，使用 registry/instruments 统一身份，按该数据集规则校验、计算可得日并持久化。原始质量、派生指标和整体发布的组合由 Maintenance 控制，单函数成功不代表整轮已发布。

HTTP 从查询能力读取已有数据；Research 再做 SDK 字段与 PIT 投影，Factor/Strategy 在自己的流程中决定研究或运行准入。Market 提供境内日历和基础质量事实，消费者判断自己的数据要求。

## 模块入口与共同约束

[routes/index.ts](routes/index.ts) 导出 `marketRoute`，组合 instrument / valuation，挂载 `/api/app/market`；[共享请求契约](../../../../packages/shared/src/api/market.ts) 校验查询输入。HTTP 映射数据／null／空序列，业务查询不依赖 Hono 或用户会话。完整路径及精简指数响应区别见 [路由设计](../../../../docs/design/api-route-naming.md#剩余模块路由整理2026-09-11) 和相应能力文档。

[cli](cli/) 负责参数、配置、输出、退出与 Prisma 收尾，命令用法统一维护在 [API 命令索引](../../scripts/README.md)。providers 只是组织目录，fundamentals/fixtures 由其父能力说明；不为纯目录层新增入口或导出。

同步、只读查询、纯计算须按实际函数区别；不同数据集保持不同的空响应、覆盖和事务规则。availableDate、观测日、公告日、抓取版本不可混用，缺失不等于零。共享身份不包含供应商解析／写库。Market 不反向调用 Strategy、Agent、Research 或 Maintenance。

整体 HTTP 用例在 [routes/index.test.ts](routes/index.test.ts)，各数据域测试就近链接。架构与约束见 [后端架构](../../../../docs/backend-architecture.md)、[依赖边界](../../../../docs/backend-boundaries.md)；目录及共享身份整理的历史结果见 [架构重构记录](../../../../docs/design/backend-architecture-refactor.md)、[服务边界设计](../../../../docs/design/core-business-service-boundaries.md)。

当前唯一市场写流程是 `pnpm data sync [--to YYYYMMDD]`。各领域 `sync-partition.ts` 准备来源批次，`synchronization/` 接纳合法独立记录并保存字段/覆盖证据；旧任务选择式 CLI、整轮候选和隐式 Signals 下载已退役。分区覆盖、计算资格与统计/模型门槛分别报告。
