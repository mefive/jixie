# ETF 代表性研究池扩展计划

> 2026-08-24 制定；2026-08-25 Phase A～D 已开发并完成首次全量回填，Phase C 的三个生产交易日
> 连续观察仍是上线后的运维验收项。Phase E 保持触发式 backlog。
> 本文负责把现有 19 只主要 ETF 扩展为有明确暴露分类、历史可投资约束和日常维护能力的代表性研究池。
> ETF 成交与回测语义继续以 [`etf-trading.md`](./etf-trading.md) 为准，大类资产分层继续以
> [`asset-allocation-data.md`](./asset-allocation-data.md) 为准，跨市场时间、币种和数据许可继续以
> [`cross-market-data-contracts.md`](./cross-market-data-contracts.md) 为准，生产调度继续以
> [`production-maintenance.md`](./production-maintenance.md) 为准。

## 1. 结论与立项理由

扩充 ETF 值得做，但目标不是把全部上市产品无差别拉入日线库。当前 ETF 市场存在大量同指数、同暴露的
重复产品；全量行情会主要增加存储、同步和维护成本，不会按比例增加研究问题的覆盖面。

本计划采用以下边界：

1. `EtfBasic` 继续镜像 Tushare 的完整 ETF 名录，保留上市、待上市和退市状态；
2. `EtfDaily` / `EtfAdjFactor` 只回填进入版本化代表池、历史代表池或被策略明确引用的 ETF；
3. 第一版代表池目标为约 60～100 只，每个重要暴露通常保留一个主产品和一个备选产品；
4. 产品身份、经济暴露和研究池成员是三个不同概念，不从基金名称临时猜测；
5. 当前代表池是“截至选择日可复查的研究配置”，不是假装在全部历史时期都已知的动态 ETF 全市场；
6. 若以后需要全市场 ETF 横截面研究，必须另行建立 PIT 成员、历史规模、流动性和退市覆盖，不能直接把
   当前代表池升级成历史全市场。

扩展后的直接用途包括：

- 在 Research 中比较更多境内权益风格、行业、海外市场、债券期限和信用类别；
- 在 Factor V2 中研究 ETF 时间序列信号和跨资产 Panel，而不是反复复用少量代理；
- 在 Strategy Lab 中构造更完整的低频轮动、资产配置和风险分散候选；
- 用历史成交额、份额和规模判断容量与可投资性，而不是用今天的头部 ETF 回填过去；
- 为经典研究复现、组合构造和绩效归因提供更有代表性的可交易资产集合。

## 2. 2026-08-24 只读审计快照

### 2.1 本地数据水位

| 项目 | 本地结果 |
|---|---:|
| `EtfBasic` 总数 | 1,802 |
| 本地上市 / 待上市 / 退市 | 1,640 / 35 / 127 |
| `EtfDaily` 覆盖代码 | 19 |
| `EtfDaily` 行数 | 42,114 |
| `EtfAdjFactor` 覆盖代码 | 19 |
| `EtfAdjFactor` 行数 | 42,131 |
| 日线最早 / 最晚日期 | 2012-05-28 / 2026-08-07 |

本地上市 ETF 的基金类型分布为：

| `fundType` | 上市数量 | 已有日线 |
|---|---:|---:|
| 股票型 | 1,543 | 12 |
| 债券型 | 53 | 3 |
| 货币型 | 27 | 0 |
| 其他 | 17 | 4 |

投资通道分布为 1,554 只纯境内 ETF 和 86 只 QDII；当前日线只覆盖 16 只纯境内 ETF 和 3 只 QDII。
现有 19 只清单见 `apps/api/src/store/etf-presets.ts`，其中境内宽基、三种国债久期、黄金和三类商品
期货 ETF 已形成第一版大类资产代理，明显缺口是海外市场、固收细分类、权益风格/行业和现金代理。

### 2.2 与 Tushare 当前名录的差异

同日直接调用 `etf_basic` 得到 1,812 只 ETF：上市 1,652、待上市 33、退市 127。本地比上游少 10 只，
并有 12 只已从待上市转为上市但本地状态尚未刷新。说明当前元数据同步机制有效，但快照并非实时镜像；实施
本计划时应先运行一次 `syncEtfBasic` 并把“同步后代码集合与状态一致”纳入审计。

### 2.3 重复暴露与分类缺口

本地 1,640 只上市 ETF 只有约 480 个非空跟踪指数代码；中证 A500 约有 40 只产品，沪深 300 约有
30 只产品。按产品数量全量回填会严重放大重复暴露。

`IndexBenchmark` 当前保存 141 条官方公募基金业绩基准分类，只能映射 417 个境内股票 ETF 跟踪指数中的
69 个。`etf_basic` / `etf_index` 能提供跟踪指数身份和名称，但不能为所有指数提供稳定的宽基、风格、行业、
主题分类。因此代表池必须维护显式暴露分类，不能对未映射指数继续做名称正则分类。

### 2.4 当前 Token 的实测能力

以下接口已使用现有 Token 做有界、只读小样本验证：

| 数据族 | 接口 | 结果 | 第一版决策 |
|---|---|---|---|
| ETF 名录 | `etf_basic` / `fund_basic` | 可用 | 继续全量同步 |
| 跟踪指数资料 | `etf_index` | 可用，实测 560 行 | 用于身份与编制信息，不单独决定分类 |
| 日线行情 | `fund_daily` | 可用 | 代表池 P0 |
| 复权因子 | `fund_adj` | 可用 | 代表池 P0 |
| 份额、规模、NAV | `etf_share_size` | 可用，2026-08-07 实测 1,624 行 | 新增 P0 数据域 |
| 基金净值 | `fund_nav` | 可用 | 先用于样本审计，按需求决定是否落库 |
| 基金份额 | `fund_share` | 可用 | `etf_share_size` 缺口验证，不重复建主表 |
| 基金分红 | `fund_div` | 可用 | 货币 ETF 与复权审计前置 |
| 季度持仓 | `fund_portfolio` | 可用 | P2，不能替代每日 PCF |
| 沪深每日 PCF | `etf_sh_cons` / `etf_sz_cons` | 可用 | P2，按需读取，不做全市场历史囤积 |
| 场内基金技术因子 | `fund_factor_pro` | 可用 | 不接；使用本地 OHLC 现场计算 |
| 指数公告 | `idx_anns` | 可用 | P2，指数变更审计候选 |
| ETF 历史分钟 | `etf_mins` | 无权限，错误码 40203 | 不开权限，不进入当前日频范围 |

官方接口依据：

- [ETF 基础信息](https://tushare.pro/document/2?doc_id=385)
- [ETF 日线行情](https://tushare.pro/document/2?doc_id=127)
- [基金复权因子](https://tushare.pro/document/2?doc_id=199)
- [ETF 份额规模](https://tushare.pro/document/2?doc_id=408)
- [ETF 基准指数列表](https://tushare.pro/document/2?doc_id=386)
- [公募基金净值](https://tushare.pro/document/2?doc_id=119)
- [公募基金分红](https://tushare.pro/document/2?doc_id=120)
- [公募基金持仓](https://tushare.pro/document/2?doc_id=121)
- [沪市 ETF 每日 PCF](https://tushare.pro/document/2?doc_id=471)
- [深市 ETF 每日 PCF](https://tushare.pro/document/2?doc_id=472)
- [ETF 历史分钟](https://tushare.pro/document/2?doc_id=387)

接口可访问不改变数据许可。当前 Tushare Token 仍只用于个人、非商业本地研究；任何原始数据下载、公开
再分发或商业化都必须重新审核授权。

### 2.5 2026-08-25 实施验收快照

registry v1 已按 `selectionAsOf=20260824` 冻结，实际包含 71 个经济暴露、82 只主/备产品：

| 资产类 | 暴露数 | 产品数 |
|---|---:|---:|
| 境内权益宽基与风格 | 23 | 29 |
| 境内权益行业 | 17 | 20 |
| 海外权益 QDII | 16 | 16 |
| 固定收益 | 10 | 11 |
| 可转债 | 1 | 1 |
| 黄金 | 1 | 2 |
| 商品期货 | 3 | 3 |

首次同步后的真实本地水位：

| 项目 | 结果 |
|---|---:|
| `EtfBasic` | 1,816 |
| `EtfDaily` | 139,862 |
| `EtfAdjFactor` | 139,897 |
| `EtfShareSize` | 138,284 |
| ETF 专项严格审计 | 0 errors / 28 warnings |

28 个告警均属于两类：供应商未提供部分产品上市首日或 2015 年初的历史份额规模，以及少数产品日线与
复权因子行数差异。所有成员的元数据、跟踪基准、选择日生命周期和最新交易日终点均通过；告警保留为真实
缺失，不做后向填充、未来值填充或价格替代规模。2026-08-24 的真实当日切片已验证为 registry 82 只产品
日线、复权和份额规模各 82 条，其中 9 只 QDII 的 `totalSize` 为供应商真实 `null`。

实现入口：

- registry：`apps/api/src/store/etf-research-registry.ts`；
- 市场级日同步与历史规模回填：`apps/api/src/store/etf-market-sync.ts`；
- 专项审计：`pnpm --filter api audit:etf 20150101 20260824 --strict`；
- bootstrap：`pnpm --filter api sync:etf 20150101 20260824 registry`；
- 通用数据审计：`audit:data` 已包含 `etf-research-registry` finding。

## 3. 目标与非目标

### 3.1 目标

1. 建立版本化、可审查的 ETF 代表池，覆盖主要资产类别、地区、风格和行业风险来源；
2. 为每个成员记录明确暴露、选择证据、主/备角色和适用限制；
3. 回填代表池日线、复权因子，并把日常增量纳入正式 maintenance；
4. 新增历史份额、规模和 NAV 数据，支持 PIT 流动性、容量和折溢价研究；
5. 保留退市 ETF 与历史代表产品，不因产品退出而删除历史；
6. 只有真实存在行情和公开 loader 的 ETF 才在 Research Catalog 中标为可执行；
7. 让同一代表池可被 Research、Factor V2、Strategy Lab 和风险分析复用，同时维持各层独立验证边界；
8. 为未来是否建设动态 ETF 全市场提供真实使用证据，而不是提前实现另一套 `ctx.universe()`。

### 3.2 非目标

- 不全量回填全部 1,600 余只上市 ETF 的十年历史；
- 不把同一指数的数十只产品都作为独立经济暴露；
- 不建设分钟、tick、盘中 IOPV、申赎套利或日内撮合；
- 不全市场长期保存每日 PCF 篮子；
- 不接入 Tushare 自产技术因子，已有技术指标继续从本地行情确定性计算；
- 不把价格指数、净值、ETF 成交价和 total return 混成一条万能收益序列；
- 不把当前规模最大的 ETF 当成历史每一天都可预见的最优产品；
- 不因为数据入库而自动创建 Factor、揭示 holdout、运行回测或部署策略；
- 不在本计划中增加境外交易所挂牌 ETF；QDII 指中国交易所内、人民币成交的可交易代理。

## 4. 三层对象与版本边界

### 4.1 产品身份层

`EtfBasic` 继续保存供应商事实：代码、名称、跟踪指数、上市/退市、交易所、管理人、费率、基金类型和
QDII 通道。它不承担平台研究分类，也不因代表池变化删除产品。

产品层必须保留：

- 待上市和退市产品；
- 上游原始 `indexCode` / `indexName`；
- 原始 `fundType` / `etfType`；
- 上市、退市和状态变化；
- 供应商字段为空时的真实 `null`，不从名称补造。

### 4.2 经济暴露层

新增一个代码内、版本化的 `ETF_RESEARCH_REGISTRY`，作为代表池分类和选择的人工真相源。第一版不新增可由
用户编辑的数据库 Universe，因为产品当前没有“创建、命名、分享 ETF 池”的独立操作。

每个登记项至少包含：

```text
registryVersion
exposureId
assetClass
region
marketExposure
currencyExposure
subClass
benchmarkCode
primaryTsCode
backupTsCodes
selectionAsOf
selectionEvidence
knownLimitations
```

建议的稳定分类：

| `assetClass` | `subClass` 示例 |
|---|---|
| `cn_equity` | broad_large、broad_mid、broad_small、growth、value、dividend、low_volatility |
| `cn_equity_sector` | financials、consumer、healthcare、technology、manufacturing、resources |
| `overseas_equity` | hk_broad、hk_technology、us_broad、us_technology、japan、europe、emerging |
| `fixed_income` | cash、government_short、government_medium、government_long、policy_bank、credit |
| `convertible_bond` | broad_convertible |
| `gold` | physical_gold |
| `commodity` | industrial_metals、energy_chemicals、agriculture |

分类使用标准英文代码，中文和英文显示名走 i18n。行业或主题只在经济含义稳定、确有研究问题时登记；短期营销
主题不因市场上存在 ETF 就自动进入代表池。

### 4.3 研究池成员层

代表池版本由 Git 历史审查，成员调整必须保留：

- 生效版本和选择日期；
- 同暴露主产品与备选产品；
- 规模、成交额、上市历史、费率和数据完整性的选择证据；
- 替换原因，例如退市、长期低流动性、跟踪对象变化或出现更合适的历史产品；
- 已知限制，例如 QDII 时区错位、类别代理误差或历史过短。

报告和策略继续冻结实际 ETF 代码集合，不只冻结 `exposureId`。登记表更新不得让旧报告自动换成新产品。

## 5. 第一版覆盖范围

第一版不先拍死具体代码，先冻结暴露槽位，再用真实数据选择产品。目标数量是上限，不是 KPI。

| 类别 | 目标产品数 | 选择重点 | 当前基础 |
|---|---:|---|---|
| 境内宽基 | 12～16 | 大、中、小、微盘与主要板块宽基 | 已较完整 |
| 境内风格/策略 | 10～16 | 价值、成长、红利、低波、质量、现金流 | 仅红利较明确 |
| 境内行业 | 12～20 | 金融、消费、医药、科技、制造、资源 | 基本缺失 |
| 海外权益 QDII | 12～18 | 港、美、日、欧及少量新兴市场 | 仅恒生、标普 500、纳指 100 |
| 利率债/政金债 | 8～12 | 短、中、长、超长久期及政策性金融债 | 5Y/10Y/30Y 已有 |
| 信用与转债 | 4～8 | 短融、高等级公司债、可转债 | 缺失 |
| 现金代理 | 0～2 | 货币 ETF；须先通过收益语义门 | 未接 |
| 黄金与商品 | 4～6 | 黄金、豆粕、有色、能化 | 四个主要代理已覆盖 |

同一暴露通常只选择一个主产品和最多一个备选。黄金 ETF、沪深 300 ETF、A500 ETF 等重复度高的类别不按
产品数量扩张。第一版总数超过 100 时必须重新说明新增产品带来的独立研究问题。

## 6. 选择纪律

### 6.1 必须满足的硬条件

候选主产品必须：

1. 在 `selectionAsOf` 已上市，代码和跟踪指数身份明确；
2. 对目标研究区间具有足够日线和复权覆盖；
3. 不存在无法解释的长期无成交或上游缺口；
4. 基金类型、QDII 通道和同日回转规则已核对；
5. 实际跟踪对象与登记暴露一致，不用名称中的行业词代替合同核验；
6. 对 QDII、债券、货币和商品产品记录专属语义限制；
7. 在同类中具有可接受的历史成交额、份额、规模和费率，但不以单日排名决定。

### 6.2 选择证据

每个暴露至少比较：

- 上市日期与可用历史长度；
- 最近 252 个交易日成交额中位数和低分位数；
- 最近可得规模及过去一年的规模稳定性；
- 日线、复权因子和份额规模的缺失情况；
- 管理费；
- 跟踪指数是否完全一致；
- QDII 的底层市场、报价币种和中国收盘时点差异；
- 同一管理人或单一产品失效时是否有独立备选。

选择结果不按历史收益、Sharpe 或未来表现排序。收益表现只能用于理解暴露，不能成为选择某只同类 ETF 的
主要依据。

### 6.3 历史偏差边界

当前代表池用于固定资产集合研究时，报告必须披露“产品于 `selectionAsOf` 选择”。如果将当前成员回测到过去，
这是一个当前视角的固定代理实验，不等于历史全市场选择。

只有在后续建立以下数据后，才允许声称动态 ETF Universe 具备 PIT：

- 当时已经上市且尚未退市的产品集合；
- 当时可得的份额、规模和成交额；
- 当时已知的跟踪指数与重大更名/变更；
- 明确的历史筛选规则和换入换出日期；
- 被淘汰、退市和合并产品的完整历史行情。

## 7. 数据模型计划

### 7.1 保留现有模型

- `EtfBasic`：全量身份和生命周期；
- `EtfDaily`：未复权 OHLC、成交量和成交额；
- `EtfAdjFactor`：复权因子；
- `EtfSyncSlice`：代码 × 年的历史回填完成标记。

`EtfBasic` 是供应商镜像，不把平台 `assetClass`、地区和主/备角色写回上游字段。

### 7.2 新增 `EtfShareSize`

第一版唯一必要的新市场数据表：

```text
EtfShareSize
  tsCode
  tradeDate
  availableDate
  totalShare       // 10,000 fund units
  totalSize        // CNY 10,000, nullable for observed QDII rows
  nav              // CNY per fund unit, nullable
  close            // CNY per traded unit, nullable
  exchange
  retrievedAt
```

主键为 `[tsCode, tradeDate]`，并对 `tradeDate`、`availableDate` 建索引。Tushare 说明该数据通常在下一交易日
早间更新，因此研究读取必须按 `availableDate <= decisionDate`，不能让 `tradeDate` 当日收盘决策读取尚未
发布的份额和规模。

历史接口不保证提供原始 vintage。首次回填标记为 latest-value backfill；从本项目开始采集后保留
`retrievedAt` 和数据 revision，后续刷新发生变化时不得把修订静默伪装成原始历史实时值。

### 7.3 暂不新增的表

- `EtfNav`：第一版先使用 `etf_share_size.nav`；只有真实研究需要公告日、累计净值和复权净值时再接
  `fund_nav`；
- `EtfDividend`：货币 ETF 或复权审计立项时再接 `fund_div`；
- `EtfPcfHolding`：每日全市场数据量过大，只有成分穿透、申赎或跟踪误差研究反复出现时再建；
- `EtfQuarterlyHolding`：季度股票持仓不能描述债券、商品和日内申赎篮子，当前不进入通用 ETF 地基；
- 供应商技术因子表：禁止落库，可由复权 OHLC 确定性计算。

任何新增 Prisma 表都必须由 Prisma 生成 migration，并同步
`apps/api/src/agent/tools/read-only-sql.ts` 的 `SQL_TABLE_DOCS`、数据审计、真实 fixture 和单位说明。

## 8. 同步与维护架构

### 8.1 历史回填

保留现有“代码 × 自然年”回填方式，用于代表池首次导入和新增成员补历史：

```text
syncEtfBasic
→ 对登记代码逐年 fund_daily / fund_adj
→ 每个代码年份原子替换
→ EtfSyncSlice 标记完成
→ 数据质量审计
```

`EtfShareSize` 历史回填优先按交易日或有界日期窗口请求，避免逐只产品重复调用全市场日数据。回填必须可中断
续传，且不能因为某只 ETF 上市前返回空数据而伪造完成行情。

### 8.2 每日增量

代表池扩大后，不能继续为每只 ETF 各发一次日线和复权请求。每日 maintenance 对目标交易日使用市场级请求：

1. 一次 `fund_daily(trade_date)`；
2. 一次或分页 `fund_adj(trade_date)`；
3. 一次 `etf_share_size(trade_date)`；
4. 在内存中按当前 registry、历史代表成员和活跃部署引用代码过滤；
5. 校验候选后，在短事务内分别替换目标日切片；
6. 通过完整性门禁后，才允许 Factor、回测和信号读取新水位。

当前 `fund_daily` 单日上限 5,000 行、`etf_share_size` 单日上限 5,000 行，能够覆盖当前全市场；
`fund_adj` 单次上限 2,000 行，接近当前 ETF 总数，必须预先支持分页，不能假设永远低于上限。

### 8.3 每周修订检查

weekly 至少执行：

- 全量 `syncEtfBasic`，核对上游和本地代码/状态集合；
- 回查最近 252 个交易日的代表池复权因子；
- 回查最近 252 个交易日的份额规模；
- 比较内容 hash，记录最早变化日并升级 data revision；
- 对新增上市代表成员补齐上市日至当前历史；
- 对退市成员停止未来期待，但保留全部旧行情和报告引用；
- 运行 ETF 专项深度审计。

历史修订只影响新研究运行和明确需要重建的派生观测；不可变 ResearchExecution、FactorReport 和回测结果不能
被原地重写。

### 8.4 活跃策略引用

活跃部署明确引用、但不在代表池中的 ETF 继续由信号同步按需维护。代表池和部署依赖取并集，不允许一次
registry 调整使已部署策略突然失去行情。

## 9. 数据语义与质量门禁

### 9.1 价格与收益

- 成交和 K 线显示使用 `EtfDaily` 原始价格；
- 收益、因子历史和持仓估值使用 `close × adjFactor`；
- `fund_adj` 修订必须进入 data revision；
- 日线缺失和复权因子多出不能互相补造；
- QDII ETF 是中国交易所 CNY 成交资产，包含底层市场收益、FX、费用、折溢价和时区影响，不等同于底层指数；
- 若比较底层指数，必须分别展示 ETF 代理收益和指数本币/CNY 收益，不拼接。

### 9.2 份额、规模与 NAV

- `totalShare` 单位为万份，`totalSize` 单位为万元；2026-08-24 的真实样本显示部分 QDII
  `totalSize` 与 `nav` 同日为空，因此两者均保留 `null`，不得用成交价或未来日期补造；
- 份额变化是申赎结果的近似线索，不自动解释为资金看多或看空；
- 规模不能直接当作可成交容量，仍须同时检查成交额、冲击和持仓限制；
- 折溢价只在 `close` 与同一 `tradeDate` 的有效 `nav` 对齐后计算；
- QDII NAV 可能对应不同底层市场收盘和较晚更新，必须展示时间错位警告；
- `nav` 为空时不使用基金累计净值或后续日期数据回填。

### 9.3 货币 ETF

货币 ETF 不能直接套用普通权益 ETF 的价格收益假设。进入代表池前必须用真实样本验证：

- 场内价格、基金净值、每日收益结转和分红之间的关系；
- `fund_adj` 是否完整反映收益分配；
- 收盘价接近固定值时，单纯价格变化是否漏掉主要收益；
- T+0 规则、交易费用和最小单位；
- 作为现金代理时与回购/Shibor 的可比口径。

门禁未通过前，现金槽位保持空缺，不用普通债券 ETF 或今天的货币基金净值偷换。

### 9.4 完整性分类

每个缺失观测必须归入以下一种：

- 上市前或退市后；
- 交易所休市；
- 产品停牌或当日无成交；
- QDII/供应商正常延迟；
- 上游真实缺口；
- 本地同步失败。

只有前四种可以作为已解释缺失。未知缺失和本地同步失败必须阻止水位推进。

## 10. 产品与研究入口

### 10.1 搜索与对象详情

`searchInstruments` 继续搜索全量 ETF 元数据，但明确返回：

- 是否有日线；
- 是否属于当前 registry；
- 暴露分类和主/备角色；
- 数据起止日；
- 若不可执行，返回缺少行情或未登记的确定性原因。

元数据存在不等于可以回测。

### 10.2 Research Catalog 与 SDK

`data.series("etf", ...)` 已是通用公开 loader，不需要为每个 ETF 发明新 SDK 方法。扩展时必须：

- Catalog 查询实际 `EtfDaily` / `EtfAdjFactor` 覆盖；
- 没有数据的 ETF 标为 `source_available_but_local_data_missing`，不能标 `ready`；
- 份额规模若开放给 Python，先在 `packages/shared/src/research-sdk-contract.ts` 增加显式契约和固定列，禁止
  暴露 Prisma schema；
- 新公开契约按 Research SDK 生成链更新 `.pyi`、Monaco、Pyright、runtime 校验和 Agent Catalog；
- 份额规模的 `availableDate` 和 latest-value backfill 警告进入返回元数据。

第一版可以先只让代表池扩展 `market.adjusted_close`，把份额规模用于平台选择审计；等真实研究练习需要后再
决定公开 Python 方法，避免数据入库即无条件扩 SDK。

### 10.3 Factor V2

- 时间序列 Factor 仍逐只 ETF 读取自身历史；
- Panel Factor 只使用报告冻结的明确资产集合；
- 预置模板的 allowed assets 只能在对应数据完整、资产分类明确后扩充；
- 固收、QDII、货币和商品 ETF 的信号解释分别保留，不能只按 `fundType` 归成一个模糊 ETF 类别；
- 代表池扩展不自动产生新的预置 Factor。

### 10.4 Strategy Lab

- ETF 策略继续使用显式 `watch`，不扩展现有 A 股 `ctx.universe()`；
- Agent 必须通过 `searchInstruments` 核对代码和 `hasDailyData`；
- 同暴露主产品和备选产品不会在回测中自动互换；替换必须生成新的策略代码或配置；
- 当前日频引擎不因为产品允许 T+0 就提供日内往返。

### 10.5 帮助与双语

实现产生用户可见能力时，再同步更新中英文帮助：代表池是什么、为何不全量、怎样理解 QDII/债券/货币/商品
代理、怎样查看数据起点和限制。本文制定期间不修改正在由其他工作会话更新的帮助文件。

## 11. 分阶段实施

| 阶段 | 当前状态 |
|---|---|
| Phase A | 完成：registry v1、静态校验、82 产品选择证据和专项审计已落地 |
| Phase B | 完成：API、Prisma migration、历史/每日同步、PIT 时间和跨市场契约已落地 |
| Phase C | 开发与首次回填完成：daily / weekly / repair / bootstrap 已接线；仍需上线后连续观察三个交易日 |
| Phase D | 完成当前范围：搜索和 Catalog fail closed、真实 loader fixture、Factor/Strategy 既有契约验证、双语帮助已更新；未扩公开份额规模 SDK |
| Phase E | 未启动，继续作为需求触发式 backlog |

### Phase A：注册表与选择审计

**范围**：不加新行情表，先形成可复查的候选与选择证据。

1. 新增版本化 `ETF_RESEARCH_REGISTRY` 类型和静态校验；
2. 建立候选审计脚本，读取元数据、日线、复权和实时探测的份额规模；
3. 按第 5 节槽位提出约 60～100 只主/备产品；
4. 对每项输出选择日期、历史长度、成交额、规模、费率、数据缺口和限制；
5. 人工复核后冻结 registry v1；
6. 更新 `etf-trading.md` 的当前池和实际水位。

**验收**：没有未分类成员；同一产品不能冲突映射；每个主产品有证据或明确写出无备选。

### Phase B：份额规模数据契约

1. 增加 `etf_share_size` API 类型；
2. 增加 `EtfShareSize` Prisma model 和 Prisma migration；
3. 实现按日幂等同步、历史回填和 next-SSE `availableDate`；
4. 同步 SQL 白名单、审计、SourceDecision/Contract 和真实 fixture；
5. 验证境内宽基、QDII、债券、黄金各一只的单位、延迟和缺失行为；
6. 暂不开放 Research Python SDK，除非同阶段已有明确练习消费它。

**验收**：真实样本与 Tushare 对账，单位和时间门控测试通过，刷新可发现 revision。

### Phase C：代表池行情回填与日常维护

1. 回填 registry v1 全部成员的日线和复权；
2. 保留历史代表和退市成员；
3. 新增按交易日批量增量同步；
4. 接入 daily、weekly、repair、bootstrap 和 maintenance summary；
5. 扩展 `audit:data` 和数据水位；
6. 连续观察至少三个交易日的真实增量。

**验收**：目标池所有未知缺口为零；日线/复权逐日关系可解释；任务失败不推进水位；生产维护无逐只产品的
日常 N+1 请求。

### Phase D：研究可达性与用户闭环

1. 修正 Catalog 的本地覆盖状态；
2. 验证每个一级资产至少一个 `data.series` 真实 fixture；
3. 扩充 Factor 时间序列和 Panel 可选资产，但不改变统计协议；
4. 验证 Strategy Agent 搜索、显式 watch、回测和风险归因；
5. 增加必要的中英文帮助、SDK 参考和真实浏览器 E2E；
6. 更新 ROADMAP 1.4 的本轮语义目录实况，不把长期维护项标完成。

**验收**：从搜索到 Research、Factor 或 Strategy 的真实闭环可复现，所有页面都能看到数据截止日和代理限制。

### Phase E：动态 ETF Universe（触发式 backlog）

只有出现至少两项独立研究反复需要“当时全市场 ETF 选择”时才立项。届时另行设计：

- 全量历史日线与退市覆盖；
- PIT 规模/成交额筛选；
- 跟踪指数变更历史；
- 动态成员与换入换出；
- 全市场计算资源上限；
- 与现有 A 股 `UniverseSpec` 分离的 ETF Universe 契约。

Phase E 不属于 Phase A～D 的隐藏完成条件。

## 12. 测试与验收矩阵

### 12.1 自动测试

- Tushare API 字段、分页、空响应和权限错误；
- registry 版本、唯一暴露、主/备角色、有效代码和分类穷尽；
- `EtfShareSize` 单位、next-SSE `availableDate` 和 revision；
- 日线/复权/份额规模按日期原子替换；
- 上市前、退市后、休市、停牌和未知缺失分类；
- daily/weekly/repair 幂等、catch-up、失败水位和共享维护锁；
- Research Catalog 对无日线 ETF fail closed；
- Research SDK Contract 生成一致性（若开放新方法）；
- Factor / Strategy 只读取报告或代码明确声明的 ETF；
- QDII、债券、货币、黄金和商品 fixture 的语义隔离。

### 12.2 真实数据验收

每个一级资产至少选择一个真实样本，检查：

1. Tushare 元数据与本地逐字段对账；
2. 上市日至截止日的日线和复权覆盖；
3. 随机日期原始收盘、复权因子和后复权结果；
4. 最近一年成交额、规模、份额和 NAV；
5. 数据缺失和供应商延迟；
6. 跟踪指数及产品说明是否支持登记暴露；
7. Research Python 返回固定 schema 和正确截止日；
8. 一次多资产 Panel、一次显式 ETF watch 回测和一次风险归因。

### 12.3 完成定义

Phase A～D 只有同时满足以下条件才算完成：

- 代表池 v1 已冻结且不超过约定范围；
- Tushare 名录同步后与上游代码和状态集合一致；
- registry 成员日线、复权和份额规模通过真实审计；
- daily/weekly/repair/bootstrap 全部接线并完成真实连续运行；
- 没有元数据存在却被 Catalog 错报为可执行的 ETF；
- 固收、QDII、货币和商品代理限制在结果和帮助中可见；
- 不可变历史报告未被数据刷新原地改写；
- typecheck、相关测试、数据审计和涉及 UI 的 E2E 全部通过。

## 13. 风险与控制

| 风险 | 控制 |
|---|---|
| 同指数产品过多 | 暴露槽位先于代码；一主一备；总量超过 100 需重新评审 |
| 当前头部产品造成幸存者偏差 | 冻结 `selectionAsOf`；保留退市和历史代表；不宣称历史全市场 |
| QDII 时间与币种错位 | 显式 region/currency；中国收盘 availableDate；指数和 ETF 分开 |
| 货币 ETF 漏算收益 | 分红/净值/复权真实门禁通过前不进入现金槽位 |
| `fund_adj` 历史修订 | weekly 回查、revision、不可变旧报告 |
| 数据量和 SQLite 写锁 | 市场级日请求、候选先校验、短事务按日发布、共享维护锁 |
| PCF 体量失控 | 不全量落库；按明确研究需求单独设计 |
| 供应商技术因子形成第二口径 | 不接入；复用现有确定性计算内核 |
| 元数据有但行情无 | 搜索与 Catalog 分开报告 metadata / local coverage / SDK access |
| 数据许可扩大 | 继续限个人非商业研究；对外再分发单独授权 |

## 14. 已冻结决策与实施门

### 14.1 已冻结

1. 做代表性研究池，不做全量 ETF 历史囤积；
2. 第一版约 60～100 只，以暴露覆盖而非产品数量为目标；
3. 元数据全量、行情按 registry/历史成员/活跃部署并集同步；
4. 新增数据优先级最高的是份额、规模和 NAV；
5. 日常同步改为按交易日市场级获取，不逐只产品请求；
6. 货币 ETF 在特殊收益语义验收前不作为普通价格资产；
7. 不接分钟、实时 IOPV、全量 PCF 和供应商技术因子；
8. 不扩展现有 A 股 `ctx.universe()`；动态 ETF Universe 另行触发。

### 14.2 每阶段实施前必须确认

- Phase A：具体暴露槽位是否能被现有数据和真实研究问题支持；
- Phase B：`etf_share_size` 历史缺失、QDII 延迟和修订行为的真实样本；
- Phase C：一次全池回填的调用次数、耗时、数据库增量和备份窗口；
- Phase D：哪些份额规模指标确有反复 Python 使用需求，是否值得扩公开 SDK；
- Phase E：是否真的出现动态全市场需求，而不是对“全量”本身的偏好。

这些确认门用于收敛实现，不改变本文已经冻结的总体方向。
