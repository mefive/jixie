import type { ResearchRequestFrame } from './protocol.js';
import {
  type ResearchSeriesRuntimeRequestV1,
  type ResearchYieldCurveRuntimeRequestV1,
  type ResearchMacroRuntimeRequestV1,
  type ResearchFxRuntimeRequestV1,
  type ResearchCommodityRuntimeRequestV1,
  type ResearchCommodityHoldingRuntimeRequestV1,
  type ResearchMarketStateRuntimeRequestV1,
  type ResearchDatedIdentifierRuntimeRequestV1,
  type ResearchSingleFinancialRuntimeRequestV1,
  type ResearchFinancialCrossSectionRuntimeRequestV1,
  type ResearchFinancialPanelRuntimeRequestV1,
  type ResearchCrossSectionRuntimeRequestV1,
  type ResearchPanelRuntimeRequestV1,
  type ResearchFactorReportRuntimeRequestV1,
  type ResearchBacktestReportRuntimeRequestV1,
  type ResearchStrategyScanReportRuntimeRequestV1,
  type ResearchFactorWeatherRuntimeRequestV1,
  parseResearchSeriesRuntimeRequest,
  parseResearchYieldCurveRuntimeRequest,
  parseResearchMacroRuntimeRequest,
  parseResearchFxRuntimeRequest,
  parseResearchCommodityReturnsRuntimeRequest,
  parseResearchCommodityWarehouseReceiptsRuntimeRequest,
  parseResearchCommodityHoldingsRuntimeRequest,
  parseResearchMarketStateRuntimeRequest,
  parseResearchEquityFundamentalsRuntimeRequest,
  parseResearchEquityFlowsRuntimeRequest,
  parseResearchEquityDividendsRuntimeRequest,
  parseResearchEtfSharesRuntimeRequest,
  parseResearchIndexValuationRuntimeRequest,
  parseResearchIndustryStateRuntimeRequest,
  parseResearchFuturesSettlementRuntimeRequest,
  parseResearchFinancialValuesRuntimeRequest,
  parseResearchFinancialStatementsRuntimeRequest,
  parseResearchFinancialMetricsRuntimeRequest,
  parseResearchFinancialCrossSectionRuntimeRequest,
  parseResearchFinancialPanelRuntimeRequest,
  parseResearchCrossSectionRuntimeRequest,
  parseResearchPanelRuntimeRequest,
  parseResearchFactorReportRuntimeRequest,
  parseResearchBacktestReportRuntimeRequest,
  parseResearchStrategyScanReportRuntimeRequest,
  parseResearchFactorWeatherRuntimeRequest,
} from './validation.js';
import { type ResearchFinancialValuesRequestV1 } from '../../datasets/financial-values.js';

export type ParsedResearchRequest =
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_series';
      arguments: ResearchSeriesRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_yield_curve';
      arguments: ResearchYieldCurveRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_macro';
      arguments: ResearchMacroRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_fx';
      arguments: ResearchFxRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_commodity_returns' | 'research_commodity_warehouse_receipts';
      arguments: ResearchCommodityRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_commodity_holdings';
      arguments: ResearchCommodityHoldingRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_market_state';
      arguments: ResearchMarketStateRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method:
        | 'research_equity_fundamentals'
        | 'research_equity_flows'
        | 'research_equity_dividends';
      arguments: ResearchDatedIdentifierRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method:
        | 'research_etf_shares'
        | 'research_index_valuation'
        | 'research_industry_state'
        | 'research_futures_settlement';
      arguments: ResearchDatedIdentifierRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_equity_financial_values';
      arguments: ResearchFinancialValuesRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_equity_financial_statements' | 'research_equity_financial_metrics';
      arguments: ResearchSingleFinancialRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_equity_financial_cross_section';
      arguments: ResearchFinancialCrossSectionRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_equity_financial_panel';
      arguments: ResearchFinancialPanelRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_cross_section';
      arguments: ResearchCrossSectionRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_panel';
      arguments: ResearchPanelRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_factor_report';
      arguments: ResearchFactorReportRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_backtest_report';
      arguments: ResearchBacktestReportRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_strategy_scan_report';
      arguments: ResearchStrategyScanReportRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_factor_weather';
      arguments: ResearchFactorWeatherRuntimeRequestV1;
    });

export function parseResearchRequestFrame(frame: ResearchRequestFrame): ParsedResearchRequest {
  switch (frame.method) {
    case 'research_series':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_series',
        arguments: parseResearchSeriesRuntimeRequest(frame.arguments),
      };
    case 'research_yield_curve':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_yield_curve',
        arguments: parseResearchYieldCurveRuntimeRequest(frame.arguments),
      };
    case 'research_macro':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_macro',
        arguments: parseResearchMacroRuntimeRequest(frame.arguments),
      };
    case 'research_fx':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_fx',
        arguments: parseResearchFxRuntimeRequest(frame.arguments),
      };
    case 'research_commodity_returns':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_commodity_returns',
        arguments: parseResearchCommodityReturnsRuntimeRequest(frame.arguments),
      };
    case 'research_commodity_warehouse_receipts':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_commodity_warehouse_receipts',
        arguments: parseResearchCommodityWarehouseReceiptsRuntimeRequest(frame.arguments),
      };
    case 'research_commodity_holdings':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_commodity_holdings',
        arguments: parseResearchCommodityHoldingsRuntimeRequest(frame.arguments),
      };
    case 'research_market_state':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_market_state',
        arguments: parseResearchMarketStateRuntimeRequest(frame.arguments),
      };
    case 'research_equity_fundamentals':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_fundamentals',
        arguments: parseResearchEquityFundamentalsRuntimeRequest(frame.arguments),
      };
    case 'research_equity_flows':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_flows',
        arguments: parseResearchEquityFlowsRuntimeRequest(frame.arguments),
      };
    case 'research_equity_dividends':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_dividends',
        arguments: parseResearchEquityDividendsRuntimeRequest(frame.arguments),
      };
    case 'research_etf_shares':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_etf_shares',
        arguments: parseResearchEtfSharesRuntimeRequest(frame.arguments),
      };
    case 'research_index_valuation':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_index_valuation',
        arguments: parseResearchIndexValuationRuntimeRequest(frame.arguments),
      };
    case 'research_industry_state':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_industry_state',
        arguments: parseResearchIndustryStateRuntimeRequest(frame.arguments),
      };
    case 'research_futures_settlement':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_futures_settlement',
        arguments: parseResearchFuturesSettlementRuntimeRequest(frame.arguments),
      };
    case 'research_equity_financial_values':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_financial_values',
        arguments: parseResearchFinancialValuesRuntimeRequest(frame.arguments),
      };
    case 'research_equity_financial_statements':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_financial_statements',
        arguments: parseResearchFinancialStatementsRuntimeRequest(frame.arguments),
      };
    case 'research_equity_financial_metrics':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_financial_metrics',
        arguments: parseResearchFinancialMetricsRuntimeRequest(frame.arguments),
      };
    case 'research_equity_financial_cross_section':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_financial_cross_section',
        arguments: parseResearchFinancialCrossSectionRuntimeRequest(frame.arguments),
      };
    case 'research_equity_financial_panel':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_financial_panel',
        arguments: parseResearchFinancialPanelRuntimeRequest(frame.arguments),
      };
    case 'research_cross_section':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_cross_section',
        arguments: parseResearchCrossSectionRuntimeRequest(frame.arguments),
      };
    case 'research_panel':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_panel',
        arguments: parseResearchPanelRuntimeRequest(frame.arguments),
      };
    case 'research_factor_report':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_factor_report',
        arguments: parseResearchFactorReportRuntimeRequest(frame.arguments),
      };
    case 'research_backtest_report':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_backtest_report',
        arguments: parseResearchBacktestReportRuntimeRequest(frame.arguments),
      };
    case 'research_strategy_scan_report':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_strategy_scan_report',
        arguments: parseResearchStrategyScanReportRuntimeRequest(frame.arguments),
      };
    case 'research_factor_weather':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_factor_weather',
        arguments: parseResearchFactorWeatherRuntimeRequest(frame.arguments),
      };
  }
}
