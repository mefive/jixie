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
  parseResearchSeriesRuntimeRows,
  parseResearchCommodityReturnsRuntimeRows,
  parseResearchCommodityWarehouseReceiptsRuntimeRows,
  parseResearchCommodityHoldingsRuntimeRows,
  parseResearchMarketStateRuntimeRows,
  parseResearchEquityFundamentalsRuntimeRows,
  parseResearchEquityFlowsRuntimeRows,
  parseResearchEquityDividendsRuntimeRows,
  parseResearchEtfSharesRuntimeRows,
  parseResearchIndexValuationRuntimeRows,
  parseResearchIndustryStateRuntimeRows,
  parseResearchFuturesSettlementRuntimeRows,
  parseResearchFinancialValuesRuntimeRows,
  parseResearchFinancialStatementsRuntimeRows,
  parseResearchFinancialMetricsRuntimeRows,
  parseResearchEquityDatasetRuntimeRows,
  parseResearchFactorWeatherRuntimeRows,
} from './validation.js';
import {
  type ResearchFinancialValuesRequestV1,
  loadResearchFinancialValues,
} from '../datasets/financial-values.js';
import type { PythonSession } from '../../infra/runtime/python/session.js';
import {
  researchSeriesLoadStart,
  loadResearchSeries,
  prepareResearchSeries,
} from '../datasets/series.js';
import { researchYieldCurveSourceForSdkCall } from '../catalog/concept-bindings.js';
import {
  loadResearchCommodityReturns,
  loadResearchCommodityWarehouseReceipts,
  loadResearchCommodityHoldings,
} from '../datasets/commodity.js';
import {
  loadResearchMarketState,
  loadResearchEquityFundamentals,
  loadResearchEquityFlows,
  loadResearchEquityDividends,
} from '../datasets/supplemental.js';
import {
  loadResearchEtfShares,
  loadResearchIndexValuation,
  loadResearchIndustryState,
  loadResearchFuturesSettlement,
} from '../datasets/market-reference.js';
import {
  loadResearchFinancialStatements,
  loadResearchFinancialMetrics,
  loadResearchFinancialCrossSection,
  loadResearchFinancialPanel,
} from '../datasets/financial.js';
import { loadResearchCrossSection, loadResearchPanel } from '../datasets/equity.js';
import { loadResearchFactorReportResult } from '../datasets/results/factor-report.js';
import { loadResearchBacktestReportResult } from '../datasets/results/backtest-report.js';
import {
  loadResearchStrategyScanReportResult,
  loadResearchFactorWeatherResult,
} from '../datasets/results/scan-and-weather.js';
import type { ResearchSeriesInputSpecV1 } from '@jixie/shared';

type ParsedResearchRequest =
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

function parseResearchRequestFrame(frame: ResearchRequestFrame): ParsedResearchRequest {
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

async function answerResearchRequest(
  documentId: string,
  session: Pick<PythonSession, 'send'>,
  frame: ParsedResearchRequest,
): Promise<void> {
  const id = frame.id;
  try {
    let result: Record<string, unknown>;
    switch (frame.method) {
      case 'research_series': {
        const request = frame.arguments;
        const input = {
          type: 'series' as const,
          id: `${request.asset_type}:${request.identifier}`,
          source: {
            kind: 'instrument' as const,
            assetType: request.asset_type,
            id: request.identifier,
          },
          measure: request.measure,
          transform: request.transform,
        };
        const loadStart = researchSeriesLoadStart(
          request.start,
          request.frequency,
          request.transform,
        );
        const loaded = await loadResearchSeries(input, loadStart, request.end);
        const points = prepareResearchSeries(loaded.points, request.frequency, request.transform, {
          start: request.start,
          end: request.end,
          partialPeriod: request.partial_period,
        });
        result = {
          rows: parseResearchSeriesRuntimeRows(points),
          diagnostics: loaded.diagnostics,
        };
        break;
      }
      case 'research_yield_curve': {
        const request = frame.arguments;
        const binding = researchYieldCurveSourceForSdkCall(request.curve, request.tenor);
        if (!binding) {
          throw new Error(
            `yield curve ${request.curve}:${request.tenor} is not in the governed Research SDK catalog`,
          );
        }
        const input = {
          type: 'series' as const,
          id: `${request.curve}:${request.tenor}`,
          source: binding.source,
          measure: binding.measure,
          transform: request.transform,
        };
        const loadStart = researchSeriesLoadStart(
          request.start,
          request.frequency,
          request.transform,
        );
        const loaded = await loadResearchSeries(input, loadStart, request.end);
        const points = prepareResearchSeries(loaded.points, request.frequency, request.transform, {
          start: request.start,
          end: request.end,
          partialPeriod: request.partial_period,
        });
        result = {
          rows: parseResearchSeriesRuntimeRows(points),
          diagnostics: loaded.diagnostics,
        };
        break;
      }
      case 'research_macro': {
        const request = frame.arguments;
        result = await loadAndPrepareResearchSeries({
          request,
          input: {
            type: 'series',
            id: request.series,
            source: { kind: 'macro', seriesKey: request.series },
            measure: 'macro.observation',
            transform: request.transform,
          },
        });
        break;
      }
      case 'research_fx': {
        const request = frame.arguments;
        result = await loadAndPrepareResearchSeries({
          request,
          input: {
            type: 'series',
            id: request.pair,
            source: { kind: 'fx', id: request.pair },
            measure: 'fx.mid_close',
            transform: request.transform,
          },
        });
        break;
      }
      case 'research_commodity_returns': {
        result = {
          rows: parseResearchCommodityReturnsRuntimeRows(
            await loadResearchCommodityReturns(frame.arguments),
          ),
        };
        break;
      }
      case 'research_commodity_warehouse_receipts': {
        result = {
          rows: parseResearchCommodityWarehouseReceiptsRuntimeRows(
            await loadResearchCommodityWarehouseReceipts(frame.arguments),
          ),
        };
        break;
      }
      case 'research_commodity_holdings': {
        result = {
          rows: parseResearchCommodityHoldingsRuntimeRows(
            await loadResearchCommodityHoldings(frame.arguments),
          ),
        };
        break;
      }
      case 'research_market_state': {
        result = {
          rows: parseResearchMarketStateRuntimeRows(await loadResearchMarketState(frame.arguments)),
        };
        break;
      }
      case 'research_equity_fundamentals': {
        result = {
          rows: parseResearchEquityFundamentalsRuntimeRows(
            await loadResearchEquityFundamentals(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_flows': {
        result = {
          rows: parseResearchEquityFlowsRuntimeRows(await loadResearchEquityFlows(frame.arguments)),
        };
        break;
      }
      case 'research_equity_dividends': {
        result = {
          rows: parseResearchEquityDividendsRuntimeRows(
            await loadResearchEquityDividends(frame.arguments),
          ),
        };
        break;
      }
      case 'research_etf_shares': {
        result = {
          rows: parseResearchEtfSharesRuntimeRows(await loadResearchEtfShares(frame.arguments)),
        };
        break;
      }
      case 'research_index_valuation': {
        result = {
          rows: parseResearchIndexValuationRuntimeRows(
            await loadResearchIndexValuation(frame.arguments),
          ),
        };
        break;
      }
      case 'research_industry_state': {
        result = {
          rows: parseResearchIndustryStateRuntimeRows(
            await loadResearchIndustryState(frame.arguments),
          ),
        };
        break;
      }
      case 'research_futures_settlement': {
        result = {
          rows: parseResearchFuturesSettlementRuntimeRows(
            await loadResearchFuturesSettlement(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_financial_values': {
        result = {
          rows: parseResearchFinancialValuesRuntimeRows(
            await loadResearchFinancialValues(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_financial_statements': {
        result = {
          rows: parseResearchFinancialStatementsRuntimeRows(
            await loadResearchFinancialStatements(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_financial_metrics': {
        result = {
          rows: parseResearchFinancialMetricsRuntimeRows(
            await loadResearchFinancialMetrics(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_financial_cross_section': {
        result = {
          rows: parseResearchFinancialMetricsRuntimeRows(
            await loadResearchFinancialCrossSection(frame.arguments),
          ),
        };
        break;
      }
      case 'research_equity_financial_panel': {
        result = {
          rows: parseResearchFinancialMetricsRuntimeRows(
            await loadResearchFinancialPanel(frame.arguments),
          ),
        };
        break;
      }
      case 'research_cross_section': {
        const request = frame.arguments;
        const loaded = await loadResearchCrossSection(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      case 'research_panel': {
        const request = frame.arguments;
        const loaded = await loadResearchPanel(request);
        result = {
          rows: parseResearchEquityDatasetRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
      case 'research_factor_report': {
        result = await loadResearchFactorReportResult(documentId, frame.arguments.report_id);
        break;
      }
      case 'research_backtest_report': {
        result = await loadResearchBacktestReportResult(documentId, frame.arguments.report_id);
        break;
      }
      case 'research_strategy_scan_report': {
        result = await loadResearchStrategyScanReportResult(documentId, frame.arguments.report_id);
        break;
      }
      case 'research_factor_weather': {
        const loaded = await loadResearchFactorWeatherResult(documentId, frame.arguments.factor_id);
        result = {
          rows: parseResearchFactorWeatherRuntimeRows(loaded.rows),
          metadata: loaded.metadata,
        };
        break;
      }
    }
    await session.send({
      type: 'response',
      id,
      result,
    });
  } catch (error) {
    await session.send({
      type: 'response',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadAndPrepareResearchSeries(input: {
  request: {
    start: string;
    end: string;
    frequency: ResearchSeriesRuntimeRequestV1['frequency'];
    transform: ResearchSeriesRuntimeRequestV1['transform'];
    partial_period: ResearchSeriesRuntimeRequestV1['partial_period'];
  };
  input: ResearchSeriesInputSpecV1;
}): Promise<Record<string, unknown>> {
  const loadStart = researchSeriesLoadStart(
    input.request.start,
    input.request.frequency,
    input.request.transform,
  );
  const loaded = await loadResearchSeries(input.input, loadStart, input.request.end);
  const points = prepareResearchSeries(
    loaded.points,
    input.request.frequency,
    input.request.transform,
    {
      start: input.request.start,
      end: input.request.end,
      partialPeriod: input.request.partial_period,
    },
  );
  return {
    rows: parseResearchSeriesRuntimeRows(points),
    diagnostics: loaded.diagnostics,
  };
}

/** Parse before entering the response-error boundary, preserving invalid-frame session failure. */
export async function dispatchResearchRequest(
  documentId: string,
  session: Pick<PythonSession, 'send'>,
  frame: ResearchRequestFrame,
): Promise<void> {
  const request = parseResearchRequestFrame(frame);
  await answerResearchRequest(documentId, session, request);
}
