import { z } from 'zod';
import type { FactorReportSummary, FactorResearchSpecV1 } from '@jixie/shared';
import { prisma } from '#infra/database/prisma.js';
import {
  factorAnalysisSpecSchema,
  factorResearchIntentV1Schema,
  factorResearchSpecV1Schema,
  normalizeFactorResearchSpec,
} from '../reports/spec.js';
import { startFactorAnalysis, type FactorAnalysisSource } from '../analysis-job.js';
import {
  resolveTimeSeriesTemplateSource,
  unsupportedTimeSeriesTemplateAssets,
} from '../definitions/templates/time-series.js';
import { resolvePanelFactorSource } from '../composition/panel-source.js';
import { resolveMacroRegimeTemplateSource } from '../definitions/templates/macro-regime.js';
import { resolveMacroRegimeDataCutoff } from '../observations/macro-regime-data-cutoff.js';
import { resolveAssetFactorDataCutoff } from '../observations/asset-factor-data-cutoff.js';
import {
  factorAnalysisSourceDataRequirements,
  resolveFactorSource,
  resolveCustomTimeSeriesFactorSource,
} from './sources.js';
import { t } from '#i18n/index.js';
import type { Locale } from '@jixie/shared';
import { failFactorOperation } from '../operation-errors.js';

export const submitFactorAnalysisSchema = z.object({
  factor: z.string().min(1),
  spec: z.union([factorAnalysisSpecSchema, factorResearchSpecV1Schema]),
  parentReportId: z.string().min(1).nullable().optional(),
  researchIntent: factorResearchIntentV1Schema,
});

export async function submitFactorAnalysis(
  userId: string,
  input: z.infer<typeof submitFactorAnalysisSchema>,
  locale: Locale,
) {
  const { factor, parentReportId, researchIntent } = input;
  let researchSpec = normalizeFactorResearchSpec(input.spec);

  if (!criterionMatchesAnalysisKind(researchSpec, researchIntent)) {
    return failFactorOperation('invalid', t(locale, 'factorCriterionUnsupported'));
  }

  let source: FactorAnalysisSource | null = null;

  if (researchSpec.analysisKind === 'cross_sectional') {
    let protocol = researchSpec.protocol;
    source = await resolveFactorSource(userId, factor);
    if (!source) {
      return failFactorOperation('missing', t(locale, 'unknownFactor', { factor }));
    }
    if (source.kind === 'composite') {
      if (protocol.version !== 4 && protocol.version !== 6) {
        return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
      }
      protocol = { ...protocol, composite: source.definition };
    } else if (protocol.version === 4 || (protocol.version === 6 && protocol.composite)) {
      return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
    }
    researchSpec = { ...researchSpec, protocol };
  } else if (researchSpec.analysisKind === 'time_series') {
    source =
      resolveTimeSeriesTemplateSource(factor) ??
      (await resolveCustomTimeSeriesFactorSource(userId, factor));
    if (!source) {
      return failFactorOperation('missing', t(locale, 'unknownFactor', { factor }));
    }
    const unsupportedAssets = unsupportedTimeSeriesTemplateAssets(factor, researchSpec.assets);
    if (unsupportedAssets.length > 0) {
      return failFactorOperation(
        'invalid',
        t(locale, 'factorResearchAssetsUnsupported', { assets: unsupportedAssets.join(', ') }),
      );
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
      return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else if (researchSpec.analysisKind === 'panel') {
    source = await resolvePanelFactorSource(userId, factor);
    if (!source) {
      return failFactorOperation('missing', t(locale, 'unknownFactor', { factor }));
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
      return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  } else if (researchSpec.analysisKind === 'macro_regime') {
    source = resolveMacroRegimeTemplateSource(factor);
    if (!source) {
      return failFactorOperation('missing', t(locale, 'unknownFactor', { factor }));
    }
    const dataCutoff = await resolveMacroRegimeDataCutoff(researchSpec);
    if (!dataCutoff) {
      return failFactorOperation('invalid', t(locale, 'windowNotComputed'));
    }
    researchSpec = {
      ...researchSpec,
      dataPolicy: { ...researchSpec.dataPolicy, dataCutoff },
    };
  }

  if (!source) {
    return failFactorOperation('missing', t(locale, 'unknownFactor', { factor }));
  }

  const researchWindow =
    researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : researchSpec;

  if (researchWindow.start >= researchWindow.end) {
    return failFactorOperation('invalid', t(locale, 'startAfterEnd'));
  }

  if (parentReportId) {
    const parent = await prisma.factorReport.findFirst({
      where: { id: parentReportId, userId, factor },
      select: { id: true },
    });
    if (!parent) {
      return failFactorOperation('missing', t(locale, 'windowNotComputed'));
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
