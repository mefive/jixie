# 商品研究数据与质量

商品能力面向研究，只读使用连续收益、carry、持仓和仓单；同步会写研究数据，但不启用商品交易。实际月合约元数据和日行情复用 [futures](../futures/README.md)。

| 文件 / 关键入口 | 责任与副作用 |
| --- | --- |
| [commodity-futures.ts](commodity-futures.ts) `selectCommodityFutureContracts` 及产品规格 | 纯产品筛选、ETF 关联、单位和研究范围 |
| [commodity-continuous-returns.ts](commodity-continuous-returns.ts) `buildCommodityContinuousReturns` | 纯计算：逐日主力映射、结算价、开市日 → 连续收益，保留换月标记及来源 |
| 同文件 `computeCommodityContinuousReturns`、`rebuildCommodityContinuousReturns`、`syncCommodityContinuousReturns` | compute **查库**再 build；rebuild 对结果做日期范围事务替换；sync 先同步主力映射再 rebuild，并非一个总事务 |
| [commodity-carry.ts](commodity-carry.ts) `loadCommodityCarryHistory`、`buildCommodityCarryHistory` | 前者查库，后者计算跨到期期限结构，保留最小交割距离、期限差和陈旧度规则 |
| [commodity-holding-positions.ts](commodity-holding-positions.ts) `selectCommodityHoldingRepresentatives`、`buildCommodityHoldingPositions`、`syncCommodityHoldingPositions` | 按持仓量选代表合约、聚合排名数据；sync 分合约范围抓取／替换并统计来源缺日 |
| [commodity-warehouse-receipts.ts](commodity-warehouse-receipts.ts) `buildCommodityWarehouseReceiptDaily`、`syncCommodityWarehouseReceipts` | 单位校正、按日聚合与可得日；sync 分产品／月获取，按实际返回日期替换 |
| [commodity-warehouse-receipt-maintenance.ts](commodity-warehouse-receipt-maintenance.ts) `maintainCommodityWarehouseReceipts` | Maintenance 的有界刷新＋基础质量检查，返回摘要／警告，结构错误或过旧时抛错 |

连续收益使用结算和映射，不能把连续代码的价格跳变当收益或可下单价格；审计 `auditCommodityContinuousReturns` 在 [对应 quality 文件](commodity-continuous-return-quality.ts) 读取并比较，不写库。持仓和仓单另有 [holding quality](commodity-holding-quality.ts)、[warehouse quality](commodity-warehouse-receipt-quality.ts) 的 audit/summarize 入口。

仓单空响应保留已有数据，部分响应只替换实际返回日期；不能将没返回的日期当撤回。持仓同步则按代表合约范围的日期集合替换并报告 missingDates，这两种缺失处理不同。已审计的单位／日期修正只适用于实现列出的范围，不推广成通用修复。

改每类数据先读同名测试，尤其 [commodity-continuous-returns.test.ts](commodity-continuous-returns.test.ts)、[commodity-holding-positions.test.ts](commodity-holding-positions.test.ts)、[commodity-warehouse-receipts.test.ts](commodity-warehouse-receipts.test.ts) 及各 quality 测试；Research 列投影见 [datasets](../../research/datasets/README.md)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[audit.ts](audit.ts) 将已有仓单、持仓、连续收益质量检查组成领域 finding。[holding-sync.ts](holding-sync.ts) 按合约 → 行情 → 持仓顺序补齐前置数据；Maintenance 只选择范围并记录阶段。
