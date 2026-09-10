# Maintenance 后端阅读入口

Maintenance 编排整轮数据维护：获取运行权、补齐数据、检查质量、发布水位、记录进度并恢复中断。具体数据获取与计算调用 [Market](../market/README.md)；按日信号交给 Signals。

## 从入口阅读

| 文件 | 职责与调用 |
| --- | --- |
| [daily.ts](daily.ts) | `runDailyMaintenance`：刷新日历、确定已完成交易日、补齐缺口/自愈、同步原始数据、校验、计算派生指标、发布水位和后续信号；无缺口时保留原有信号重试分支 |
| [weekly.ts](weekly.ts) | `runWeeklyMaintenance`：股票/指数/行业/ETF 参考数据、财报与分红等周维护；按运行项 checkpoint 恢复 |
| [repair.ts](repair.ts) | `runRepairMaintenance`：明确区间的修复与重算 |
| [self-heal.ts](self-heal.ts) | 检查已发布日期的缺口，制定修复项并调用 Market 同步，重新检查原始质量 |
| [state.ts](state.ts) | 维护运行/项目记录、心跳、状态、发布水位与 dataRevision；恢复中断运行 |
| [quality.ts](quality.ts) | `validateRawMarketDate` 与 `validateDerivedMarketRange`：整轮发布前的原始/派生数据质量门禁 |
| [data-audit.ts](data-audit.ts) | 汇总市场、各数据领域与风险输入审计 |
| [risk-data-audit.ts](risk-data-audit.ts) | 组合 Market 数据质量与 Strategy 模型历史要求，避免 Market 反向依赖 Strategy |
| [routes.ts](routes.ts) | 实现状态查询路由，具名导出 `maintenanceRoute` 供 server 挂载 |
| [middleware.ts](middleware.ts) | 单独导出 `maintenanceGate`，供 server 通过 `app.use` 注册；维护期间设置 Retry-After 并返回维护错误 |
| [reference-worker-process.ts](reference-worker-process.ts) | 将参考数据分批交给真实子进程，接收 summary 并检查退出结果；根据源码/编译入口选 `.ts`/`.js` |
| [reference-worker.ts](reference-worker.ts) | 配置 Tushare 客户端，调用 Market 的财报/指标/分红同步，每项完成写 checkpoint；CLI 主入口最终释放 Prisma |
| [daily-schedule.ts](daily-schedule.ts)、[reference-periods.ts](reference-periods.ts) | 开市日调度判断和参考数据的分期/断点规则 |
| [canonicalize-stock-codes.ts](canonicalize-stock-codes.ts) | 数据中历史股票代码的规范化维护 |

日维护的普通发布链路是：原始同步 → `validateRawMarketDate` → 派生指标重算 → `validateDerivedMarketRange` → `advanceDailyWatermark` 或 `bumpDataRevision`。数据替换事务由各同步函数控制；发布水位由 Maintenance 控制，不把整轮网络同步包进一个数据库事务。初始化、无缺口信号重试及历史修复保留各自分支。

CLI 入口为 [scripts/maintenance/run-maintenance.ts](../../scripts/maintenance/run-maintenance.ts)；根级 `pnpm maintenance` 经 [with-maintenance-lock.sh](../../../../scripts/with-maintenance-lock.sh) 执行。单项数据同步 CLI 直接调用 Market 的具体文件；维护进程启动与中断恢复仍由现有启动/部署入口负责，本轮不改变锁、时间、水位和进程协议。
