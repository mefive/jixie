import type {
  ResearchDataCatalogFactorReportV1,
  ResearchDataCatalogInstrumentV1,
  ResearchFrequencyV1,
  ResearchTransformV1,
} from '@jixie/shared';

export interface ResearchSeriesSnippetOptions {
  instrument: ResearchDataCatalogInstrumentV1;
  measure: string;
  start: string;
  end: string;
  frequency: ResearchFrequencyV1;
  transform: ResearchTransformV1;
}

/** Build the immutable report lookup inserted by the catalog. */
export function researchFactorReportSnippet(
  report: Pick<ResearchDataCatalogFactorReportV1, 'id' | 'factor'>,
): string {
  return `${researchFactorReportVariableName(report.factor)} = results.factor_report(${JSON.stringify(report.id)})`;
}

function researchFactorReportVariableName(factor: string): string {
  const identifier = factor
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${identifier || 'factor'}_report`;
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
