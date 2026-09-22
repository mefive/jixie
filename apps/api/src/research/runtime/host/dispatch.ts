import { type ParsedResearchRequest, parseResearchRequestFrame } from './request.js';
import type { ResearchRequestFrame } from './protocol.js';
import { replayResearchInput } from './input-replay.js';
import {
  type ResearchSeriesRuntimeRequestV1,
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
import { loadResearchFinancialValues } from '../../datasets/financial-values.js';
import {
  researchSeriesLoadStart,
  loadResearchSeries,
  prepareResearchSeries,
} from '../../datasets/series.js';
import { researchYieldCurveSourceForSdkCall } from '../../catalog/concept-bindings.js';
import {
  loadResearchCommodityReturns,
  loadResearchCommodityWarehouseReceipts,
  loadResearchCommodityHoldings,
} from '../../datasets/commodity.js';
import {
  loadResearchMarketState,
  loadResearchEquityFundamentals,
  loadResearchEquityFlows,
  loadResearchEquityDividends,
} from '../../datasets/supplemental.js';
import {
  loadResearchEtfShares,
  loadResearchIndexValuation,
  loadResearchIndustryState,
  loadResearchFuturesSettlement,
} from '../../datasets/market-reference.js';
import {
  loadResearchFinancialStatements,
  loadResearchFinancialMetrics,
  loadResearchFinancialCrossSection,
  loadResearchFinancialPanel,
} from '../../datasets/financial.js';
import { loadResearchCrossSection, loadResearchPanel } from '../../datasets/equity.js';
import { loadResearchFactorReportResult } from '../../datasets/results/factor-report.js';
import { loadResearchBacktestReportResult } from '../../datasets/results/backtest-report.js';
import {
  loadResearchStrategyScanReportResult,
  loadResearchFactorWeatherResult,
} from '../../datasets/results/scan-and-weather.js';
import type { ResearchSeriesInputSpecV1 } from '@jixie/shared';

async function answerResearchRequest(
  documentId: string,
  frame: ParsedResearchRequest,
): Promise<ResearchResponse> {
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
    return { result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
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

export type ResearchResponse = { result: Record<string, unknown> } | { error: string };

export interface ResearchRequestObserver {
  beforeRequest(frame: ResearchRequestFrame): Promise<void>;
  captureResponse(frame: ResearchRequestFrame, response: ResearchResponse): Promise<void>;
}

/** Evidence persistence stays outside the Python-catchable dataset error boundary. */
export async function dispatchResearchRequest(
  documentId: string,
  frame: ResearchRequestFrame,
  observer?: ResearchRequestObserver,
): Promise<{ type: 'response'; id: number } & ResearchResponse> {
  await observer?.beforeRequest(frame);
  let request: ParsedResearchRequest;
  try {
    request = parseResearchRequestFrame(frame);
  } catch (error) {
    await observer?.captureResponse(frame, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const response =
    (await replayResearchInput(documentId, frame)) ??
    (await answerResearchRequest(documentId, request));
  await observer?.captureResponse(frame, response);
  return { type: 'response', id: frame.id, ...response };
}
