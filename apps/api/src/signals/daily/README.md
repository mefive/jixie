# 每日信号编排

[scheduler.ts](scheduler.ts) 提供两个入口：`runDailySignalCycle` 供 CLI 使用，默认取上海当前日期，先 `syncSignalMarketData` 再生成；`generateDailySignals` 供它和 Maintenance 调用，接受已确定的交易日与日志函数，检查开市、全局结算账户，再按 deployedAt 顺序为活动部署入队并等待各次完成，汇总成功／跳过／失败。整批没有总事务。

[sync.ts](sync.ts) 的 `syncSignalMarketData` 拥有“当天这些部署需要什么数据”的业务编排，数据同步实现仍归 Market：

- 加载活动部署源码元数据和冻结依赖；核心未发布时补 SSE 日历至后续 14 天，并检查当天开市。
- 核心未发布时依次调用 `syncDaily`、`syncDailyBasic`、`syncStkLimit`。这里当前不调用四表原子发布的 `syncDailyCoreDate`，不能混写它们的事务保证。
- 有冻结国债曲线依赖时同步最近 21 个日历日；资金流和龙虎榜按策略声明／源码使用决定，已发布扩展数据可跳过。
- 合并研究 registry ETF 与部署关注 ETF，再调用 `syncEtfMarketDate`。

`coreAlreadyPublished`、`extensionsAlreadyPublished` 是上游已完成同步时的跳过标记，`refresh` 传给扩展数据同步。日期、PIT 可得性和各数据集事务仍按 [Market](../../market/README.md) 的契约；调度不把整个同步串联变成原子发布。

[CLI](../cli/run-signals.ts) 负责参数、退出码和 Prisma 收尾，用法以 [脚本入口说明](../../../scripts/README.md) 为准。改编排先对照 [Maintenance daily](../../maintenance/workflows/daily.ts) 的直接调用及 [runs](../runs/README.md)、[accounting](../accounting/README.md) 的集成测试；基础数据门槛与依赖期限分别看 runs/readiness 和 [rates.test.ts](../factor-inputs/rates.test.ts)。

[返回 Signals 总览](../README.md)
