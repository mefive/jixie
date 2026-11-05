# 指数与精简收盘读取


保留的指数和历史股票池代码集合来自 [registry/index-presets.ts](../registry/index-presets.ts)，供应商字段来自 providers/tushare/api。指数成分按历史快照选择；不能只用当前成员回填历史分析。官方估值展示由 [valuation](../valuation/README.md) 负责。

[read.ts](read.ts) 的 `loadIndexSeries(tsCode, start, end)` 供 instrument 路由的 `/indices/:indexCode/series` 使用，只返回 `{ points: [{ date, close }] }`。默认区间在路由确定，无数据仍是空数组；不要与 [instrumentSeries](../queries/README.md) 的完整对象响应合并。

改官方估值适配看 [index-daily-basic-api.test.ts](../providers/tushare/index-daily-basic-api.test.ts)，索引清单看 [index-presets.test.ts](../registry/index-presets.test.ts)，精简响应看 [routes/index.test.ts](../routes/index.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[daily-quality.ts](daily-quality.ts) 检查指数和权重时点完整性，最大权重年龄由调用方传入。[sync-partition.ts](sync-partition.ts) 先按已确认接续关系选择同一成分的新来源，再校验指数＋日期的唯一成分快照和权重，[write.ts](write.ts) 用显式 Prisma 原子接纳完整快照；价格与官方估值独立处理。

完整指数目录同步已退役，保存的下载代码由 `pnpm data index list/add/remove` 维护。正式维护使用 `sync-partition.ts`；行情、成分与官方估值分别按来源范围处理。

正式下载只通过 `sync-partition.ts` 的领域准备和 `write.ts` 的类型化写入。旧的独立下载／替换实现已移除，测试使用同一入口。

`index_weight` 按明确的 `trade_date` 获取月度快照。月度窗口先核对完整 SSE 日历，使用窗口内最后交易日；来源空响应保留已有快照，返回其他日期则记录范围错误。所有分页完成后才写入。[Tushare 指数成分和权重](https://tushare.pro/document/2?doc_id=96)

成分表的 `sourceTsCode` 保存原始成分代码，`conCode` 保存规范证券身份。写入保护已知新来源，并再次校验合并后快照的权重总和；不满足完整性时整日拒收。旧的未调用 `prepare-membership` 下载路径及其专属测试已移除，正式路径回归见 [source-selection.test.ts](source-selection.test.ts)。
