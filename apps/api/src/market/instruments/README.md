# 证券身份、历史名称与代码规范化

本目录区分纯身份规则、只读解析和会修改历史数据的规范化操作。

[stock-identity.ts](stock-identity.ts) 的 `canonicalStockCode` 使用 `STOCK_CODE_CHANGES` 统一历史代码；`normalizeStockNameSpells`、`classifyStockName`、`StockNameLookup` 处理名称区间及历史 ST 等状态。这些规则供同步、基本面和观察值读取使用，不查库。

[instrument-resolver.ts](instrument-resolver.ts) 的 `resolveInstruments(text)` 供 [Agent search-instruments 工具](../../agent/tools/search-instruments.ts) 解析股票／ETF：查本地代码与名称元数据，精确命中优先，有限名称片段才模糊搜索，最多返回 50 个候选；不接受模型凭空生成身份。[names.ts](names.ts) 的 `loadInstrumentNames(codes)` 供 Market 路由等展示读取股票、ETF 名称；未知项不伪造名称，指数名由各自查询承担。

[normalize-identity.ts](normalize-identity.ts) 的 `normalizeStockIdentity` 由人工 `data clean` 在 Maintenance 的短事务中逐表检查冲突，再执行有类型的 Prisma 合并。同键快照优先已知的新来源；历史来源未知时以原存储代码决定保留行，但不据此填造 `sourceTsCode`。同来源真实冲突仍拒绝，财务指标复用自己的公告／修订规则。版本表仅移动证券身份，所有指纹、来源及捕获时间保留。分红按完整事件键归并并更新稳定 ID，保留选中记录的捕获时间和质量，不用换代码重置 PIT 时间。它不是只读 resolver。

改规则看 [stock-identity.test.ts](stock-identity.test.ts)；改规范化先读该实现的逐表 merge 规则及 [维护模块](../../maintenance/README.md) 中的直接消费者。行情名称／类型响应看 [Market 路由测试](../routes/index.test.ts)。

[返回 Market 总览](../README.md)

## 维护调用的数据能力

[audit.ts](audit.ts) 拥有证券主表完整性和行情代码关联检查，返回 Market 质量 finding；整体审计由 Maintenance 组合。

[source-selection.ts](source-selection.ts) 只提供按业务键选择来源及快照防降级的纯函数；业务键、版本时序与完整性校验仍归各领域。`stockSourceRank` 仅使用已确认的接续链，不根据代码数字大小或今天的上市状态推断。相同优先级的原始行完整交给领域处理，不靠输入顺序消除冲突。

[normalize-identity.test.ts](normalize-identity.test.ts) 覆盖旧库快照冲突及版本保留；[source-selection.test.ts](source-selection.test.ts) 覆盖来源选择、名称顺序和迁移字段。旧的无调用 `canonicalize-stock-codes` 实现已删除，避免两套归并政策并存。

[market-range.ts](market-range.ts) 保存有公开依据的市场进入边界，由入库筛选、股票覆盖和人工 market-range 清理共用。`stockMarketRanges` 归并同市场代码接续的上市区间，`stockMarketMembership` 统一入库与覆盖判断，未知状态保留并报告。当前目录用于同步范围判断，存量清理仍不能单凭当前 listDate 授权删除历史。P 表示暂停上市，实际缺日必须核对当日停牌证据；G/UN 与 P 分开。
