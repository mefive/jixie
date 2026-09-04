# 估值驱动基本面研究：M1 版本化三张表

> 状态：完成，待人工审阅
>
> 实现计划：[valuation-driven-fundamental-research.md](../design/valuation-driven-fundamental-research.md)

## 1. M1 做了什么

M1 把 M0 验证过的财报来源接入正式数据链路。系统现在可以保存利润表、资产负债表和现金流量表的每一个来源
版本；重复同步不会产生重复行，后续更正也不会删除首次披露值。

M1 只解决“财报事实如何可靠保存”。它还没有计算单季、TTM、ROIC、FCFF 或估值，这些属于 M2 之后。

## 2. 数据表

- `FinancialIncomeStatement`：累计利润表，金额单位为人民币元；
- `FinancialBalanceSheet`：期末资产负债表，金额单位为人民币元，`totalShare` 为股；
- `FinancialCashFlowStatement`：累计现金流量表，金额单位为人民币元；
- `FinancialCorrectionEvidence`：已经核验报告期的公开更正公告证据。

三张表各自独立版本化。每行包含来源、契约版本、报告期、公告日、实际公告日、`reportType`、`compType`、
首次观察时间、来源指纹、研究可得日和质量。来源指纹唯一；同步只追加未知指纹，不修改或删除旧版本。
后续取得已核验公告时，只允许为同一公司、报告期和公告日下唯一的来源版本补充 `exact` 证据；如果同日存在多组
供应商数值，公告日期本身无法判断哪组数值当时可用，因此不自动升级。

## 3. 同步和修复

全量初始化及周期回填继续使用现有入口：

```bash
pnpm --filter api sync:fina
```

它先按报告期同步三张版本表，再同步现有 `FinaIndicator` 和分红。三张表对 `report_type=1/4/5` 分别请求，
每个 VIP 接口按 5,000 行分页。weekly maintenance 使用独立的 `financial_statements` stage，并在每个报告期完成后
写入 checkpoint；失败重跑会跳过已完成报告期。

指定股票的修复入口按公告日期逐年切窗，避免普通接口的单次行数上限截断历史：

```bash
pnpm --filter api sync:fina -- --repair-code 000858.SZ --start 20200101 --end 20261231
```

weekly 每次重新核对完整报告期集合，缺失版本会被补入，因此同时承担版本表的周期性自愈；逐股入口处理定向修复。

## 4. PIT 和来源规则

1. 只保存 `comp_type=1` 且 `report_type=1/4/5` 的一般工商业合并累计报表。
2. `availableDate` 是实际公告日之后第一个 SSE 交易日；缺少交易日历时同步失败，不猜工作日。
3. 同一公告日的供应商数值变化标记为 `reconstructed`，严格 PIT 研究应排除。
4. 后续独立实际公告日默认标记为 `conservative`。
5. 只有公告证据明确列出受影响报告期，且对应公告日不存在多组供应商数值，才能把版本标记为 `exact`。
6. 股票代码发生继承或更名时只更新规范证券身份，来源指纹仍保留原始供应商行。

## 5. 对账和审计

现有 `FinaIndicator` 表和消费路径没有被替换。数据审计新增 `financial-statement-versions` 项，检查：

- 公告日不得早于报告期；
- 研究可得日必须严格晚于公告日；
- 质量枚举和 `reportType/compType` 范围必须合法；
- 三张表分别覆盖多少现有 `FinaIndicator` 股票报告期。

三张新表及公开更正证据已加入 Agent 只读 SQL 白名单；maintenance checkpoint 等运维表仍不可查询。

## 6. 验收

- 从空 SQLite 数据库顺序执行全部 90 个 migration 成功；
- 在隔离数据库写入一个报告期的 `1/4/5` 三张报表共 9 行，第二次同步新增 0 行；
- 在隔离数据库用真实 Tushare 修复五粮液 `20230401—20230531` 公告窗口，首次新增 14 个版本，第二次新增
  0；实际结果同时包含 `report_type=1/4/5`，并识别出一个同日供应商后补版本为 `reconstructed`；
- 类型化 API、VIP 分页、年度窗口、供应商同日后补、正式更正证据、幂等和审计均有自动测试；
- 本阶段没有用户界面变化，不需要浏览器 E2E 或截图。

M2 可以在这些只增不改的来源版本之上实现指定 `asOfDate` 的版本选择、单季/TTM 和标准化财务指标。
