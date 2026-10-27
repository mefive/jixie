import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import type { MacroRiskAxisHistoryV1 } from '#market/macro/risk-axes.js';
import {
  inspectMacroRiskAxes,
  summarizeMacroRiskAxisQuality as macroAxisQuality,
  type MacroRiskAxisQualitySummary,
} from '#market/macro/risk-axis-quality.js';
import {
  macroRiskDataReadiness,
  selectMacroRiskAuditStart,
} from '#strategy/risk/data-readiness.js';

export async function auditMacroRiskAxes(
  options: { startDate: string; endDate: string },
  database: Prisma = getDatabase(),
) {
  const startDate = selectMacroRiskAuditStart(options.startDate, options.endDate);
  return macroAuditSummary(await inspectMacroRiskAxes({ ...options, startDate }, database));
}

export function summarizeMacroRiskAxisQuality(
  exploratory: MacroRiskAxisHistoryV1,
  strict: MacroRiskAxisHistoryV1,
) {
  return macroAuditSummary(macroAxisQuality(exploratory, strict));
}

function macroAuditSummary(quality: MacroRiskAxisQualitySummary) {
  const { lineageErrors, ...metrics } = quality;
  const readiness = macroRiskDataReadiness(quality);
  const errors = [...lineageErrors, ...readiness.errors];
  return {
    status: auditStatus(errors, readiness.warnings),
    ...metrics,
    errors,
    warnings: readiness.warnings,
  };
}

function auditStatus(errors: string[], warnings: string[]): 'pass' | 'warn' | 'error' {
  return errors.length > 0 ? 'error' : warnings.length > 0 ? 'warn' : 'pass';
}
