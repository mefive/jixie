# 规划:数据扩展(Tushare 盘点 → 分波次落库)

> 2026-07-07 制定,对应 ROADMAP 4.2(需求拉动,别囤)。触发:agent 拿到只读 SQL + 图表能力后,
> 「统计分析/基本面」的**查询表达力已到位、数据本身成了短板**。本文盘点缺口、定优先级;
> 同步实现照抄现有范式(`tushare/api.ts` 加接口 → `store/sync.ts` 加幂等 sync → `scripts/` 加脚本 →
> schema 加 model + migrate),每个波次一个会话认领。

## 已入库(12 张市场表,2026-07-07 核实)

StockBasic / TradeCal / Daily / AdjFactor / StkLimit / TopList / Moneyflow / DailyBasic /
FinaIndicator(**仅 roe、roeWaa 两列**)/ Dividend / IndexWeight / IndexDaily。

## 缺口按需求归类

### 需求① agent 基本面问答与筛选(「毛利率>30% 的消费股」「负债率最低的银行」)

| Tushare 接口 | 内容 | 状态 |
|---|---|---|
| `fina_indicator`(扩列) | 毛利率 grossprofit_margin、净利率 netprofit_margin、资产负债率 debt_to_assets、营收/净利同比 or_yoy/netprofit_yoy、ROA、经营现金流/净利 | **第一优先**:表已在、sync 已在,只是当初只取了 2 列;加列 + 全量重同步(逐股全历史,限频下约数小时) |
| `income` / `balancesheet` / `cashflow` | 三大报表原始项 | 第二优先:fina_indicator 的衍生指标够用前不上;应计因子(3.5)需要时再上 |
| `forecast` / `express` | 业绩预告/快报 | 事件类,等信号/事件研究需求 |

### 需求② 3.5 预置因子候选的数据依赖(设计文档因子菜单)

| 因子候选 | 缺的数据 | 接口 |
|---|---|---|
| ROE 质量 | fina_indicator 已有 roe ✅(3.1b 后可直接写:bar 需补 roe 进 FactorBar,as-of annDate 门控——**这是 FactorBar 第一个 PIT 财务字段,需设计 as-of 语义**) | — |
| 毛利率 | fina_indicator 扩列(需求①捎带) | `fina_indicator` |
| 应计 accruals | 资产负债表 + 现金流量表 | `balancesheet` `cashflow` |
| 北向持股变化 | 陆股通持股 | `hk_hold`(注意:2024-08 后交易所停发每日北向明细,数据断点,候选价值需重估) |
| 股东户数(筹码集中度) | 股东户数 | `stk_holdernumber` |

### 需求③ 顺手补齐的行情类

| 接口 | 用途 | 备注 |
|---|---|---|
| `index_daily`(补指数) | **实测 IndexDaily 目前只有 000300.SH**——中证1000/500 等未同步,指数间相关性/对比问答会答不了(agent 已能诚实报告缺数) | 跑一次 `sync:index` 补 000852.SH/000905.SH 等,零开发 |
| `index_dailybasic` | 指数估值(全市场 PE 分位 = 择时/情绪基准) | agent 查询「现在市场贵不贵」直接可答 |
| `margin` / `margin_detail` | 融资融券(情绪/杠杆因子原料) | 4.2 原候选 |
| `suspend_d` | 停牌明细 | 现在靠「无行=停牌」推断,审计(4.7)可用它对账 |

## 落库纪律(所有波次通用)

- **PIT 门控**:财务类必须存 `annDate` 并在读取侧按公告日门控(FinaIndicator 先例);事件类(forecast)按公告日。
- **幂等**:逐股「取全历史 → upsert/重建」或逐日「deleteMany 当日 + createMany」,与现有 sync 一致,可断点续跑。
- **限频**:fina_indicator 逐股全历史 ≈ 5400 次调用,按现有 client 限频节奏预计 2~4 小时,脚本要能中断续传(已有先例)。
- **新表即入审计**:每加一张表,4.7 `audit:data` 的逐日行数对照要跟上。
- **agent 白名单同步**:新表落库后加进 `read-only-sql.ts` 的 `SQL_TABLE_DOCS`(表名+列+单位+PIT 注意事项),agent 立即可查。

## 建议波次

1. **波次一(最划算)**:fina_indicator 扩列(~8 个核心指标)+ 全量重同步 + SQL 白名单文档更新。一张表满足需求①大半 + 3.5 的 ROE/毛利率因子数据面。
2. **波次二**:index_dailybasic + stk_holdernumber(小表、接口简单)。
3. **波次三(等应计因子立项)**:三大报表。
4. 观望:hk_hold(数据断点)、forecast/express(等事件研究)。

> 未列入 = 不做:分钟线/tick(日频定位,ROADMAP 主线五明确永不做日内)、新闻舆情(数据基建重)、
> 概念板块(dc_concept 等,等主题轮动需求真的出现)。
