import type { ResearchDocumentTemplateV1 } from '@jixie/shared';
import type { CellSeed } from './cell-seed.js';
import { equityFcffValuationTemplate } from '../equity-fcff-valuation-template.js';

export function templateDefinition(template: ResearchDocumentTemplateV1): {
  title: string;
  cells: CellSeed[];
} {
  switch (template) {
    case 'blank':
      return {
        title: '未命名量化研究',
        cells: [
          {
            kind: 'markdown',
            source:
              '# 研究问题\n\n先写下问题、事前假设、样本区间和判断标准，再用 Python Cell 探索。',
          },
          {
            kind: 'python',
            source:
              '# data.series() 返回平台口径一致的 pandas DataFrame\n# result = data.series("index", "000300.SH", start="20200101", end="20251231")\n',
          },
        ],
      };
    case 'index_relationship':
      return indexRelationshipTemplate();
    case 'equity_fcff_valuation':
      return equityFcffValuationTemplate();
  }
}

export function legacyDefinition(title: string): { cells: CellSeed[] } {
  return {
    cells: [
      {
        kind: 'markdown',
        source: `# ${title || '历史研究'}\n\n此文档由旧版研究会话升级。右侧保留原有 Agent 对话；可在下方继续添加 Markdown 或 Python Cell。`,
      },
    ],
  };
}

function indexRelationshipTemplate(): { title: string; cells: CellSeed[] } {
  return {
    title: '沪深300 vs 中证500：月收益关系',
    cells: [
      {
        kind: 'markdown',
        source:
          '# 沪深300 vs 中证500：月收益关系\n\n**事前假设**：2020–2025 年间，两类宽基指数的月收益正相关。\n\n以中证500月收益 $r_{500,t}$ 为因变量、沪深300月收益 $r_{300,t}$ 为自变量，估计 $r_{500,t}=\\alpha+\\beta r_{300,t}+\\epsilon_t$。原假设为 $H_0:\\beta=0$，使用 HAC 标准误处理残差的异方差与有限阶自相关，同时查看 Pearson 相关、效应大小和 24 个月滚动相关。相关关系不代表因果，也未包含交易成本或样本外预测检验。',
      },
      {
        kind: 'python',
        source: `csi300 = data.series(
    "index", "000300.SH", start="20200101", end="20251231",
    frequency="monthly", transform="simple_return"
).rename(columns={"value": "csi300"})
csi500 = data.series(
    "index", "000905.SH", start="20200101", end="20251231",
    frequency="monthly", transform="simple_return"
).rename(columns={"value": "csi500"})
monthly = csi300.merge(csi500, on="date", how="inner")
monthly.tail(8)`,
      },
      {
        kind: 'python',
        source: `import pandas as pd
import statsmodels.api as sm

model_data = monthly[["csi300", "csi500"]].dropna()
hac_lag = max(1, int(4 * (len(model_data) / 100) ** (2 / 9)))
fit = sm.OLS(model_data["csi500"], sm.add_constant(model_data["csi300"])).fit(
    cov_type="HAC", cov_kwds={"maxlags": hac_lag}
)
relationship_summary = pd.DataFrame({
    "observations": [len(model_data)],
    "pearson": [model_data["csi300"].corr(model_data["csi500"])],
    "slope": [fit.params["csi300"]],
    "hac_se": [fit.bse["csi300"]],
    "p_value": [fit.pvalues["csi300"]],
    "ci_lower": [fit.conf_int().loc["csi300", 0]],
    "ci_upper": [fit.conf_int().loc["csi300", 1]],
    "r_squared": [fit.rsquared],
}).round(4)
relationship_summary`,
      },
      {
        kind: 'python',
        source: `rolling = monthly.assign(
    rolling_corr=monthly["csi300"].rolling(24).corr(monthly["csi500"])
).dropna(subset=["rolling_corr"])
charts.line(
    rolling, x="date", y="rolling_corr",
    labels={"rolling_corr": "24个月滚动相关"},
    title="沪深300与中证500月收益滚动相关"
)`,
      },
    ],
  };
}
