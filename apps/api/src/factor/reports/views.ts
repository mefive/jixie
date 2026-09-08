import type { FactorReport as FactorReportRow } from '@prisma/client';
import type {
  FactorReport as FactorAnalysisPayload,
  FactorReportStatus,
  FactorReportSummary,
  FactorResearchReportPayloadV1,
  FactorResearchSpecV1,
  FactorMacroRegimeReportV1,
  FactorPanelReportV1,
  FactorTimeSeriesReportV1,
} from '@jixie/shared';
import { timeSeriesAggregateMetrics } from '@jixie/shared';
import { normalizeFactorResearchSpec } from './spec.js';
import { parseResearchIntent } from './research-policy.js';

export function reportSummary(
  row: FactorReportRow & { job?: { id: string } | null },
): FactorReportSummary {
  const sealed = row.phase === 'holdout' && row.revealedAt === null;
  const researchSpec = reportResearchSpec(row);
  const researchPayload = sealed ? undefined : parseResearchPayload(row.payload, researchSpec);
  const crossSectionalPayload =
    researchPayload?.analysisKind === 'cross_sectional' ? researchPayload.report : undefined;
  const timeSeriesMetrics =
    researchPayload?.analysisKind === 'time_series'
      ? timeSeriesAggregateMetrics(researchPayload.report)
      : undefined;
  const panelMetrics =
    researchPayload?.analysisKind === 'panel'
      ? {
          panelRankIcMean: researchPayload.report.rankIcMean,
          panelNetLongShortAnnualized: researchPayload.report.longShortNetAnnualized,
        }
      : undefined;

  return {
    id: row.id,
    factor: row.factor,
    analysisKind: researchSpec.analysisKind,
    language: row.language === 'python' ? 'python' : 'typescript',
    runtimeVersion: row.language === 'python' ? 'py-v1' : 'ts-v1',
    status: reportStatus(row.status),
    phase: row.phase === 'explore' || row.phase === 'holdout' ? row.phase : 'legacy',
    spec: researchSpec.analysisKind === 'cross_sectional' ? researchSpec.protocol : undefined,
    researchSpec,
    variantKey: row.variantKey ?? undefined,
    jobId: row.job?.id,
    createdAt: row.createdAt.toISOString(),
    computedAt: row.computedAt?.toISOString(),
    error: row.error ?? undefined,
    sealed,
    revealedAt: row.revealedAt?.toISOString(),
    researchIntent: parseResearchIntent(row.researchIntentJson),
    metrics: crossSectionalPayload
      ? { rankIc: crossSectionalPayload.icMean }
      : timeSeriesMetrics
        ? timeSeriesMetrics
        : panelMetrics
          ? panelMetrics
          : undefined,
  };
}

export function reportResearchSpec(row: FactorReportRow) {
  if (row.specJson) {
    try {
      return normalizeFactorResearchSpec(JSON.parse(row.specJson));
    } catch {
      // Legacy rows still have queryable parameter columns as a safe fallback.
    }
  }

  return normalizeFactorResearchSpec({
    version: 1,
    freq: row.freq === 'week' ? 'week' : 'month',
    start: row.start,
    end: row.end,
    neutral: row.neutral === 'size' || row.neutral === 'size_industry' ? row.neutral : 'none',
  });
}

function reportStatus(status: string): FactorReportStatus {
  switch (status) {
    case 'running':
    case 'error':
    case 'stale':
      return status;
    default:
      return 'done';
  }
}

export function parseReportPayload(payload: string | null): FactorAnalysisPayload | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as FactorAnalysisPayload;
  } catch {
    return undefined;
  }
}

export function parseResearchPayload(
  payload: string | null,
  researchSpec: FactorResearchSpecV1,
): FactorResearchReportPayloadV1 | undefined {
  if (!payload) {
    return undefined;
  }
  try {
    const report = JSON.parse(payload) as unknown;
    switch (researchSpec.analysisKind) {
      case 'cross_sectional':
        return {
          version: 1,
          analysisKind: 'cross_sectional',
          report: report as FactorAnalysisPayload,
        };
      case 'time_series':
        return {
          version: 1,
          analysisKind: 'time_series',
          report: report as FactorTimeSeriesReportV1,
        };
      case 'panel':
        return {
          version: 1,
          analysisKind: 'panel',
          report: report as FactorPanelReportV1,
        };
      case 'macro_regime':
        return {
          version: 1,
          analysisKind: 'macro_regime',
          report: report as FactorMacroRegimeReportV1,
        };
    }
  } catch {
    return undefined;
  }
}

export function reportCompatibilityColumns(spec: FactorResearchSpecV1) {
  if (spec.analysisKind === 'cross_sectional') {
    return {
      freq: spec.protocol.freq,
      neutral: spec.protocol.neutral,
      start: spec.protocol.start,
      end: spec.protocol.end,
    };
  }
  const frequency = { daily: 'day', weekly: 'week', monthly: 'month' } as const;
  return {
    freq: frequency[spec.observationFrequency],
    neutral: 'none',
    start: spec.start,
    end: spec.end,
  };
}
