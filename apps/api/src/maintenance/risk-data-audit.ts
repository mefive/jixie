import { prisma, type Prisma } from '#infra/database/prisma.js';
import type { MarketRiskDriverHistoryV1 } from '#market/state/market-risk-drivers.js';
import type { MacroRiskAxisHistoryV1 } from '#market/macro/risk-axes.js';
import {
  inspectMarketRiskDrivers,
  summarizeMarketRiskDriverQuality as marketDriverQuality,
  type MarketRiskDriverQualitySummary,
} from '#market/quality/market-risk-drivers.js';
import {
  inspectMacroRiskAxes,
  summarizeMacroRiskAxisQuality as macroAxisQuality,
  type MacroRiskAxisQualitySummary,
} from '#market/macro/risk-axis-quality.js';
import {
  marketRiskDataReadiness,
  macroRiskDataReadiness,
  selectMacroRiskAuditStart,
} from '#strategy/analysis/risk/data-readiness.js';

export async function auditMarketRiskDrivers(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
) {
  return marketAuditSummary(await inspectMarketRiskDrivers(options, database));
}

export async function auditMacroRiskAxes(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
) {
  const startDate = selectMacroRiskAuditStart(options.startDate, options.endDate);
  return macroAuditSummary(await inspectMacroRiskAxes({ ...options, startDate }, database));
}

export function summarizeMarketRiskDriverQuality(
  history: MarketRiskDriverHistoryV1,
  expectedDates: string[],
) {
  return marketAuditSummary(marketDriverQuality(history, expectedDates));
}

export function summarizeMacroRiskAxisQuality(
  exploratory: MacroRiskAxisHistoryV1,
  strict: MacroRiskAxisHistoryV1,
) {
  return macroAuditSummary(macroAxisQuality(exploratory, strict));
}

function marketAuditSummary(quality: MarketRiskDriverQualitySummary) {
  const { lineageErrors, coverageErrors, warnings, ...metrics } = quality;
  // Preserve the existing audit order: lineage, model history, then trailing/missing coverage.
  const errors = [...lineageErrors, ...marketRiskDataReadiness(quality), ...coverageErrors];
  return { status: auditStatus(errors, warnings), ...metrics, errors, warnings };
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
