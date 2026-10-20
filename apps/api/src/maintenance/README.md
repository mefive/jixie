# Maintenance 后端阅读入口

维护分为不阻塞正式库的候选准备、短暂关闭共享准入的原子发布，以及独立重试的发布后处理。数据规则沿用 [Market](../market/README.md)，具体设计见 [暂存发布](../../../../docs/design/maintenance-staging-publication.md) 和 [锁协议](../../../../docs/design/maintenance-locking.md)。

| 入口／文件 | 职责 |
| --- | --- |
| [cli/run-maintenance.ts](cli/run-maintenance.ts) | daily、weekly、repair；内部 sync/import/代码归一转交；参数、进程和数据库收尾 |
| [staging/coordinator.ts](staging/coordinator.ts) | M 所有权、固定目标、候选恢复、P/R 发布、正式事务凭据、后续动作及清理 |
| [staging/tables.ts](staging/tables.ts) | 显式市场白名单、依赖和稳定业务键；不包含用户数据 |
| [staging/snapshot.ts](staging/snapshot.ts) | 同一正式读快照，复用迁移后的 schema，仅复制声明的市场数据 |
| [staging/changes.ts](staging/changes.ts) | 冻结增删改、内容哈希、财报版本／不可变期货规则、Prisma 差量回填 |
| [staging/finalize.ts](staging/finalize.ts) | 依据实际原始变更重算历史影响范围，执行最终校验 |
| [workflows/daily.ts](workflows/daily.ts) | 候选内日更、最近 5 日自愈、首次初始化、既有质量与水位规则 |
| [workflows/weekly.ts](workflows/weekly.ts) | 低频参考、财报／ETF 断点、自愈、派生计算和整体审计 |
| [workflows/repair.ts](workflows/repair.ts) | 默认最近 20 个已完成交易日，或指定区间；按需补缺，显式 --refresh 才重拉 |
| [workflows/import.ts](workflows/import.ts) | 同一候选内按年份／数据域导入，保存阶段断点并初始化基线 |
| [runs/state.ts](runs/state.ts) | 控制记录、心跳、checkpoint；状态展示与正式发布事实分开 |
| [middleware.ts](middleware.ts) | HTTP 真实共享准入；SSE／取消不持市场读锁 |
| [infra/coordination](../infra/coordination/market-access.ts) | TS＋fs-ext 跨进程 M/P/R、读作用域和工作所有权 |

正式库的 protocol=2 控制行使用 `candidate:ID`；running/error 不构成封站依据。数据维护的 active 来自实际发布意图锁；首次未初始化、数据库技术故障和旧协议遗留错误分别处理。旧错误不能仅靠升级自动解封，完整候选审计通过并正式发布后才可标记 revalidated。

准备失败保留候选和断点，不写正式市场表。代码、schema、基线或依赖变化时废弃旧候选并重建同一目标；默认日期绑定原尝试时间。所有候选写进程持有独立所有权引用，IPC 父进程失踪即退出，恢复不能仅信 running、PID 或文件存在。

发布按 M→P 排他→R 排他，停止新准入后等待完整业务结束；queued 不持 R。HTTP、Job、Agent、Research 和 Factor Weather 持 R 到结果写入完成。超时／事务回滚后释放本次门禁，正式凭据与市场增删改、水位、dataRevision、待处理动作一次提交。用户、账户、成交及研究数据不从候选回填。

信号／账户结算和因子气象在释放 M/P/R 后按当前正式数据取得独立 R；各工作还持跨进程所有权，启动恢复跳过其他进程的活任务。后续动作失败保持发布成功事实，不封站；后续维护调用补执行。Research 空闲 Python 会话按 dataRevision 失效。成功候选清理、当前失败候选保留，废弃候选保留 7 天；锁文件始终保留原 inode。

原始股票／指数、ETF、财报 PIT、商品及派生质量阈值保持。财报子进程仍在逐项持久化后 ACK；weekly 仍保留源缺失观察与 derived-invalidation 断点。原始修复已完成而派生尚未完成时，最终差量比较仍能找出影响起点，避免重试漏算。

本轮无新 timer、HTTP 写入口、用户表或 migration。静态检查后须人工代码审阅，再执行隔离数据库、跨进程故障、编译和 UI 验证；不连接生产库执行维护。
