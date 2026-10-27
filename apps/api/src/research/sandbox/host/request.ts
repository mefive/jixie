import type { ResearchRequestFrame } from './protocol.js';
import {
  type ResearchSeriesRuntimeRequestV1,
  type ResearchYieldCurveRuntimeRequestV1,
  type ResearchMacroRuntimeRequestV1,
  type ResearchFxRuntimeRequestV1,
  type ResearchDatedIdentifierRuntimeRequestV1,
  type ResearchSingleFinancialRuntimeRequestV1,
  type ResearchFinancialCrossSectionRuntimeRequestV1,
  type ResearchFinancialPanelRuntimeRequestV1,
  type ResearchCrossSectionRuntimeRequestV1,
  type ResearchPanelRuntimeRequestV1,
  type ResearchFactorReportRuntimeRequestV1,
  type ResearchBacktestReportRuntimeRequestV1,
  type ResearchStrategyScanReportRuntimeRequestV1,
  parseResearchSeriesRuntimeRequest,
  parseResearchYieldCurveRuntimeRequest,
  parseResearchMacroRuntimeRequest,
  parseResearchFxRuntimeRequest,
  parseResearchEquityFundamentalsRuntimeRequest,
  parseResearchEquityDividendsRuntimeRequest,
  parseResearchEtfSharesRuntimeRequest,
  parseResearchIndexValuationRuntimeRequest,
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
} from './validation.js';
import { type ResearchFinancialValuesRequestV1 } from '../../datasets/financial-values.js';

/**
 * 以方法区分已校验宿主请求，供穷尽分派。
 *
 * Discriminate validated host requests by SDK method for dispatch.
 */
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
      method: 'research_equity_fundamentals' | 'research_equity_dividends';
      arguments: ResearchDatedIdentifierRuntimeRequestV1;
    })
  | (Omit<ResearchRequestFrame, 'method' | 'arguments'> & {
      method: 'research_etf_shares' | 'research_index_valuation';
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
    });

/**
 * 按消息方法解析 SDK 参数，执行共享契约校验后生成可分派请求。
 *
 * Parse SDK method frames and validate shared-contract arguments before dispatch.
 */
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
    case 'research_equity_fundamentals':
      return {
        type: frame.type,
        id: frame.id,
        method: 'research_equity_fundamentals',
        arguments: parseResearchEquityFundamentalsRuntimeRequest(frame.arguments),
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
  }
}
