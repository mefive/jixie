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
import { reportResearchSpec } from './report-spec.js';
import { parseResearchIntent } from './research-policy.js';

/**
 * 提取报告摘要并屏蔽不应公开的保留段结果。
 * Build report summary metadata without exposing sealed holdout results.
 */
export function reportSummary(
  row: FactorReportRow & { status: string; error: string | null } & { job?: { id: string } | null },
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

/**
 * 将报告与任务状态映射为对外可读状态。
 * Map report and job state into the public report status.
 */
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

/**
 * 校验持久化研究 payload，拒绝无法解释的历史数据形状。
 * Validate a persisted research payload before interpreting its contents.
 */
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
