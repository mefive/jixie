# 统一数据同步

市场数据统一同步入口为仓库根目录 `pnpm data sync [--to YYYYMMDD]`；管理员名单与 ETF 选池命令见文末下载名单说明。省略目标时，在启动时固定上海自然日；帮助和非法参数不加载环境、Prisma 或来源。源码入口为 `cli/data.ts`，编译入口为 `dist/src/maintenance/cli/data.js`。

| 阅读入口 | 职责 |
| --- | --- |
| `cli/data.ts` / `cli/execute.ts` | 纯参数解析、环境、摘要、退出及进程资源收尾 |
| `sync.ts` | M 所有权、运行恢复、有限来源批次、事务发布和消费者编排 |
| `partitions.ts` | 数据对象、来源日历、增量/回补/重查游标及公平预算 |
| `market/synchronization/policies.ts` | 每个数据集的历史边界、时区、可完成时间与刷新周期 |
| `market/*/sync-partition.ts` | 各领域请求、原始映射、完整范围与原子经济对象证明 |
| `market/synchronization/records.ts` | 白名单市场记录合并、字段证据及精确删除授权 |
| `status.ts` / `routes.ts` | 现有 `/api/maintenance/status`：运行、局部覆盖及真实发布争用 |
| `resources.ts` | 有归属凭据且无活跃所有者的退役资源回收 |

每轮最多 240 个来源分区、600 次实际 HTTP 请求（含内部重试）和 30 分钟。新近需求、待办、回补、旧分区巡检分别保留约 50%/25%/15%/10% 份额。来源请求分页有限，重复页和来源错误不表示完成。预算耗尽保留待办；请求错误保留退避，下一轮仍从相同固定边界继续。


`DatasetSyncPartition` 保存完成证据、缺项与下次尝试；`DatasetSyncState` 的 `maxObservedDate` 与 `verifiedThrough` 含义不同。只有从 `historyStart` 连续证明的分区/交易观察能推进后者；计划游标不是覆盖。独立合法记录可以在 partial/error 分区中保存，未知字段保留已知值，明确授权的 null 可清除旧值。只有完整权威范围允许精确删除；完整空事件集与未知空连续序列分开处理。

原始记录、来源证据、覆盖和 revision 在同一事务提交。网络下载不持 P 或排他 R；M 串行化写者。短发布取得 P 和排他 R，用户业务计算全程持共享 R。期货发布、商品连续收益及其派生计算框架已退役。历史专属状态在维护锁与短发布事务中清理；保留来源的覆盖和 revision 继续生效。

缺复权、估值或涨跌停不阻止合法价格保存。派生指标按自己的必要输入显示 null/等待；原始最大日期和非零行数不能证明正式截面完整。财务指标追加实际捕获版本，公告日期不能替代当前值的可得日期；分红经济除权日与当前值捕获时间分开。旧 FactorReport 和封存 Research 输入不被市场修订覆盖。

旧 maintenance daily/weekly/repair、import:data、sync 子任务、canonicalize 公开入口和整轮候选协议已退役。旧 Maintenance* 表保留历史及部署门禁用途，不作为新同步完成事实。旧候选只在数据库与磁盘协议凭据一致、文件范围已知且无活跃 owner 时回收；未知资源保留并报告，不自动恢复旧流程。

生产保留一个 `jixie-maintenance.timer`，上海时间每两小时的 :15 调用统一 sync；旧 weekly timer 在升级时停用。部署先完成迁移/重启并释放 P/R，再执行一轮有限同步；空库或来源缺口不影响应用准入。状态 `active` 只表示真实发布互斥，错误/待办不会封站。

实现设计、迁移审阅顺序和 A01–A14 验收见 [统一同步设计](../../../../docs/design/unified-data-sync.md)。历次裁剪与本轮名单行为测试已通过 Gate 2 后验收；迁移仅在隔离库验证，开发与生产库未应用。

ETF 与指数对象来自 `MarketDownloadList`，不合并研究 registry 或策略 watch。首次 ETF 初始化使用最新同日规模前 100，后续 sync 不重选；index 首次保留五个基准代码。移出后连已有 pending 分区都停止请求。ETF 初始化失败单独报错，股票与财报仍可继续。`index-catalog`、`etf-shares` 已退役，锁内清理对应维护记录和历史份额证据键。CLI 见 [下载名单](../market/downloads/README.md)。
