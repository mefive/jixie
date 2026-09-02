import type {
  ResearchDataCatalogBacktestReportV1,
  ResearchDataCatalogDatasetV1,
  ResearchDataCatalogFactorReportV1,
  ResearchDataCatalogFactorWeatherV1,
  ResearchDataCatalogInstrumentV1,
  ResearchDataCatalogStrategyScanReportV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';

export interface ResearchDatasetSnippetOptions {
  dataset: ResearchDataCatalogDatasetV1;
  start: string;
  end: string;
}

export interface ResearchSeriesSnippetOptions {
  instrument: ResearchDataCatalogInstrumentV1;
  measure: string;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
}

/** Build the immutable backtest lookup inserted by the catalog. */
export function researchBacktestReportSnippet(
  report: Pick<ResearchDataCatalogBacktestReportV1, 'id' | 'strategyName'>,
): string {
  return `${researchBacktestReportVariableName(report.strategyName)} = results.backtest_report(${JSON.stringify(report.id)})`;
}

export function researchStrategyScanReportSnippet(
  report: Pick<ResearchDataCatalogStrategyScanReportV1, 'id' | 'strategyName'>,
): string {
  return `${researchBacktestReportVariableName(report.strategyName).replace(/_report$/, '_scan')} = results.strategy_scan_report(${JSON.stringify(report.id)})`;
}

function researchBacktestReportVariableName(strategyName: string): string {
  let identifier = strategyName
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(identifier)) {
    identifier = `backtest_${identifier}`;
  }
  return `${identifier || 'backtest'}_report`;
}

/** Build the immutable report lookup inserted by the catalog. */
export function researchFactorReportSnippet(
  report: Pick<ResearchDataCatalogFactorReportV1, 'id' | 'factor'>,
): string {
  return `${researchFactorReportVariableName(report.factor)} = results.factor_report(${JSON.stringify(report.id)})`;
}

export function researchFactorWeatherSnippet(
  weather: Pick<ResearchDataCatalogFactorWeatherV1, 'factorId' | 'factorName'>,
): string {
  const identifier = weather.factorName
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${identifier || 'factor'}_weather = results.factor_weather(${JSON.stringify(weather.factorId)})`;
}

function researchFactorReportVariableName(factor: string): string {
  const identifier = factor
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${identifier || 'factor'}_report`;
}

/** Build an exact governed dataset call inserted by the catalog. */
export function researchDatasetSnippet(options: ResearchDatasetSnippetOptions): string {
  const { dataset, start, end } = options;
  const variable = researchDatasetVariableName(dataset);
  switch (dataset.method) {
    case 'data.cross_section':
      return `${variable} = data.cross_section(
    ${JSON.stringify(dataset.universe)},
    date=${JSON.stringify(end)},
    minimum_listed_days=365,
    risk_warning="exclude",
)`;
    case 'data.panel':
      return `${variable} = data.panel(
    ${JSON.stringify(dataset.universe)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
    frequency="month_end",
    minimum_listed_days=365,
    risk_warning="exclude",
)`;
    case 'data.yield_curve':
      return `${variable} = data.yield_curve(
    ${JSON.stringify(dataset.curve)},
    tenor=${JSON.stringify(dataset.tenor)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
    frequency="daily",
    transform="level",
)`;
    case 'data.macro':
      return `${variable} = data.macro(
    ${JSON.stringify(dataset.series)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
    frequency="daily",
    transform="level",
)`;
    case 'data.fx':
      return `${variable} = data.fx(
    ${JSON.stringify(dataset.pair)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
    frequency="daily",
    transform="level",
)`;
    case 'data.commodity_returns':
    case 'data.commodity_warehouse_receipts':
    case 'data.commodity_holdings':
      return `${variable} = ${dataset.method}(
    ${JSON.stringify(dataset.product)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
)`;
    case 'data.market_state':
      return `${variable} = data.market_state(
    ${JSON.stringify(dataset.scope)},
    start=${JSON.stringify(start)},
    end=${JSON.stringify(end)},
)`;
  }
}

function researchDatasetVariableName(dataset: ResearchDataCatalogDatasetV1): string {
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
      default:
        return `${dataset.universe}_${dataset.method === 'data.panel' ? 'panel' : 'cross_section'}`;
    }
  })();
  const identifier = source
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return identifier || 'dataset';
}

/** Build the exact SDK call inserted by the catalog, without creating a second execution path. */
export function researchSeriesSnippet(options: ResearchSeriesSnippetOptions): string {
  const { instrument } = options;
  return `${researchSeriesVariableName(instrument)} = data.series(
    ${JSON.stringify(instrument.assetType)},
    ${JSON.stringify(instrument.identifier)},
    start=${JSON.stringify(options.start)},
    end=${JSON.stringify(options.end)},
    measure=${JSON.stringify(options.measure)},
    frequency=${JSON.stringify(options.frequency)},
    transform=${JSON.stringify(options.transform)},
)`;
}

export function researchSeriesVariableName(
  instrument: Pick<ResearchDataCatalogInstrumentV1, 'assetType' | 'identifier'>,
): string {
  const identifier = instrument.identifier
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${instrument.assetType}_${identifier || 'series'}`;
}
