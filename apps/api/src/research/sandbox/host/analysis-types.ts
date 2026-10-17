export interface ResearchPythonAnalysis {
  cellId: string;
  definitions: string[];
  references: string[];
  imports?: string[];
  seriesRequests?: ResearchPythonSeriesRequest[];
  yieldCurveRequests?: ResearchPythonYieldCurveRequest[];
  macroRequests?: ResearchPythonMacroRequest[];
  fxRequests?: ResearchPythonFxRequest[];
  commodityRequests?: ResearchPythonCommodityRequest[];
  equityRequests?: ResearchPythonEquityRequest[];
  error?: string;
}

export interface ResearchPythonSeriesRequest {
  line: number;
  assetType: string | null;
  identifier: string | null;
  measure: string | null;
}

export interface ResearchPythonYieldCurveRequest {
  line: number;
  curve: string | null;
  tenor: string | null;
}

export interface ResearchPythonMacroRequest {
  line: number;
  series: string | null;
}

export interface ResearchPythonFxRequest {
  line: number;
  pair: string | null;
}

export interface ResearchPythonCommodityRequest {
  line: number;
  method: 'commodity_returns' | 'commodity_warehouse_receipts' | 'commodity_holdings';
  product: string | null;
}

export interface ResearchPythonEquityRequest {
  line: number;
  method:
    | 'equity_fundamentals'
    | 'equity_flows'
    | 'equity_dividends'
    | 'etf_shares'
    | 'index_valuation'
    | 'industry_state'
    | 'futures_settlement'
    | 'equity_financial_values'
    | 'equity_financial_statements'
    | 'equity_financial_metrics'
    | 'equity_financial_cross_section'
    | 'equity_financial_panel';
  identifier: string | null;
}
