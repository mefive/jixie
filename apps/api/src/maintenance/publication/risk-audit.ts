import { getDatabase, type Prisma } from '#infra/database/prisma.js';
import type { MacroRiskAxisHistoryV1 } from '#market/macro/risk-axes.js';
import {
  inspectMacroRiskAxes,
  summarizeMacroRiskAxisQuality as macroAxisQuality,
  type MacroRiskAxisQualitySummary,
} from '#market/macro/risk-axis-quality.js';
import {
  inspectMarketRiskDrivers,
  MARKET_RISK_EARLIEST_DATE,
  summarizeMarketRiskDriverQuality as marketDriverQuality,
  type MarketRiskDriverQualitySummary,
} from '#market/state/market-risk-driver-quality.js';
import type { MarketRiskDriverHistoryV1 } from '#market/state/market-risk-drivers.js';
import {
  macroRiskDataReadiness,
  marketRiskDataReadiness,
  selectMacroRiskAuditStart,
} from '#strategy/risk/data-readiness.js';
import { MARKET_RISK_LOOKBACK_OBSERVATIONS } from '#strategy/risk/market-risk-model.js';

export async function auditMarketRiskDrivers(
  options: { startDate: string; endDate: string },
  database: Prisma = getDatabase(),
) {
  let startDate = options.startDate;
  let quality = await inspectMarketRiskDrivers(options, database);

  // 按完整向量数扩展真实历史，不把 20 日修复区间误当成模型全部历史，也不降低 252 日要求。
  // Extend actual history by complete vectors instead of treating a short repair as the full model sample.
  while (
    quality.completeObservations < MARKET_RISK_LOOKBACK_OBSERVATIONS &&
    startDate > MARKET_RISK_EARLIEST_DATE
  ) {
    const precedingDates = await database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: MARKET_RISK_EARLIEST_DATE, lt: startDate, lte: options.endDate },
      },
      orderBy: { calDate: 'desc' },
      take: MARKET_RISK_LOOKBACK_OBSERVATIONS,
      select: { calDate: true },
    });
    const expandedStart = precedingDates.at(-1)?.calDate;
    if (!expandedStart || expandedStart >= startDate) {
      break;
    }
    startDate = expandedStart;
    quality = await inspectMarketRiskDrivers({ ...options, startDate }, database);
  }

  return marketAuditSummary(quality);
}

export async function auditMacroRiskAxes(
  options: { startDate: string; endDate: string },
  database: Prisma = getDatabase(),
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
