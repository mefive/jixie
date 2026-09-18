# 交易日历与 SSE 已完成日

[sync.ts](sync.ts) 的 `syncTradeCal(client, start, end, exchange = 'SSE')` 供 Market 同步、CLI、Maintenance 和 Signals 调用：获取供应商日历后，在同一事务中删除该交易所日期范围并写入候选，返回行数。它会替换数据，不应作为读取辅助隐式调用。

[read.ts](read.ts) 的 `getOpenDates` 读取指定范围开市日期，供同步和批处理遍历。日历须包含足够的后继交易日，曲线／ETF 等可得日映射不能用自然日加一代替。

[sse-close.ts](sse-close.ts) 的 `isCompletedShanghaiDate` 只根据上海当前日期和 16:00 截止判断时间是否已完成，不查询是否开市；`latestCompletedTradeDate` 据此确定上界，再查 SSE 最新开市日，无数据返回 null。Signals 手工运行和 Maintenance 直接消费，信号要求开市及已知下一日的政策留在 [Signals runs](../../signals/runs/README.md)。这里不是跨市场通用收盘规则。

改时间边界、范围替换和无日历行为看 [calendar.integration.test.ts](calendar.integration.test.ts)；更改下游 availableDate 还需检查 [rates](../rates/README.md) 和 [cross-market](../cross-market/README.md) 的映射测试。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[read.ts](read.ts) 提供区间交易日、某日是否开市、最近 N 个交易日和下一交易日判断。查询不解释发布状态；Maintenance 负责选择水位与窗口，继续保持 SSE 日历口径。
