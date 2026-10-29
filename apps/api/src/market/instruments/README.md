# 证券身份、历史名称与代码规范化

本目录区分纯身份规则、只读解析和会修改历史数据的规范化操作。

[stock-identity.ts](stock-identity.ts) 的 `canonicalStockCode` 使用 `STOCK_CODE_CHANGES` 统一历史代码；`normalizeStockNameSpells`、`classifyStockName`、`StockNameLookup` 处理名称区间及历史 ST 等状态。这些规则供同步、基本面和观察值读取使用，不查库。

[instrument-resolver.ts](instrument-resolver.ts) 的 `resolveInstruments(text)` 供 [Agent search-instruments 工具](../../agent/tools/search-instruments.ts) 解析股票／ETF：查本地代码与名称元数据，精确命中优先，有限名称片段才模糊搜索，最多返回 50 个候选；不接受模型凭空生成身份。[names.ts](names.ts) 的 `loadInstrumentNames(codes)` 供 Market 路由等展示读取股票、ETF 名称；未知项不伪造名称，指数名由各自查询承担。

[normalize-identity.ts](normalize-identity.ts) 的 `normalizeStockIdentity` 在 Maintenance 的短事务中逐表检查冲突，再执行有类型的 Prisma 合并。分红稳定 ID 随规范代码更新，原捕获时间和质量保留；同业务身份的真实冲突拒绝，不用换代码重置 PIT 时间。它不是只读 resolver。

改规则看 [stock-identity.test.ts](stock-identity.test.ts)；改规范化先读该实现的逐表 merge 规则及 [维护模块](../../maintenance/README.md) 中的直接消费者。行情名称／类型响应看 [Market 路由测试](../routes/index.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[audit.ts](audit.ts) 拥有证券主表完整性和行情代码关联检查，返回 Market 质量 finding；整体审计由 Maintenance 组合。
