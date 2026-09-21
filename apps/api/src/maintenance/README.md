# Maintenance 后端阅读入口

业务错误统一在 [errors.ts](errors.ts) 定义，调用点直接抛出模块错误；HTTP 分类与翻译由公共边界完成。约定及例外见 [错误设计](../../../../docs/design/api-errors.md)。

Maintenance 编排整轮数据维护：获取运行权、补齐数据、检查质量、发布水位、记录进度并恢复中断。具体数据获取与计算调用 [Market](../market/README.md)；按日信号交给 Signals。

CLI 是调用方式，本模块负责影响全应用的数据更新顺序、发布条件及可用性。HTTP 门禁读取维护运行状态，部署也以 `kind=deploy` 使用同一记录；定时触发由 systemd 提供。

## 目录组织

- `cli/`：命令行适配。
- `workflows/`：日／周维护、区间与基线修复、自愈编排和调度策略。
- `runs/`：运行记录、checkpoint、心跳、恢复、锁和在途任务等待。
- `publication/`：发布水位、质量门禁、整体／跨业务审计和成功部署版本。
- 根级 `routes.ts` / `middleware.ts`：HTTP 适配；`errors.ts`：业务错误。

测试跟随实现；不保留旧根级转发文件。Market 的具体数据规则不因 Maintenance 的目录分组而迁回。

## 从入口阅读

| 入口 | 职责 |
| --- | --- |
| [cli/run-maintenance.ts](cli/run-maintenance.ts) | daily / weekly / repair / baseline 参数、输出、进程退出与 Prisma 收尾 |
| [daily.ts](workflows/daily.ts)、[daily-schedule.ts](workflows/daily-schedule.ts) | 日维护、初始化发布、无缺口信号重试和节假日调度策略 |
| [weekly.ts](workflows/weekly.ts) | 周维护顺序、修复前 derived-invalidation、恢复回调、派生重算和发布 |
| [repair.ts](workflows/repair.ts)、[baseline-repair.ts](workflows/baseline-repair.ts) | 历史区间与基线修复编排；基线修复不创建运行或推进水位 |
| [coordination.ts](runs/coordination.ts) | 生产锁校验、等待 Job / Agent / Factor Weather 安静窗口；所有维护流程直接调用 |
| [state.ts](runs/state.ts) | 运行记录、心跳、checkpoint 与恢复 |
| [watermark.ts](publication/watermark.ts) | 发布水位与 dataRevision；状态门禁读取这些发布事实 |
| [self-heal.ts](workflows/self-heal.ts) | 组合股票与指数修复计划，控制批次，先记录失效再调用业务修复，复查进度 |
| [gate.ts](publication/gate.ts) | 发布时选择权重最大年龄，组合 Market 的股票与指数质量检查 |
| [audit.ts](publication/audit.ts)、[risk-audit.ts](publication/risk-audit.ts) | 选择审计范围、汇总各域报告，组合 Market 数据事实与 Strategy 模型要求 |
| [routes.ts](routes.ts)、[middleware.ts](middleware.ts)、[deployment-version.ts](publication/deployment-version.ts) | HTTP 状态、维护门禁和成功部署版本 |

## 数据能力与恢复边界

- 财报历史导入、分批父进程和 Worker 位于 [Market fundamentals](../market/fundamentals/README.md)，`sync fina` 位于 [Market CLI](../market/cli/sync-fina.ts)。Worker 只同步数据并报告逐项完成，不接收维护 runId，也不写 MaintenanceCheckpoint。周维护通过 `onItemComplete` 保存 checkpoint，父进程写入成功后才确认；子进程收到确认才处理下一项。普通导入使用同一协议但不记录维护 checkpoint。
- ETF 全历史查缺、缺失来源观察和修订位于 [Market etfs/recovery](../market/etfs/recovery.ts)。Maintenance 为调用提供当前运行的已完成项读取、完成记录和进度回调；scope 指纹和旧 key 格式保持。
- 股票缺口检查与修复在 [stocks/repair](../market/stocks/repair.ts)，指数部分在 [indices/repair](../market/indices/repair.ts)。自愈编排不自行查询或解释市场表。具体检查阈值保持，日维护修复上限和周维护 drain 策略仍由调用方决定。
- 原始质量归 stocks / indices，派生指标质量归 [state/quality](../market/state/quality.ts)；业务检查失败向上传播，Maintenance 不推进水位。整体审计中的数据规则位于各 Market 子域 `audit.ts`；共享 finding 与覆盖摘要归 [Market quality](../market/quality/README.md)，不反向依赖维护模块。
- 交易日查询统一调用 [Market calendar](../market/calendar/read.ts)，已发布截止日由 Maintenance 选择。指数／行业成员同步及变更起点由 [indices/membership-sync](../market/indices/membership-sync.ts) 返回；商品持仓的合约和行情前置同步归 [commodity/holding-sync](../market/commodity/holding-sync.ts)。

日维护发布顺序仍是原始同步 → 原始质量检查 → 派生重算 → 派生质量检查 → 水位／dataRevision → 后续信号；数据事务由 Market 所属业务控制。
CLI、HTTP URL、环境变量、systemd 和锁路径不变；不新建调度器、公共包或数据库模型。重构记录见 [业务归属整理](../../../../docs/design/maintenance-business-boundaries.md)。

## 恢复与发布安全

- 部署只检查维护状态，不启动 daily/weekly。首次部署通过 `daily --initialize-only` 验证已导入基线后退出，不继续补到今天；`daily --resume-only` 只恢复已有任务，无待恢复任务则退出。
- 默认 daily 优先恢复最早未完成目标，不扩展其 endDate；无旧目标时以上海 23:00 为新日任务边界，再按 SSE 日历选交易日，不直接用自然日减一作为交易日。
- 在自愈、历史窗口刷新及行情写入之前，为整个待补区间检查 registry 与部署引用 ETF 的候选覆盖。候选驻留本轮内存并用于发布，避免预检成功后重新请求得到缺失响应。只有新任务或原 `waiting` 任务可记录 `waiting/waiting_source`；旧 error 不降级。状态 API 可返回 `active=false` 与 waiting 元数据，旧水位继续可用。
- 预检不是所有来源的完整快照隔离。进入行情写入之后的失败、weekly/repair 失败仍保守封站；历史遗留错误不因升级而自动解锁。待补区间较长时预检请求和内存占用随区间增长。
- daily 以 30 分钟间隔持续重试（包括锁冲突及技术错误），无启动次数上限；重复确定性错误仍须人工排障，日志不被吞掉。weekly 重试策略不变。

- weekly 的审计截止日为 `dailyPublishedThrough`，不是运行当天；weekly 不负责推进日发布水位。
- weekly 自愈中 `MAINTENANCE_MAX_AUTO_REPAIR_DATES` 是进度汇报批大小，不再是整次运行上限。每个日期修复后重查，仍有缺口立即失败，避免无进展空转；daily 保留原有限额。
- 历史变更前写入 `MaintenanceCheckpoint` 的 `derived-invalidation`。即使进程中断、重试时原始缺口已消失，也仍重算派生数据。当前采用保守的全已发布历史失效范围，因此派生重算可能较长，不承诺短时间恢复。
- weekly 的 ETF 历史检查从 2015 年（或上市日）到发布水位，按年份分批读取、按代码/日期分别比对日线、复权、份额。只向有缺口的数据接口请求，事务中只插入仍缺的键，不删除或覆盖已有行；不再用年度完成标记证明覆盖。审计复用同一检查，也能发现区间内部缺口。
- 孤立无日线和历史份额源缺失保留为空并记录在本轮 `no-daily` / `no-share` 检查项中；它们不是数据已齐的标记，也不证明停牌或交易所未发布。新 weekly 再次查询；同轮重试不重复请求已确认的源缺失。复权缺失、广泛日线缺失仍阻塞，审计的首尾覆盖错误不豁免。
- 最近 252 日是独立的上游修订回查窗口，不是补缺边界；修订按日期 checkpoint。历史缺口在每次重试时重新扫描，已有修订 checkpoint 不能遮蔽新缺口。
- bootstrap 不再调用独立 ETF 历史恢复脚本；由既有 weekly 流程承担补齐、审计和发布。初次导入与既有其他 bootstrap 数据检查不在这次变更中重写；恢复仍遵守维护锁和 Gate。
- `WeeklyMaintenanceSummary` 保留审计边界、恢复进度和非 pass finding。原始财报非正资产/股数为 warning，摘要包含数量，明细附源行 ID，不单独阻塞整站发布；不改写源值，所选版本的会计诊断及相关指标无效值保护不变。PIT/结构及其他必需数据错误仍阻塞。仓单空响应只说明未取到数据，不能据此认定交易所未发布。部分月份响应仅替换实际返回日期，不删除其他已存日期。
- 不新增 timer。确定性错误仍保留 Gate 并暴露原因；不得用清空维护状态、改水位或降级阈值绕过。
