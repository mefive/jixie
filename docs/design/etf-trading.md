# ETF 日频交易与研究通道

> 2026-07-26 首版落地，2026-08-25 扩展为版本化代表性研究池。目标是在不全量囤积所有
> 基金历史行情的前提下，让 Research、Factor 和 Strategy 使用一组暴露明确、可审计的 ETF。
> 系统仍定位于日频，不提供分钟线或日内撮合。

## 当前数据

- `EtfBasic`：Tushare `etf_basic` 全量元数据，并用 `fund_basic` 补充基金类型和退市日期。
  当前 1,816 条，保留待上市和已退市产品；源数据缺失的上市日期保持 `null`，不伪造。
- `EtfDaily`：Tushare `fund_daily` 未复权 OHLC、成交量和成交额。
- `EtfAdjFactor`：Tushare `fund_adj` 复权因子。
- `EtfShareSize`：Tushare `etf_share_size` 的历史份额、规模、NAV 和收盘价；按下一上交所
  交易日设置 `availableDate`，历史首次回填属于 latest-value backfill。
- `EtfSyncSlice`：以“代码 × 自然年”记录完成状态。同步中断后可续跑；传入 `refresh`
  才会强制重抓已有分片。

截至 2026-08-24，registry v1 有 71 个经济暴露、82 只主/备产品：

| 分类 | 暴露数 | 产品数 |
|---|---:|---:|
| 境内权益宽基与风格 | 23 | 29 |
| 境内权益行业 | 17 | 20 |
| 海外权益 QDII | 16 | 16 |
| 固定收益 | 10 | 11 |
| 可转债 | 1 | 1 |
| 黄金 | 1 | 2 |
| 商品期货 | 3 | 3 |

真实回填水位为 139,862 条日线、139,897 条复权因子和 138,284 条份额规模记录。专项
审计逐只核对元数据、跟踪基准、上市日、数据起止日、最近 252 日成交额和最新规模；当前
结果为 0 个错误、28 个上游历史缺口告警。完整成员、主备角色和限制以
`apps/api/src/store/etf-research-registry.ts` 为唯一真相源，旧的 `MAJOR_ETF_CODES` 只保留为
兼容预设。

## 同步

```bash
# 默认 2015 年至今天、registry v1 全部产品
pnpm --filter api sync:etf

# 明确日期和代码集，或只同步旧的 major 兼容预设
pnpm --filter api sync:etf 20200101 20260724 510300.SH,518880.SH
pnpm --filter api sync:etf 20200101 20260724 major

# 强制重抓已完成分片
pnpm --filter api sync:etf 20200101 20260724 registry refresh

# 独立审计代表池；有 error 时严格模式返回失败
pnpm --filter api audit:etf 20150101 20260824 --strict
```

脚本会依次同步 SSE 交易日历、全部 ETF 元数据、所选代码的日线、复权因子和份额规模。
历史日线/复权按代码 × 年原子替换；份额规模按交易日从全市场切片中筛选。日常 maintenance
不再逐只请求：每个交易日只取一次 `fund_daily`、分页 `fund_adj` 和一次
`etf_share_size`，然后过滤 registry 与活跃部署引用代码并原子发布。

weekly 会刷新全量元数据，并回查最近 252 个交易日的行情、复权和份额规模修订；最早变化日
进入 maintenance summary。repair 复用同一按日同步链，不能绕过完整性门禁。

## 回测语义

- ETF 与股票使用独立行情表，避免股票按交易日覆盖同步时误删 ETF 数据。
- `watch` 可以直接使用已同步 ETF；K 线、复权序列、搜索、名称解析和 agent 只读 SQL
  均已识别 ETF。
- Research Catalog 只有在本地日线真实存在时才把 ETF 标为 ready；只有元数据时返回
  `source_available_but_local_data_missing`。`data.series("etf", ...)` 继续读取复权收盘序列。
- 搜索结果返回 registry 版本、经济暴露、主/备角色、数据起止日和已知限制；同一暴露的主备
  产品不会在旧研究或回测中自动互换。
- ETF 买卖收佣金，不收 A 股卖出印花税和沪市股票过户费。
- 仍采用日频信号、下一交易日开盘成交。即便产品规则允许当日回转，日频引擎也不模拟
  盘中买入后卖出。
- `ctx.universe()` 暂时保持 A 股横截面语义，不把 ETF 混入 PE/PB 等股票因子池。
  ETF 轮动策略应显式列出 `watch`，后续若需要动态 ETF 池，再设计独立的 ETF universe。

## 产品入口

- 回测工作台的新策略页提供“主要ETF轮动”示例。Agent 的生成提示包含一份可编译的月度
  60 日动量轮动范例，使用沪深300、中证500、创业板、红利、黄金和5年国债 ETF。
- 选股看图页同时承担点名标的研究入口：股票继续使用 `runScreen` 做横截面筛选；ETF
  先经 `searchInstruments` 确认本地代码和日线覆盖，再通过只读 SQL / `analyzeData`
  比较收益、成交量、波动率或相关性。
- 回测成交队列与“全部成交”列表显示 ETF 资产徽标；K线仍使用不复权真实行情，内部
  估值与成交计算使用复权序列。
- 浏览器验收脚本：`pnpm --filter web test:e2e:etf`。它验证两个入口，并创建一条真实
  沪深300 ETF 策略，经 worker 回测后断言名称、两笔成交、ETF 徽标与行情图，再清理测试数据。

## 已知边界

- 已有历史份额、规模和同表 NAV，但没有申赎清单、实时 IOPV 或盘中净值，不能据此研究
  日内套利；规模也不等于可成交容量。
- `totalShare` 单位为万份，`totalSize` 为万元。真实 QDII 样本可能缺少 `totalSize` 或
  `nav`，系统保留 `null`，不使用成交价或未来观测补造。
- 份额规模通常在下一交易日早间发布，研究必须使用 `availableDate <= decisionDate`；首次
  历史回填不是原始时点快照。
- 暂未同步 ETF 每日涨跌停价格；引擎不会像 A 股个股那样拦截封板开盘成交，相关策略的
  成交可实现性需要保守解读。
- 不同 ETF 上市时间不同，回测必须遵守各自数据起点；上市前的空分片是正常状态。
- 源数据偶有“有复权因子但当天无成交行情”，系统不据此伪造价格。
- QDII ETF 是中国交易所的人民币成交代理，其收益同时包含底层市场、汇率、费用、折溢价和
  收盘时点错位；债券 ETF 也不是固定久期收益率序列，商品 ETF 还包含换月与抵押品影响。
- 货币 ETF 尚未进入 registry。收益结转、分红、复权和 T+0 语义通过真实门禁前，不把固定
  价格变化误当完整现金收益。
- registry 是截至 `selectionAsOf` 的固定代表池，不是历史每一天可得的动态 ETF 全市场，也
  不构成投资建议。
