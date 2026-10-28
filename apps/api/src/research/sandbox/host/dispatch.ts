import { type ParsedResearchRequest, parseResearchRequestFrame } from './request.js';
import type { ResearchRequestFrame } from './protocol.js';
import {
  parseResearchSeriesRuntimeRows,
  parseResearchEquityFundamentalsRuntimeRows,
  parseResearchEquityDividendsRuntimeRows,
  parseResearchIndexValuationRuntimeRows,
  parseResearchFinancialValuesRuntimeRows,
  parseResearchFinancialStatementsRuntimeRows,
  parseResearchFinancialMetricsRuntimeRows,
  parseResearchEquityDatasetRuntimeRows,
} from './validation.js';
import { loadResearchFinancialValues } from '../../datasets/financial-values.js';
import {
  researchSeriesLoadStart,
  loadResearchSeries,
  prepareResearchSeries,
} from '../../datasets/series.js';
import {
  loadResearchEquityFundamentals,
  loadResearchEquityDividends,
} from '../../datasets/supplemental.js';
import { loadResearchIndexValuation } from '../../datasets/market-reference.js';
import {
  loadResearchFinancialStatements,
  loadResearchFinancialMetrics,
  loadResearchFinancialCrossSection,
  loadResearchFinancialPanel,
} from '../../datasets/financial.js';
import { loadResearchCrossSection, loadResearchPanel } from '../../datasets/equity.js';
import { loadResearchFactorReportResult } from '../../datasets/results/factor-report.js';
import { loadResearchBacktestReportResult } from '../../datasets/results/backtest-report.js';
import { loadResearchStrategyScanReportResult } from '../../datasets/results/strategy-scan-report.js';

type ResearchInputResponse = { result?: Record<string, unknown>; error?: string };

/**
 * 根据已校验 SDK 请求分派数据读取与结果访问，保持权限和公开字段映射。
 *
 * Dispatch a validated SDK request to authorized loaders and public result mappings.
 */
async function answerResearchRequest(
  documentId: string,
  frame: ParsedResearchRequest,
): Promise<ResearchInputResponse> {
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
      case 'research_equity_fundamentals': {
        result = {
          rows: parseResearchEquityFundamentalsRuntimeRows(
            await loadResearchEquityFundamentals(frame.arguments),
          ),
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
      case 'research_index_valuation': {
        result = {
          rows: parseResearchIndexValuationRuntimeRows(
            await loadResearchIndexValuation(frame.arguments),
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
    }
    return { result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 校验 SDK 请求并读取当前数据，私有报告仍由业务 loader 校验归属。
 *
 * Validate SDK requests and read current data; business loaders authorize private reports.
 */
export async function dispatchResearchRequest(
  documentId: string,
  frame: ResearchRequestFrame,
): Promise<{ type: 'response'; id: number } & ResearchInputResponse> {
  const request = parseResearchRequestFrame(frame);
  const response = await answerResearchRequest(documentId, request);

  return { type: 'response', id: frame.id, ...response };
}
