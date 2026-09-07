# 基本面数据查询与产品定位调整交付报告

日期：2026-09-07。基于 `7787f21b`，本轮实施及技术验收完成，用户已通过提交前审阅并授权提交。

## 交付结果与入口

研究平台负责数据来源、字段口径、历史可得时间、缺失说明和公式实现；用户决定计算方法、预测假设和投资结论。FCFF 模板、市场对照及 M6 量化验证保留为可选工具，正式 Factor/Strategy 的准入要求不变。

本轮能力直接供 Research 用户和 Agent 使用，已贯通公开 SDK 契约、Python runtime、API、编辑器补全、数据目录和中英文帮助。

| 入口 | 本轮交付 |
|---|---|
| `data.equity_financial_statements` | 保留原有单公司查询和返回结构；增加可选 `fields`、`report_start`、`report_end` |
| `data.equity_financial_values` | 批量选择公司、科目、报告期和原报表/年度/单季/TTM 口径，返回长表 |
| Research → 数据目录 → 数据集 → 自选财报科目与计算口径 | 配置上述参数并插入 Python Cell；历史可得截止日和报告期区间分别展示 |
| `/docs/help/research/financial-data` | 新增中英文操作与数据口径帮助；财报与 FCFF 帮助均可通过公开导航访问 |
| `/docs/sdk?runtime=research#data.equity_financial_values` | 新增从 Research SDK Contract 生成的公开参考页，覆盖现有 36 个方法；原 Strategy SDK 保留 |

新方法签名（字段实际为显式枚举）：

```python
data.equity_financial_values(
    identifiers,
    *,
    as_of,
    fields,
    report_start,
    report_end,
    period="reported",
)
```

公开字段共 66 个：利润表 11 个、资产负债表 43 个、现金流量表 12 个。字段名单来自人工维护的公开映射，不从 Prisma 自动暴露。字段参数使用 `income.revenue` 等限定名称，返回表仍分别提供 `statement_kind` 和 `field`。

## 计算与保守处理

- `as_of` 约束来源版本的可得日期；`report_start` / `report_end` 约束输出报告期。单次最多 100 家公司、16 个科目、20 个报告年度和 100,000 行，入参在查询前校验。
- `reported` 保留来源值；`annual` 选取年末报告；流量单季值复用现有累计差分内核；TTM 复用连续季度内核，年末可直接使用全年累计值。计算预取输出区间之前的必要报告。
- 存量科目始终保持时点值，并返回 `period_basis=point_in_time`。现金及现金等价物期初/期末余额的字段语义修正为存量；不改变来源金额或既有财务指标公式。
- 返回单位、报告期、可得日期、状态、缺失原因、公式版本和输入版本指纹。缺失值不填零，缺报和版本歧义不静默回退；非标准报告期无法转换时保留来源指纹并说明原因。
- 原始财报查询与工业企业估值模型适用性分离。负值不因模型约束被抹去；既有指标和 FCFF helper 的适用性判断保留。
- 金融企业来源字段仍未接入，批量接口显式返回 `financial_sector_source_not_integrated`。这次未扩展数据源、改表、迁移或重写原始财报。

## 验证结果

| 检查 | 结果 |
|---|---|
| API 全量测试 | 184 个测试文件通过、1 个跳过；955 个测试通过、1 个跳过 |
| 最后边界修正后定向测试 | 财报查询、字段值和 SDK 校验共 26 个通过；覆盖非法日期与非标准报告期来源追踪 |
| 前端目录与 SDK 语言测试 | 22 个通过 |
| SDK 生成物一致性与类型检查 | `pnpm check:research-sdk`、`pnpm typecheck` 通过 |
| 构建 | 全仓 `pnpm build` 通过；公开 SDK 页完成后再次执行 `pnpm --filter docs build` 通过；保留已有 chunk 大小警告 |
| 代码检查 | `pnpm exec eslint apps packages scripts`：0 错误、1 个已有的 `spec.ts` 未使用变量警告；修改代码格式检查通过 |
| 数据目录浏览器 E2E | 21 个数据方法；新查询参数配置与代码插入通过，9 张截图 |
| 财报查询浏览器 E2E | 6 个 Cell，5 个数据方法，输出行数 1/3/2/2/36；3 张截图 |
| 原 FCFF 浏览器 E2E | 29 个 Cell、3 个情景、反推求解、4 项复核、stale 与固化流程均通过；5 张截图 |
| 公开帮助与 SDK 浏览器 E2E | 中文、英文、FCFF 帮助、Research SDK 导航及浏览器返回均通过；3 张截图 |

根级 `pnpm lint` 会扫描本地 `.venv` 中的第三方 JavaScript 并失败，因此本轮使用上表所列源码目录范围执行 ESLint；未改动项目 lint 配置或第三方文件。

真实数据库只读检查：以 `20260506` 为可得截止日，查询五粮液、美的集团、宁德时代和平安银行在 2023–2025 年的营业收入、总资产和经营现金流年度值。共返回 36 行：三家非金融公司 27 行有值，平安银行 9 行明确标记来源未接入。一次实测耗时约 83ms，仅作本次样本记录，不代表性能保证。旧原始财报接口按营业收入和同一报告区间筛选返回 12 行。

复现浏览器检查：

```sh
pnpm --filter web test:e2e:research-data-catalog
pnpm --filter web test:e2e:research-financial-data
pnpm --filter web test:e2e:research-fcff-valuation
pnpm --filter web exec node e2e/research-financial-help.mjs
```

最后一项默认使用独立文档服务 `localhost:5174`，可通过 `E2E_DOCS_BASE` 调整。E2E 临时文档由测试清理，既有三份用户 Research 未改动。

## 审阅文件与截图

- [公开 SDK 契约](../../packages/shared/src/research-sdk-contract.ts)
- [字段值查询与计算](../../apps/api/src/research/financial-values.ts)
- [旧财报接口筛选](../../apps/api/src/research/financial-dataset.ts)
- [查询配置界面](../../apps/web/src/complex/research/research-data-catalog-drawer.tsx)
- [Research SDK 公开参考页](../../apps/docs/src/complex/sdk/research-sdk.tsx)
- [中文帮助](../../apps/docs/src/content/help/zh/research/financial-data.md)

截图保存在本地验收目录（该目录不进入 Git）：

- `apps/web/acceptance/research-data-catalog-financial-values.png`
- `apps/web/acceptance/research-financial-values.png`
- `apps/web/acceptance/research-financial-help-zh.png`
- `apps/web/acceptance/research-financial-help-en.png`
- `apps/web/acceptance/research-financial-sdk-en.png`

## 本轮未覆盖与剩余限制

本轮验证查询、计算和产品链路，没有重新逐份核对公告 PDF，也没有重新进行全市场数据覆盖审计；已有报告中的样本数量与核对结论不能据此扩大。本轮四公司检查不等于全库完整性证明。

现有来源历史修订留存和主营分部历史可得性仍有缺口。查询按现有版本记录执行 as-of 过滤，并不补造缺失的历史版本，因此不能据此宣称全历史严格 PIT。金融企业仍需单独接入来源和字段映射。

未进行新的策略收益、样本外预测力或价格兑现验证：这些属于用户选择的研究，不是本轮数据查询交付条件。本轮不涉及数据库 schema，故无需迁移检查。

临时 API/Web/文档服务均已关闭；已确认 3001、5173、5174 端口无监听，sandboxd 临时 socket 已移除，本地数据库无打开连接。
