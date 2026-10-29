# 保留数据的最小同步

唯一日常写入口是 `pnpm data sync [--to YYYYMMDD]`，管理员另用 ETF／指数名单 CLI。省略目标时固定启动时的上海自然日；帮助和非法参数不读环境、不连接数据库。源码入口 [cli/data.ts](cli/data.ts)，生产入口 `dist/src/maintenance/cli/data.js`。

| 阅读入口 | 职责 |
| --- | --- |
| [cli/data.ts](cli/data.ts) / [cli/execute.ts](cli/execute.ts) | 参数、环境、摘要、退出及连接收尾 |
| [sync.ts](sync.ts) | 写者所有权、参考资料、数据集轮换、实际尝试、短发布与摘要 |
| [partitions.ts](partitions.ts) | 每次选择一个近期窗口或最早历史缺口，不写计划 |
| [status.ts](status.ts) / [routes.ts](routes.ts) | 当前名单覆盖、运行与真实发布争用 |
| [Market policies](../market/synchronization/policies.ts) / [scopes](../market/synchronization/scopes.ts) | 16 个数据集的时期、来源规则、名单及上市／退市边界 |
| [Market prepare](../market/synchronization/prepare.ts) / [rows](../market/synchronization/rows.ts) | 显式领域分派、纯内存缺值合并；各领域 `write.ts` 用有类型的 Prisma 写自己的表 |

先更新日历与目录，再轮换数据集。一次轮到某数据集，最多一个近期窗口和一个历史缺口；对象按上次实际尝试时间轮换，失败也记时间。同窗口每轮最多请求一次。每轮仍最多 240 个窗口、600 次实际 HTTP（含重试）、30 分钟；最近运行摘要记录下个数据集位置，只保留当前和上次运行。

近期修订范围与来源刷新频率沿用 policies。已完成且超出近期范围的历史不再自动巡检；未完成历史仍补齐。管理员可用较早 `--to` 重取附近历史，不截断已存较新数据。没有比例预算、多级持久退避、预写 pending 队列或计划游标。

`DatasetSyncPartition` 只记录真实尝试的边界、状态、缺口、错误和时间；`DatasetSyncState` 只保留两个轮换时间、最大观察日和连续 `verifiedThrough`。pending 是已尝试未完成数，零 pending 不代表全部历史完整。覆盖从实际匹配 policyVersion 的完成窗口推导；失败重查撤销重叠旧资格，保留合法值。正式消费者仍独立检查自己的输入。

未返回字段和未知 null 保留旧值，明确清空的 null 才可覆盖。部分响应保存合法独立记录，完整成分快照和财报对象保持原子；只有已核验完整的精确范围可删除缺席记录。分红当前值捕获时间直接存 Dividend.observedAt／availabilityQuality；同值重抓和代码接续保留原时间，真实修订更新捕获时间。财报追加版本、SDK 列和 PIT 日期不变。

同步持 M，网络期间不持 P 或排他 R。发布持 P／排他 R，业务数据、窗口资格、覆盖与全局 revision 在同一事务提交；无实际数据／资格变化不递增 revision。Research 跨查询读锁及修订后会话重建保持。只有真实发布争用封锁新计算；空库、历史缺口和来源错误不封站。Job／Agent owner 锁继续清理。

旧通用来源证据、动态表 delegate、变化数组、候选资源扫描、计算副本和四张退役元数据表已从新实现移除。未知旧目录交由管理员核对，后台不递归删除。MaintenanceRun 仅为部署记录保留。

旧库升级必须走 [一次性导出／恢复脚本](../../scripts/upgrade-minimal-sync.mjs) 与 [bootstrap](../../../../scripts/bootstrap.sh)：排空停服，导出受限恢复文件并备份，应用原样生成迁移，恢复并核对分红捕获时间／revision、重算覆盖，再启动 API。任何中途失败保留恢复文件和停服状态；重新部署沿用原文件。不能对旧库直接裸迁移后开放服务。具体命令见 [脚本索引](../../scripts/README.md)。

生产每两小时 :15 的 timer 沿用。ETF／指数对象来自 [下载名单](../market/downloads/README.md)，空名单不自动重置，移出停止请求且保留历史。完整设计和待验收范围见 [裁剪计划第 5 节](../../../../docs/design/system-simplification-plan.md#5-数据维护重新设计)。本轮已通过人工 review、五 workspace 构建、完整回归、隔离迁移及中英浏览器验收；实际结果见裁剪计划第 28.4 节，开发／生产库未应用迁移。

ETF 目录跳过待上市产品；退市名单代码仅补至有效退市日，缺日期时以代码级缺口报告并跳过，不阻断其他对象。旧无依赖待上市目录由 bootstrap 在停服升级阶段离线清理，详见 [ETF 维护设计](../../../../docs/design/etf-data-maintenance.md)。
