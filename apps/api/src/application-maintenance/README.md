# Application Maintenance 后端阅读入口

Application Maintenance 编排整轮数据维护：获取运行权、补齐数据、检查质量、发布水位、记录进度并恢复中断。具体数据获取与计算调用 [Market](../market/README.md)；按日信号交给 Signals。

CLI 是调用方式，本模块负责影响全应用的数据更新顺序、发布条件及可用性。HTTP 门禁读取维护运行状态，部署也以 `kind=deploy` 使用同一记录；定时触发由 systemd 提供。

## 从入口阅读

| 文件 | 职责与调用 |
| --- | --- |
| [daily.ts](daily.ts) | `runDailyMaintenance`：刷新日历、确定已完成交易日、补齐缺口/自愈、同步原始数据、校验、计算派生指标、发布水位和后续信号；无缺口时保留原有信号重试分支 |
| [weekly.ts](weekly.ts) | `runWeeklyMaintenance`：股票/指数/行业/ETF 参考数据、财报与分红等周维护；按运行项 checkpoint 恢复 |
| [baseline-repair.ts](baseline-repair.ts) | `repairBaseline`：修复截止日前的基线数据并按影响重算，不创建维护运行或发布水位；与 daily 的基线发布不同 |
| [financial-history-import.ts](financial-history-import.ts) | `importFinancialReferenceHistory`：选择历史报告期和未导入分红证券，顺序分批调用 Worker；不写全局运行 checkpoint |
| [repair.ts](repair.ts) | `runRepairMaintenance`：明确区间的修复与重算 |
| [self-heal.ts](self-heal.ts) | 检查已发布日期的缺口，制定修复项并调用 Market 同步，重新检查原始质量 |
| [etf-recovery.ts](etf-recovery.ts) | 每次按 registry 上市/退市区间全历史查缺，逐日补缺；周修订按运行/日期恢复 |
| [state.ts](state.ts) | 维护运行/项目记录、心跳、状态、发布水位与 dataRevision；恢复中断运行 |
| [quality.ts](quality.ts) | `validateRawMarketDate` 与 `validateDerivedMarketRange`：整轮发布前的原始/派生数据质量门禁 |
| [data-audit.ts](data-audit.ts) | 汇总市场、各数据领域与风险输入审计 |
| [risk-data-audit.ts](risk-data-audit.ts) | 组合 Market 数据质量与 Strategy 模型历史要求，避免 Market 反向依赖 Strategy |
| [routes.ts](routes.ts) | 实现状态查询路由，具名导出 `maintenanceRoute` 供 server 挂载 |
| [middleware.ts](middleware.ts) | 单独导出 `maintenanceGate`，供 server 通过 `app.use` 注册；维护期间设置 Retry-After 并返回维护错误 |
| [reference-worker-process.ts](reference-worker-process.ts) | 将参考数据分批交给真实子进程，接收 summary 并检查退出结果；根据源码/编译入口选 `.ts`/`.js` |
| [reference-worker.ts](reference-worker.ts) | 配置 Tushare 客户端，调用 Market 的财报/指标/分红同步，每项完成写 checkpoint；CLI 主入口最终释放 Prisma |
| [daily-schedule.ts](daily-schedule.ts)、[财报分期规则](../market/fundamentals/reference-periods.ts) | 开市日调度判断和参考数据的分期/断点规则 |
| [证券代码合并](../market/instruments/canonicalize-stock-codes.ts) | 数据中历史股票代码的规范化维护 |

日维护的普通发布链路是：原始同步 → `validateRawMarketDate` → 派生指标重算 → `validateDerivedMarketRange` → `advanceDailyWatermark` 或 `bumpDataRevision`。数据替换事务由各同步函数控制；发布水位由 Application Maintenance 控制，不把整轮网络同步包进一个数据库事务。初始化、无缺口信号重试及历史修复保留各自分支。

CLI 入口为 [cli/run-maintenance.ts](cli/run-maintenance.ts)；根级 `pnpm maintenance` 经 [with-maintenance-lock.sh](../../../../scripts/maintenance/with-maintenance-lock.sh) 执行。单项数据同步 CLI 直接调用 Market 的具体文件；维护进程启动与中断恢复仍由现有启动/部署入口负责，本轮不改变锁、时间、水位和进程协议。

## 命令与领域归属

- [cli/run-maintenance.ts](cli/run-maintenance.ts) 对应 `pnpm maintenance` 的 daily/weekly/repair/baseline 子命令；参数、输出和 Prisma 收尾归 CLI。
- [cli/sync-fina.ts](cli/sync-fina.ts) 对应 `pnpm --filter api sync:fina`；全量分支调用历史导入，单股分支继续调用 Market 财报修复。全量导入传空运行 ID，weekly 使用运行 checkpoint，两者不合并。
- 证券代码合并及其 [CLI](../market/cli/canonicalize-stock-codes.ts)、财报分期规则归 Market；weekly 调用结果来决定重算和发布。
- `reference-worker.ts` 同时调用财报同步并记录可选运行 checkpoint；`data-audit.ts` 包含汇总和具体数据检查，`quality.ts` / `self-heal.ts` 也含领域检查与发布策略。当前保留这些混合实现，具体领域规则应归 Market，跨模块就绪条件和整轮发布决策归本模块；目录迁移不代表需要全面拆解。
- 模块别名为 `#application-maintenance/*`。命令名、HTTP URL、维护状态模型和锁路径继续使用已有契约。

## 恢复与发布安全

- weekly 的审计截止日为 `dailyPublishedThrough`，不是运行当天；weekly 不负责推进日发布水位。
- weekly 自愈中 `MAINTENANCE_MAX_AUTO_REPAIR_DATES` 是进度汇报批大小，不再是整次运行上限。每个日期修复后重查，仍有缺口立即失败，避免无进展空转；daily 保留原有限额。
- 历史变更前写入 `MaintenanceCheckpoint` 的 `derived-invalidation`。即使进程中断、重试时原始缺口已消失，也仍重算派生数据。当前采用保守的全已发布历史失效范围，因此派生重算可能较长，不承诺短时间恢复。
- weekly 的 ETF 历史检查从 2015 年（或上市日）到发布水位，按年份分批读取、按代码/日期分别比对日线、复权、份额。只向有缺口的数据接口请求，事务中只插入仍缺的键，不删除或覆盖已有行；不再用年度完成标记证明覆盖。审计复用同一检查，也能发现区间内部缺口。
- 孤立无日线和历史份额源缺失保留为空并记录在本轮 `no-daily` / `no-share` 检查项中；它们不是数据已齐的标记，也不证明停牌或交易所未发布。新 weekly 再次查询；同轮重试不重复请求已确认的源缺失。复权缺失、广泛日线缺失仍阻塞，审计的首尾覆盖错误不豁免。
- 最近 252 日是独立的上游修订回查窗口，不是补缺边界；修订按日期 checkpoint。历史缺口在每次重试时重新扫描，已有修订 checkpoint 不能遮蔽新缺口。
- bootstrap 不再调用独立 ETF 历史恢复脚本；由既有 weekly 流程承担补齐、审计和发布。初次导入与既有其他 bootstrap 数据检查不在这次变更中重写；恢复仍遵守维护锁和 Gate。
- `WeeklyMaintenanceSummary` 保留审计边界、恢复进度和非 pass finding。财报非正资产/股数仍为阻塞，附源行 ID；仓单空响应只说明未取到数据，不能据此认定交易所未发布。部分月份响应仅替换实际返回日期，不删除其他已存日期。
- 不新增 timer。确定性错误仍保留 Gate 并暴露原因；不得用清空维护状态、改水位或降级阈值绕过。
