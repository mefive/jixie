# 指数与精简收盘读取

[sync.ts](sync.ts) 的入口供底层映射与测试 调用：`syncIndexWeight` 同步权重，`syncIndexDaily`／`syncIndexDailyBasic` 同步行情和官方估值，各入口拥有自己的请求范围和替换事务，不构成一次全域发布。

保留的指数和历史股票池代码集合来自 [registry/index-presets.ts](../registry/index-presets.ts)，供应商字段来自 providers/tushare/api。指数成分按历史快照选择；不能只用当前成员回填历史分析。官方估值展示由 [valuation](../valuation/README.md) 负责。

[read.ts](read.ts) 的 `loadIndexSeries(tsCode, start, end)` 供 instrument 路由的 `/indices/:indexCode/series` 使用，只返回 `{ points: [{ date, close }] }`。默认区间在路由确定，无数据仍是空数组；不要与 [instrumentSeries](../queries/README.md) 的完整对象响应合并。

改官方估值适配看 [index-daily-basic-api.test.ts](../providers/tushare/index-daily-basic-api.test.ts)，索引清单看 [index-presets.test.ts](../registry/index-presets.test.ts)，精简响应看 [routes/index.test.ts](../routes/index.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[daily-quality.ts](daily-quality.ts) 检查指数和权重时点完整性，最大权重年龄由调用方传入。[repair.ts](repair.ts) 拥有指数缺口判定和补齐；[membership-sync.ts](membership-sync.ts) 同步成员并返回最早历史变更日。Maintenance 决定是否重算与发布。

完整指数目录同步已退役，保存的下载代码由 `pnpm data index list/add/remove` 维护。正式维护使用 `sync-partition.ts`；行情、成分与官方估值分别按来源范围处理。
