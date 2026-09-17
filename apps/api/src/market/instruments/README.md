# 证券身份、历史名称与代码规范化

本目录区分纯身份规则、只读解析和会修改历史数据的规范化操作。

[stock-identity.ts](stock-identity.ts) 的 `canonicalStockCode` 使用 `STOCK_CODE_CHANGES` 统一历史代码；`normalizeStockNameSpells`、`classifyStockName`、`StockNameLookup` 处理名称区间及历史 ST 等状态。这些规则供同步、基本面和观察值读取使用，不查库。

[instrument-resolver.ts](instrument-resolver.ts) 的 `resolveInstruments(text)` 供 [Agent search-instruments 工具](../../agent/tools/search-instruments.ts) 解析股票／ETF：查本地代码与名称元数据，精确命中优先，有限名称片段才模糊搜索，最多返回 50 个候选；不接受模型凭空生成身份。[names.ts](names.ts) 的 `loadInstrumentNames(codes)` 供 Market 路由及信号等展示读取股票、ETF、期货名并补股指主力名称；未知项不伪造名称，指数名由各自查询承担。

[canonicalize-stock-codes.ts](canonicalize-stock-codes.ts) 的 `canonicalizeStockCodes` 供 CLI 和 Maintenance weekly 使用：先 seed 代码变更，再逐个代码关系开事务合并行情、参考数据和历史身份，删除旧代码行，返回迁移数及最早受影响日期。相同日期冲突按各表规则判断；复权、股息等既有例外有明确比较逻辑，不能以统一覆盖替代。它不是只读 resolver，也不是整轮维护发布事务。

改规则看 [stock-identity.test.ts](stock-identity.test.ts)；改规范化先读该实现的逐表 merge 规则及 [维护模块](../../application-maintenance/README.md) 中的直接消费者。行情名称／类型响应看 [Market 路由测试](../routes/index.test.ts)。

[返回 Market 总览](../README.md)
