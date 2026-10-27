/**
 * 记录 Python Cell 定义、读取和依赖问题，供 DAG 管理。
 *
 * Describe Python cell definitions, references and dependency issues.
 */
export interface ResearchPythonAnalysis {
  cellId: string;
  definitions: string[];
  references: string[];
  imports?: string[];
  seriesRequests?: ResearchPythonSeriesRequest[];
  yieldCurveRequests?: ResearchPythonYieldCurveRequest[];
  macroRequests?: ResearchPythonMacroRequest[];
  fxRequests?: ResearchPythonFxRequest[];
  equityRequests?: ResearchPythonEquityRequest[];
  error?: string;
}

/**
 * 描述已解析的受控序列 SDK 参数。
 *
 * Describe validated governed-series SDK arguments.
 */
export interface ResearchPythonSeriesRequest {
  line: number;
  assetType: string | null;
  identifier: string | null;
  measure: string | null;
}

/**
 * 描述已解析的利率曲线 SDK 参数。
 *
 * Describe validated yield-curve SDK arguments.
 */
export interface ResearchPythonYieldCurveRequest {
  line: number;
  curve: string | null;
  tenor: string | null;
}

/**
 * 描述已解析的宏观版本 SDK 参数。
 *
 * Describe validated macro-vintage SDK arguments.
 */
export interface ResearchPythonMacroRequest {
  line: number;
  series: string | null;
}

/**
 * 描述已解析的外汇货币对 SDK 参数。
 *
 * Describe validated FX-pair SDK arguments.
 */
export interface ResearchPythonFxRequest {
  line: number;
  pair: string | null;
}

/**
 * 描述已解析的股票研究 SDK 参数。
 *
 * Describe validated equity research SDK arguments.
 */
export interface ResearchPythonEquityRequest {
  line: number;
  method:
    | 'equity_fundamentals'
    | 'equity_dividends'
    | 'etf_shares'
    | 'index_valuation'
    | 'equity_financial_values'
    | 'equity_financial_statements'
    | 'equity_financial_metrics'
    | 'equity_financial_cross_section'
    | 'equity_financial_panel';
  identifier: string | null;
}
