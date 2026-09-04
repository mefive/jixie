# 估值驱动基本面研究：M3 Research 数据能力

> 状态：完成，待人工审阅
>
> 实现计划：[valuation-driven-fundamental-research.md](../design/valuation-driven-fundamental-research.md)

## 1. M3 交付了什么

M3 把 M1 保存的版本化财报和 M2 的财务计算内核变成了 Research 用户可以直接调用的数据能力。用户不需要写
SQL，也不需要了解 Prisma 表：在普通 Python Cell 中调用以下四个方法即可。

```python
data.equity_financial_statements("000858.SZ", as_of="20240429")
data.equity_financial_metrics("000858.SZ", as_of="20240429")
data.equity_financial_cross_section(
    "index:000300.SH",
    date="20240429",
    metrics=["revenue", "returnOnInvestedCapital"],
)
data.equity_financial_panel(
    "index:000300.SH",
    start="20200101",
    end="20241231",
    frequency="month_end",
    metrics=["revenueGrowthYoY", "returnOnInvestedCapital"],
)
```

这四个方法的签名、参数白名单和返回列只有一个来源：Research SDK Contract。Python Runtime 校验、生成的
Pyright/Monaco stub、数据目录和 Agent Catalog 都从同一契约读取，避免“文档能写、运行时不能跑”或字段漂移。

## 2. 返回数据

单股财报返回 `报告期 × 报表 × 科目` 长表，保留：

- 研究估值日、报告期、报表种类、字段、值和单位；
- 实际公告日、研究可得日和 `availability_quality`；
- 报表类型和不可变来源行指纹。

单股指标返回估值日当时已知的全部报告期和 32 个 M2 指标。截面与 Panel 返回 `日期 × 股票 × 指标` 长表。
每行除数值和单位外，还保留 `status`、`missing_reason`、明文公式、`formula_version` 和
`input_versions_json`。因此缺数据、公式不适用和正常的零不会混为一谈。

银行和非银金融不会被工业企业公式悄悄计算：单股工业企业财报读取会明确拒绝；截面和 Panel 为保持股票池完整，
返回 `not_applicable` 行。M3 没有改变 M2 的任何会计公式。

## 3. 批量读取与资源边界

截面不是循环调用单股接口。一个历史截面的财报层固定使用三次报表批量查询和一次历史行业查询，查询条件使用
`tsCode IN (...)`；市值快照复用股票池 loader 已取得的结果。批量财报只读取估值日前五年的报告期，足够计算
最新 TTM、三年收入 CAGR 和平均资本，同时避免把上市以来全部历史搬入内存。

资源边界如下：

- 一次最多选择 8 个财务指标；
- 单股财报和单股指标分别最多 10,000 行；
- 财务截面最多 50,000 行；
- 财务 Panel 最多 100,000 行；Panel 会按指标数提前收紧底层股票行预算，而不是加载完整大表后才拒绝。

Panel 按每个已完成月末分别解析当时股票池和财报版本，查询次数随月份增长，但不随当月股票数量增长。M3 没有
新增派生指标表或缓存；是否物化仍由重复研究的真实性能决定。

## 4. 数据目录、编辑器与 Agent

数据目录现在展示四个基本面方法及本地 `availableDate` 覆盖。用户可以选择股票代码、估值日、股票池和最多八个
指标，预览并插入准确的 Python 调用。返回列可悬浮查看中英文含义，包括单位、状态、缺失原因、版本和可得日。

生成的 Python stub 为指标参数提供固定 `Literal` 列表。Monaco/Pyright 可以补全新方法，并在运行前标出未知
指标。Agent 若要生成任何 `data.*` 调用，必须先在当轮数据目录中查询该方法的精确契约；财务方法不再是例外。

中英文帮助已说明四个入口、长表结构、行数上限、金融行业边界和严格 PIT 规则。

## 5. 真实数据与性能验收

真实验证先将五粮液 2019-01-01 至 2026-09-04 的三张表补入本地开发库，共保存 204 个不可变来源版本：利润表
78 行、资产负债表 58 行、现金流量表 68 行。

- `as_of=20240429` 回看 2022 年收入，读取 2023-05-04 可得的正式口径；`as_of=20240430` 切换到当日可得的
  调整后口径，两个结果保留不同来源指纹；
- `as_of=20250428` 返回 960 行单股指标，耗时约 10.4ms；2024 年收入为
  `89,175,178,322.70` 元，ROIC 为 `252.7463%`，FCFF 为 `42,586,367,555.87` 元，与 M2 真实核对一致；
- 全 A 股 `20250428` 截面包含 5,142 只股票。选择 8 个指标返回 41,136 行，实测约 0.84 秒，进程堆内存增量
  约 39.8 MiB、RSS 增量约 106 MiB；当前只回填了五粮液版本化财报，因此其余工业企业正确返回 `missing`，
  金融企业返回 `not_applicable`，没有用旧 `FinaIndicator` 冒充覆盖。

## 6. 自动验收

- 针对契约、版本切换、批量查询、公式名单同步、返回行、资源限制、Runtime、Agent、数据目录和 Pyright 的
  83 项聚焦测试通过；
- API 全量 916 项测试通过，另有 1 项既有集成测试按原配置跳过；
- 根目录类型检查、SDK/runtime 生成一致性检查和 API/Web 构建通过；全仓源码 lint 在排除本机 `.venv` 依赖目录后
  通过，仅保留 1 条既有 warning；全部 M3 变更文件单独 lint 零警告；
- 浏览器完成四个方法的 Research 全文干净运行，输出行数依次为 1、3、2、2；
- 数据目录 E2E 验证 20 个数据方法、财务列说明、财务代码预览和插入；
- 截图：`apps/web/acceptance/research-financial-metrics.png`、
  `apps/web/acceptance/research-financial-panel.png`、
  `apps/web/acceptance/research-data-catalog-financial-metrics.png`。

## 7. 已知限制

- M3 只提供历史事实和确定性派生指标，不包含预测、DCF、目标价或叙事参数；这些属于 M4；
- 当前版本化三张表尚未全市场回填。目录只声明本地整体可得日覆盖，具体股票仍可能返回空表或 `missing`；
- V1 仍只计算一般工商业口径，不为银行、保险和券商套用 FCFF；
- 单股指标返回估值日当时已知的全部报告期，因此研究者需要显式选择目标报告期；截面和 Panel 只返回每个时点的
  最新报告期；
- 返回的输入版本是 JSON 字符串，以保持固定 DataFrame 列类型；需要展开时由研究代码显式解析。
