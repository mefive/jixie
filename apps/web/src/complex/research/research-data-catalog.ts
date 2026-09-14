import { RESEARCH_SDK_CONTRACT_V1, type ResearchDataReferenceV1 } from '@jixie/shared';
import type {
  ResearchDataCatalogBacktestReportV1,
  ResearchDataCatalogDatasetV1,
  ResearchDataCatalogFactorReportV1,
  ResearchDataCatalogFactorWeatherV1,
  ResearchDataCatalogInstrumentV1,
  ResearchDataCatalogStrategyScanReportV1,
  ResearchFinancialMetricV1,
  ResearchFinancialFieldV1,
  ResearchFinancialPeriodV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';

export interface ResearchDatasetSnippetOptions {
  dataset: ResearchDataCatalogDatasetV1;
  start: string;
  end: string;
  identifier?: string;
  metrics?: ResearchFinancialMetricV1[];
  fields?: ResearchFinancialFieldV1[];
  period?: ResearchFinancialPeriodV1;
  reportStart?: string;
  reportEnd?: string;
}

export interface ResearchSeriesSnippetOptions {
  instrument: ResearchDataCatalogInstrumentV1;
  measure: string;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
}

export interface ResearchCatalogSelection {
  snippet: string;
  reference: ResearchDataReferenceV1;
}

/** The source and attachment derive from the same argument object and public SDK contract. */
function catalogSelection(
  method: string,
  variable: string,
  arguments_: Record<string, unknown>,
): ResearchCatalogSelection {
  const contract = RESEARCH_SDK_CONTRACT_V1.functions.find((item) => item.qualifiedName === method);
  if (!contract) {
    throw new Error(`Unknown Research SDK method: ${method}`);
  }
  const parameters = contract.parameters.filter(
    (parameter) => arguments_[parameter.name] !== undefined,
  );
  const rendered = parameters.map(
    (parameter) =>
      `${parameter.keywordOnly ? `${parameter.name}=` : ''}${pythonLiteral(arguments_[parameter.name])}`,
  );
  const body = rendered.length === 1 ? rendered[0] : `\n    ${rendered.join(',\n    ')},\n`;
  return {
    snippet: `${variable} = ${method}(${body})`,
    reference: { label: variable, method: `research_${contract.name}`, arguments: arguments_ },
  };
}
function pythonLiteral(value: unknown): string {
  if (value === null) {
    return 'None';
  }
  if (value === true) {
    return 'True';
  }
  if (value === false) {
    return 'False';
  }
  if (Array.isArray(value)) {
    return `[${value.map(pythonLiteral).join(',')}]`;
  }
  return JSON.stringify(value);
}
function identifier(value: string, prefix = 'data'): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(cleaned) ? `${prefix}_${cleaned}` : cleaned;
}
export function researchBacktestReportSelection(
  report: Pick<ResearchDataCatalogBacktestReportV1, 'id' | 'strategyName'>,
) {
  return catalogSelection(
    'results.backtest_report',
    `${identifier(report.strategyName, 'backtest') || 'backtest'}_report`,
    { report_id: report.id },
  );
}
export function researchStrategyScanReportSelection(
  report: Pick<ResearchDataCatalogStrategyScanReportV1, 'id' | 'strategyName'>,
) {
  return catalogSelection(
    'results.strategy_scan_report',
    `${identifier(report.strategyName, 'backtest') || 'backtest'}_scan`,
    { report_id: report.id },
  );
}
export function researchFactorReportSelection(
  report: Pick<ResearchDataCatalogFactorReportV1, 'id' | 'factor'>,
) {
  return catalogSelection(
    'results.factor_report',
    `${identifier(report.factor) || 'factor'}_report`,
    { report_id: report.id },
  );
}
export function researchFactorWeatherSelection(
  weather: Pick<ResearchDataCatalogFactorWeatherV1, 'factorId' | 'factorName'>,
) {
  return catalogSelection(
    'results.factor_weather',
    `${identifier(weather.factorName) || 'factor'}_weather`,
    { factor_id: weather.factorId },
  );
}
export function researchSeriesVariableName(
  instrument: Pick<ResearchDataCatalogInstrumentV1, 'assetType' | 'identifier'>,
): string {
  return identifier(`${instrument.assetType}_${instrument.identifier}`);
}
export function researchSeriesSelection(options: ResearchSeriesSnippetOptions) {
  return catalogSelection('data.series', researchSeriesVariableName(options.instrument), {
    asset_type: options.instrument.assetType,
    identifier: options.instrument.identifier,
    start: options.start,
    end: options.end,
    measure: options.measure,
    frequency: options.frequency,
    transform: options.transform,
  });
}
export function researchDatasetSelection(
  options: ResearchDatasetSnippetOptions,
): ResearchCatalogSelection {
  const { dataset, start, end } = options;
  const dates = { start, end };
  const eligibility = { minimum_listed_days: 365, risk_warning: 'exclude' };
  const stock = options.identifier ?? ('identifier' in dataset ? dataset.identifier : undefined);
  let arguments_: Record<string, unknown>;
  switch (dataset.method) {
    case 'data.cross_section':
      arguments_ = { universe: dataset.universe, date: end, ...eligibility };
      break;
    case 'data.panel':
      arguments_ = { universe: dataset.universe, ...dates, frequency: 'month_end', ...eligibility };
      break;
    case 'data.equity_financial_values':
      arguments_ = {
        identifiers: stock?.split(/[,，\s]+/).filter(Boolean),
        as_of: end,
        fields: options.fields ?? ['income.revenue', 'balance_sheet.totalAssets'],
        report_start: options.reportStart ?? start,
        report_end: options.reportEnd ?? end,
        period: options.period ?? 'annual',
      };
      break;
    case 'data.equity_financial_statements':
      arguments_ = {
        identifier: stock,
        as_of: end,
        ...(options.fields?.length ? { fields: options.fields } : {}),
        ...(options.reportStart ? { report_start: options.reportStart } : {}),
        ...(options.reportEnd ? { report_end: options.reportEnd } : {}),
      };
      break;
    case 'data.equity_financial_metrics':
      arguments_ = { identifier: stock, as_of: end };
      break;
    case 'data.equity_financial_cross_section':
      arguments_ = {
        universe: dataset.universe,
        date: end,
        metrics: options.metrics ?? ['returnOnInvestedCapital'],
        ...eligibility,
      };
      break;
    case 'data.equity_financial_panel':
      arguments_ = {
        universe: dataset.universe,
        ...dates,
        frequency: 'month_end',
        metrics: options.metrics ?? ['returnOnInvestedCapital'],
        ...eligibility,
      };
      break;
    case 'data.yield_curve':
      arguments_ = {
        curve: dataset.curve,
        tenor: dataset.tenor,
        ...dates,
        frequency: 'daily',
        transform: 'level',
      };
      break;
    case 'data.macro':
      arguments_ = { series: dataset.series, ...dates, frequency: 'daily', transform: 'level' };
      break;
    case 'data.fx':
      arguments_ = { pair: dataset.pair, ...dates, frequency: 'daily', transform: 'level' };
      break;
    case 'data.commodity_returns':
    case 'data.commodity_warehouse_receipts':
    case 'data.commodity_holdings':
      arguments_ = { product: dataset.product, ...dates };
      break;
    case 'data.market_state':
      arguments_ = { scope: dataset.scope, ...dates };
      break;
    case 'data.etf_shares':
    case 'data.index_valuation':
    case 'data.industry_state':
    case 'data.futures_settlement':
      arguments_ = { identifier: dataset.identifier, ...dates };
      break;
  }
  const variable = researchDatasetVariableName(dataset, options.identifier);
  return catalogSelection(dataset.method, variable || 'dataset', arguments_);
}

export const researchBacktestReportSnippet = (
  report: Parameters<typeof researchBacktestReportSelection>[0],
) => researchBacktestReportSelection(report).snippet;
export const researchStrategyScanReportSnippet = (
  report: Parameters<typeof researchStrategyScanReportSelection>[0],
) => researchStrategyScanReportSelection(report).snippet;
export const researchFactorReportSnippet = (
  report: Parameters<typeof researchFactorReportSelection>[0],
) => researchFactorReportSelection(report).snippet;
export const researchFactorWeatherSnippet = (
  weather: Parameters<typeof researchFactorWeatherSelection>[0],
) => researchFactorWeatherSelection(weather).snippet;
export const researchSeriesSnippet = (options: ResearchSeriesSnippetOptions) =>
  researchSeriesSelection(options).snippet;
export const researchDatasetSnippet = (options: ResearchDatasetSnippetOptions) =>
  researchDatasetSelection(options).snippet;

function researchDatasetVariableName(
  dataset: ResearchDataCatalogDatasetV1,
  configuredIdentifier?: string,
): string {
  const source = (() => {
    switch (dataset.method) {
      case 'data.yield_curve':
        return `${dataset.curve}_${dataset.tenor}`;
      case 'data.macro':
        return dataset.series;
      case 'data.fx':
        return dataset.pair;
      case 'data.commodity_returns':
      case 'data.commodity_warehouse_receipts':
      case 'data.commodity_holdings':
        return `${dataset.product}_${dataset.method.replace('data.commodity_', '')}`;
      case 'data.market_state':
        return `market_state_${dataset.scope}`;
      case 'data.equity_financial_values':
        return 'financial_values';
      case 'data.etf_shares':
      case 'data.index_valuation':
      case 'data.industry_state':
      case 'data.futures_settlement':
      case 'data.equity_financial_statements':
      case 'data.equity_financial_metrics':
        return `${configuredIdentifier ?? dataset.identifier}_${dataset.method.replace('data.', '')}`;
      case 'data.equity_financial_cross_section':
      case 'data.equity_financial_panel':
        return `${dataset.universe}_${dataset.method.replace('data.equity_', '')}`;
      default:
        return `${dataset.universe}_${dataset.method === 'data.panel' ? 'panel' : 'cross_section'}`;
    }
  })();
  const identifier = source
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(identifier) ? `data_${identifier}` : identifier || 'dataset';
}
