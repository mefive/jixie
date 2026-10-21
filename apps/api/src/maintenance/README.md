# Maintenance 后端阅读入口

维护分为不阻塞正式库的候选准备、短暂关闭共享准入的原子发布，以及独立重试的发布后处理。数据规则沿用 [Market](../market/README.md)，具体设计见 [暂存发布](../../../../docs/design/maintenance-staging-publication.md) 和 [锁协议](../../../../docs/design/maintenance-locking.md)。

| 入口／文件 | 职责 |
| --- | --- |
| [cli/run-maintenance.ts](cli/run-maintenance.ts) | daily、weekly、repair；内部 sync/import/代码归一转交；参数、进程和数据库收尾 |
| [staging/coordinator.ts](staging/coordinator.ts) | M 所有权、固定目标、候选恢复、P/R 发布、正式事务凭据、后续动作及清理 |
| [staging/tables.ts](staging/tables.ts) | 显式市场白名单、依赖和稳定业务键；不包含用户数据 |
| [staging/snapshot.ts](staging/snapshot.ts) | 同一正式读快照，复用迁移后的 schema，仅复制声明的市场数据 |
| [staging/changes.ts](staging/changes.ts) | 冻结增删改、内容哈希、财报版本／不可变期货规则、Prisma 差量回填 |
| [staging/impact.ts](staging/impact.ts) | 按实际输入字段、变更前后记录及滚动依赖确定输出日期和指标类别 |
| [staging/finalize.ts](staging/finalize.ts) | 统一计算受影响输出、检查派生完整性，再执行综合审计 |
| [workflows/daily.ts](workflows/daily.ts) | 候选内日更、最近 5 日自愈、首次初始化、既有质量与水位规则 |
| [workflows/weekly.ts](workflows/weekly.ts) | 低频参考、财报／ETF 断点、自愈、派生计算和整体审计 |
| [workflows/repair.ts](workflows/repair.ts) | 默认最近 20 个已完成交易日，或指定区间；按需补缺，显式 --refresh 才重拉 |
| [workflows/import.ts](workflows/import.ts) | 同一候选内按年份／数据域导入，保存阶段断点并初始化基线 |
| [runs/state.ts](runs/state.ts) | 控制记录、心跳、checkpoint；状态展示与正式发布事实分开 |
| [middleware.ts](middleware.ts) | HTTP 真实共享准入；SSE／取消不持市场读锁 |
| [infra/coordination](../infra/coordination/market-access.ts) | TS＋fs-ext 跨进程 M/P/R、读作用域和工作所有权 |

正式库的 protocol=2 控制行使用 `candidate:ID`；running/error 不构成封站依据。数据维护的 active 来自实际发布意图锁；首次未初始化、数据库技术故障和旧协议遗留错误分别处理。旧错误不能仅靠升级自动解封，完整候选审计通过并正式发布后才可标记 revalidated。

准备失败保留候选和断点，不写正式市场表。代码、schema、基线或依赖变化时废弃旧候选并重建同一目标；默认日期绑定原尝试时间。所有候选写进程持有独立所有权引用，IPC 父进程失踪即退出，恢复不能仅信 running、PID 或文件存在。

daily 与 repair 在逐日处理前共用指数成员准备：按月查询目标区间，只写目标区间快照及首日确有需要的最近前置锚点，保留来源原始日期。`MAINTENANCE_INDEX_WEIGHT_MAX_AGE_DAYS`（默认 190 个自然日）是新鲜度／锚点查找上限，不是历史回填写入范围。空月响应可复用有效本地快照；没有合格锚点、过期、无效快照或来源错误仍失败。现有 tradeDate as-of 口径不等于已证明资料的历史公开时点。

repair 同时更新股票主表和名称历史，避免新增行情缺少证券身份。短区间审计仍从本地真实历史读取完整 60 日价格窗口；市场风险审计按实际完整向量数向前扩展，保持 252 个观测要求和 PIT 约束。历史确实不足时仍报错。完整审计报告保存在候选 repair 记录的 `summary.audit` 中，不能将单日完成日志等同于整轮发布成功。

普通 daily 计算本轮待处理交易日，repair 计算指定区间；真实历史输入变化再按依赖扩展到已有输出。StockBasic、StockNameHistory、StockCodeChange 不是指标 SQL 输入，不触发历史重算。股票收盘价／复权因子按变更前后有效序列传播至后续最多 59 条观察，指数价格传播至后续 20 条；成员快照影响到下一快照前，行业成员按变更前后实际命中的有效成员比较。指数或行业资料单独变化时，只替换对应指标类别，不能顺带重建其他指数。

CLI 候选流程统一在 finalize 完成一次计算、派生完整性检查、综合审计，逐日步骤保留原始数据校验；repair 审计终点不再被旧水位截断。预热历史只作为计算或审计输入，不自动成为输出范围。未引入全历史指数价格补齐；真正受影响历史仍须通过派生检查，缺少必要价格会失败，不忽略。repair 仍保留原日水位，正式发布以凭据、修订与实际区间覆盖核对。

发布按 M→P 排他→R 排他，停止新准入后等待完整业务结束；queued 不持 R。HTTP、Job、Agent、Research 和 Factor Weather 持 R 到结果写入完成。超时／事务回滚后释放本次门禁，正式凭据与市场增删改、水位、dataRevision、待处理动作一次提交。用户、账户、成交及研究数据不从候选回填。

信号／账户结算和因子气象在释放 M/P/R 后按当前正式数据取得独立 R；各工作还持跨进程所有权，启动恢复跳过其他进程的活任务。后续动作失败保持发布成功事实，不封站；后续维护调用补执行。Research 空闲 Python 会话按 dataRevision 失效。成功候选清理、当前失败候选保留，废弃候选保留 7 天；锁文件始终保留原 inode。

原始股票／指数、ETF、财报 PIT、商品及派生质量阈值保持。财报子进程仍在逐项持久化后 ACK；weekly 仍保留源缺失观察与 derived-invalidation 断点。原始修复已完成而派生尚未完成时，最终差量比较仍能找出影响起点，避免重试漏算。

本轮无新 timer、HTTP 写入口、用户表或 migration。范围修复已完成人工审阅、696 项相关回归和工作区构建，并真实发布 20260731～20260909 的 29 个 SSE 交易日：正式修订 5，审计 0 错误／6 警告，日水位按 repair 契约保留 20260730。发布前后的区间外三类历史派生表指纹一致；运行及验证证据见设计记录末节。
