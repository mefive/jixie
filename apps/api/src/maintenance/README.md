# 统一数据同步

唯一市场写流程为仓库根目录 `pnpm data sync [--to YYYYMMDD]`。省略目标时，在启动时固定上海自然日；帮助和非法参数不加载环境、Prisma 或来源。源码入口为 `cli/data.ts`，编译入口为 `dist/src/maintenance/cli/data.js`。

| 阅读入口 | 职责 |
| --- | --- |
| `cli/data.ts` / `cli/execute.ts` | 纯参数解析、环境、摘要、退出及进程资源收尾 |
| `sync.ts` | M 所有权、运行恢复、有限来源批次、事务发布和消费者编排 |
| `partitions.ts` | 数据对象、来源日历、增量/回补/重查游标及公平预算 |
| `market/synchronization/policies.ts` | 每个数据集的历史边界、时区、可完成时间与刷新周期 |
| `market/*/sync-partition.ts` | 各领域请求、原始映射、完整范围与原子经济对象证明 |
| `market/synchronization/records.ts` | 白名单市场记录合并、字段证据及精确删除授权 |
| `calculations.ts` / `market/state/eligibility.ts` | 有界失效、分组资格、私有计算和输出提交 |
| `status.ts` / `routes.ts` | 现有 `/api/maintenance/status`：运行、局部覆盖及真实发布争用 |
| `consumers.ts` | Factor 气象自身范围内的资格/重试 |
| `resources.ts` | 有归属凭据且无活跃所有者的退役资源回收 |

每轮最多 240 个来源分区、600 次实际 HTTP 请求（含内部重试）、120 个派生计算和 30 分钟。新近需求、待办、回补、旧分区巡检分别保留约 50%/25%/15%/10% 份额。来源请求分页有限，重复页和来源错误不表示完成。预算耗尽保留待办；请求错误保留退避，下一轮仍从相同固定边界继续。

运行摘要的 `calculations.attempted` 只记录本轮计算尝试；`ready` 是本轮成功数，`waiting`、`errors`、`stale` 则汇总全部持久未解决计算，包括较早目标修订影响的已有更晚结果。冷却和预算跳过不会被解释为问题已解决。

`DatasetSyncPartition` 保存完成证据、缺项与下次尝试；`DatasetSyncState` 的 `maxObservedDate` 与 `verifiedThrough` 含义不同。只有从 `historyStart` 连续证明的分区/交易观察能推进后者；计划游标不是覆盖。独立合法记录可以在 partial/error 分区中保存，未知字段保留已知值，明确授权的 null 可清除旧值。只有完整权威范围允许精确删除；完整空事件集与未知空连续序列分开处理。

原始记录、来源证据、覆盖、revision 和失效在同一事务提交。网络下载不持 P 或排他 R；M 串行化写者。短发布取得 P 和排他 R，用户业务计算全程持共享 R。市场 SQL 在私有只读输入副本中计算，提交时比较失效代次和输入 revision，输出与 ready 同事务。历史修订不受较早目标截断；它可使已存在的更晚输出失效。Index 成分/行情修订只重算对应指数族，行业归属修订不改无关指数。

缺复权、估值或涨跌停不阻止合法价格保存。派生指标按自己的必要输入显示 null/等待；原始最大日期和非零行数不能证明正式截面完整。财务指标追加实际捕获版本，公告日期不能替代当前值的可得日期；分红经济除权日与当前值捕获时间分开。旧 FactorReport 和封存 Research 输入不被市场修订覆盖。

旧 maintenance daily/weekly/repair、import:data、sync 子任务、canonicalize 公开入口和整轮候选协议已退役。旧 Maintenance* 表保留历史及部署门禁用途，不作为新同步完成事实。旧候选只在数据库与磁盘协议凭据一致、文件范围已知且无活跃 owner 时回收；未知资源保留并报告，不自动恢复旧流程。

生产保留一个 `jixie-maintenance.timer`，上海时间每两小时的 :15 调用统一 sync；旧 weekly timer 在升级时停用。部署先完成迁移/重启并释放 P/R，再执行一轮有限同步；空库或来源缺口不影响应用准入。状态 `active` 只表示真实发布互斥，错误/待办不会封站。

实现设计、迁移审阅顺序和 A01–A14 验收见 [统一同步设计](../../../../docs/design/unified-data-sync.md)。本轮行为测试和迁移 SQL 生成等待 Gate 2，尚未执行。
