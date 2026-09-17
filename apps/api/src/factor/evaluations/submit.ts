import { t } from '#i18n/index.js';
import { prisma } from '#infra/database/prisma.js';
import type { FactorReportSummary, FactorResearchSpecV1, Locale } from '@jixie/shared';
import { resolvePanelFactorSource } from '../composition/panel-source.js';
import { resolveMacroRegimeTemplateSource } from '../definitions/templates/macro-regime.js';
import {
  resolveTimeSeriesTemplateSource,
  unsupportedTimeSeriesTemplateAssets,
} from '../definitions/templates/time-series.js';
import { FactorError } from '../errors.js';
import { normalizeFactorResearchSpec } from '../execution/spec.js';
import { resolveAssetFactorDataCutoff } from '../observations/asset-factor-data-cutoff.js';
import { resolveMacroRegimeDataCutoff } from '../observations/macro-regime-data-cutoff.js';
import type { SubmitFactorAnalysisInput } from '../schema.js';
import {
  factorAnalysisSourceDataRequirements,
  resolveCustomTimeSeriesFactorSource,
  resolveFactorSource,
} from '../sources/resolve.js';
import { type FactorAnalysisSource } from '../sources/snapshot.js';
import { startFactorAnalysis } from './start.js';

export async function submitFactorAnalysis(
  userId: string,
  input: SubmitFactorAnalysisInput,
  locale: Locale,
) {
  const { factor, parentReportId, researchIntent } = input;
  let researchSpec = normalizeFactorResearchSpec(input.spec);

  if (!criterionMatchesAnalysisKind(researchSpec, researchIntent)) {
    throw new FactorError('factor_criterion_unsupported');
  }

  let source: FactorAnalysisSource | null = null;

  if (researchSpec.analysisKind === 'cross_sectional') {
    let protocol = researchSpec.protocol;
    source = await resolveFactorSource(userId, factor);
    if (!source) {
      throw new FactorError('factor_unavailable', { params: { factor } });
    }
    if (source.kind === 'composite') {
      if (protocol.version !== 4 && protocol.version !== 6) {
        throw new FactorError('source_protocol_invalid');
      }
      protocol = { ...protocol, composite: source.definition };
    } else if (protocol.version === 4 || (protocol.version === 6 && protocol.composite)) {
      throw new FactorError('source_protocol_invalid');
    }
    researchSpec = { ...researchSpec, protocol };
  } else if (researchSpec.analysisKind === 'time_series') {
    source =
      resolveTimeSeriesTemplateSource(factor) ??
      (await resolveCustomTimeSeriesFactorSource(userId, factor));
    if (!source) {
      throw new FactorError('factor_unavailable', { params: { factor } });
    }
    const unsupportedAssets = unsupportedTimeSeriesTemplateAssets(factor, researchSpec.assets);
    if (unsupportedAssets.length > 0) {
      throw new FactorError('factor_research_assets_unsupported', {
        params: { assets: unsupportedAssets.join(', ') },
      });
    }
    const cutoffSpec = {
      ...researchSpec,
      dataPolicy: {
        ...researchSpec.dataPolicy,
        dataCutoff: researchSpec.dataPolicy.dataCutoff ?? researchSpec.end,
      },
    };
    const dataCutoff = await resolveAssetFactorDataCutoff(
      cutoffSpec,
      factorAnalysisSourceDataRequirements(source),
    );
    if (!dataCutoff) {
      throw new FactorError('data_not_ready');
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else if (researchSpec.analysisKind === 'panel') {
    source = await resolvePanelFactorSource(userId, factor);
    if (!source) {
      throw new FactorError('factor_unavailable', { params: { factor } });
    }
    const cutoffSpec = {
      ...researchSpec,
      dataPolicy: {
        ...researchSpec.dataPolicy,
        dataCutoff: researchSpec.dataPolicy.dataCutoff ?? researchSpec.end,
      },
    };
    const dataCutoff = await resolveAssetFactorDataCutoff(
      cutoffSpec,
      factorAnalysisSourceDataRequirements(source),
    );
    if (!dataCutoff) {
      throw new FactorError('data_not_ready');
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else if (researchSpec.analysisKind === 'macro_regime') {
    source = resolveMacroRegimeTemplateSource(factor);
    if (!source) {
      throw new FactorError('factor_unavailable', { params: { factor } });
    }
    const dataCutoff = await resolveMacroRegimeDataCutoff(researchSpec);
    if (!dataCutoff) {
      throw new FactorError('data_not_ready');
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  }

  if (!source) {
    throw new FactorError('factor_unavailable', { params: { factor } });
  }

  const researchWindow =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;

  if (researchWindow.start >= researchWindow.end) {
    throw new FactorError('start_after_end');
  }

  if (parentReportId) {
    const parent = await prisma.factorReport.findFirst({
      where: { id: parentReportId, userId, factor },
      select: { id: true },
    });
    if (!parent) {
      throw new FactorError('evaluation_not_found');
    }
  }

  const response = await startFactorAnalysis({
    userId,
    factor,
    source,
    spec: researchSpec,
    researchIntent,
    parentReportId,
    locale: locale,
    failedMessage: t(locale, 'factorAnalysisFailed'),
    exitedMessage: (code) => t(locale, 'factorProcExited', { code }),
  });

  return response;
}

function criterionMatchesAnalysisKind(
  spec: FactorResearchSpecV1,
  intent: NonNullable<FactorReportSummary['researchIntent']>,
): boolean {
  const metric = intent.primaryCriterion?.metric;

  if (!metric) {
    return true;
  }

  const metricKind = metric.startsWith('time_series_')
    ? 'time_series'
    : metric.startsWith('panel_')
      ? 'panel'
      : 'cross_sectional';

  return spec.analysisKind === metricKind;
}
