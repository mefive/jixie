# 共享期货合约与原始数据同步

[sync.ts](sync.ts) 集中股指和商品的共用持久化，接收 TushareClient 及日期范围，返回同步行数；Maintenance 和 CLI 调用，Engine／Research 消费已入库数据。

- `syncFutureContracts` 获取 IF/IH/IC/IM 实际月合约；`syncCommodityFutureContracts` 根据 commodity 的研究产品规则获取商品月合约。各自只替换自己的产品集合，不覆盖另一类元数据。
- `syncFutureDaily`／`syncCommodityFutureDaily` 共用按实际合约同步实现，先读取与请求范围相交的合约，裁到上市／退市区间，再逐合约事务替换日行情；无合约时要求先同步元数据。
- `syncFutureMappings` 保存四种股指连续代码的逐日主力映射；商品主力映射由 [commodity](../commodity/README.md) 的连续收益流程管理。
- `syncFutureSettlements` 保存股指实际合约的结算、费用和保证金参数，逐合约范围事务，不是整个日期区间全部合约的总事务。

商品原始结算数据不使商品变成可交易产品，也不自动创建可成交的连续合约。统一价格查询按映射选实际合约，商品研究连续收益另有换月规则，见 [queries](../queries/README.md)、[commodity](../commodity/README.md)。

改字段和费用映射看 [futures-api.test.ts](../providers/tushare/futures-api.test.ts)、[market-reference-api.test.ts](../providers/tushare/market-reference-api.test.ts)；改产品选择看 [commodity-futures.test.ts](../commodity/commodity-futures.test.ts)。

[返回 Market 总览](../README.md)
