# 自主分析财报数据

Research 提供数据和可复现的计算。你决定研究问题、选哪些字段、采用什么公式，以及如何解释结果。
FCFF 是可选模板；比较收入、资产或现金流不需要先建立估值模型，也不需要证明某个策略能盈利。

## 从数据目录开始

1. 打开研究文档的“数据目录”，选择“数据集”。
2. 搜索“自选财报科目”，选择“自选财报科目与计算口径”。
3. 输入股票代码；多只股票用逗号分隔。
4. 选择财报科目、报告期范围、计算口径和历史可用日期。
5. 检查代码预览，插入 Python Cell，运行后查看表格。代码和后续计算都可以修改。

科目使用明确的 `表名.字段名`，例如 `income.revenue` 和 `balance_sheet.totalAssets`。[Research SDK参考](/docs/sdk?runtime=research#data.equity_financial_values)和编辑器补全提供全部可选项。

## 两种日期分别控制什么

- `report_start`、`report_end`：要研究哪些报告期，边界包含在内。
- `as_of`：站在哪一天看资料；全部计算输入必须在该日或此前可用。

例如站在2026年5月查看2023–2025年财报，可能看到截至2026年5月已知的修订；不能把这张表当作2023年投资时已知的数据。
若研究历史股票池各月末当时的指标，使用 `data.equity_financial_panel()`。自选股票列表不会自动还原历史指数成分。

```python
financial_values = data.equity_financial_values(
    ["000858.SZ", "600519.SH"],
    as_of="20260506",
    fields=["income.revenue", "balance_sheet.totalAssets"],
    report_start="20230101",
    report_end="20251231",
    period="annual",
)
financial_values
```

## 选择计算口径

| period | 收入、成本和现金流等流量字段 | 资产、负债及期初/期末现金等存量字段 |
|---|---|---|
| `reported` | 原报表年初至今累计值 | 原报表时点值 |
| `annual` | 仅12月年报全年值 | 仅12月年报时点值 |
| `quarterly` | Q1取原值；之后以相邻累计值相减 | 保留原报表时点值 |
| `ttm` | 年末直接取全年值；其他期要求连续四季 | 保留原报表时点值，不自动平均 |

存量字段的 `period_basis` 是 `point_in_time`。期初现金保留原累计报表的期初，不能当作每个季度的期初余额。
接口先读取转换所需的前置报告，再筛选输出报告期；缺失季度不会被填零或用其他口径代替。

每次最多100只股票、16个科目、20个报告年份及100000行。返回按代码、科目和报告期组织的长表；缺失观察也保留。

## 查看原始字段和预定义指标

`data.equity_financial_statements()` 保留原始报表字段、公告日、版本质量和来源指纹，新增可选筛选：

```python
statements = data.equity_financial_statements(
    "000858.SZ", as_of="20260506",
    fields=["income.revenue", "cash_flow.nCashflowAct"],
    report_start="20230101", report_end="20251231",
)
```

省略三个筛选参数时保持原有调用语义。返回的 `field` 列仍是 `revenue` 等不带表名前缀的名称，结合 `statement_kind` 识别科目。

`data.equity_financial_metrics()` 提供平台32个预定义指标及公式。你可以采用，也可以从基础科目自行计算。
旧接口 `data.equity_fundamentals()` 读取供应商已有指标，没有同等历史版本和公式血缘；其中 `_pct` 使用百分数，不能与新指标的 `ratio` 混用（`ratio=1`表示100%）。

## 缺失和适用范围

检查 `value`、`unit`、`period_basis`、`status`、`missing_reason`，并保留 `formula`、`formula_version`、`input_versions_json`。
`available_date` 是参与本行计算的输入版本中最晚的可得日；缺少输入时不代表数据已经完整。

`status=ok` 表示取得并按所选口径转换了数据，不表示完成审计，也不表示适合某种估值模型。原始负值会保留；预定义指标仍有自己的会计异常检查。

当前只接入一般工商业A股的映射字段，金融企业来源尚未接入。批量接口会返回 `financial_sector_source_not_integrated`；原始报表接口没有已接入记录时返回空表。金融企业的工业模型指标仍为 `not_applicable`。

严格历史查询排除 `reconstructed` 版本，但不据此保证供应商所有历史首次披露版本完整。附注、业务分部和一致预期也尚未接入本接口。
