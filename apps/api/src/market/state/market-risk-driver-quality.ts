import { MARKET_RISK_FACTOR_KEYS_V1, type MarketRiskFactorKeyV1 } from '@jixie/shared';
import { prisma, type Prisma } from '#infra/database/prisma.js';
import {
  loadMarketRiskDriverHistory,
  type MarketRiskDriverHistoryV1,
} from './market-risk-drivers.js';

/**
 * 描述单市场驱动的质量覆盖，供模型就绪判断。
 * Describe coverage quality for one market risk driver.
 */
export interface MarketRiskDriverQualityFactor {
  factor: MarketRiskFactorKeyV1;
  observations: number;
  latestDate: string | null;
}

/**
 * 汇总市场驱动质量与不可用原因。
 * Summarize market-driver quality and unavailability reasons.
 */
export interface MarketRiskDriverQualitySummary {
  expectedDates: number;
  completeObservations: number;
  completeCoverage: number;
  latestCompleteDate: string | null;
  trailingCompleteGaps: number;
  factors: MarketRiskDriverQualityFactor[];
  lineageErrors: string[];
  coverageErrors: string[];
  warnings: string[];
}

export async function inspectMarketRiskDrivers(
  options: { startDate: string; endDate: string },
  database: Prisma = prisma,
): Promise<MarketRiskDriverQualitySummary> {
  const eligibleStart = options.startDate > '20180326' ? options.startDate : '20180326';
  const [history, calendar] = await Promise.all([
    loadMarketRiskDriverHistory({ startDate: eligibleStart, endDate: options.endDate }, database),
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: eligibleStart, lte: options.endDate },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
  ]);
  return summarizeMarketRiskDriverQuality(
    history,
    calendar.map((row) => row.calDate),
  );
}

/**
 * 汇总市场风险驱动的日期覆盖、缺失与异常，供模型就绪判断。
 * Summarize market-driver coverage, missing values and anomalies for model readiness.
 */
export function summarizeMarketRiskDriverQuality(
  history: MarketRiskDriverHistoryV1,
  expectedDates: string[],
): MarketRiskDriverQualitySummary {
  const expected = [...new Set(expectedDates)].sort();
  const complete = history.observations.filter((observation) =>
    MARKET_RISK_FACTOR_KEYS_V1.every((factor) => {
      const value = observation.values[factor];
      return value != null && Number.isFinite(value);
    }),
  );
  const factors = MARKET_RISK_FACTOR_KEYS_V1.map((factor): MarketRiskDriverQualityFactor => {
    const dates = history.observations
      .filter((observation) => {
        const value = observation.values[factor];
        return value != null && Number.isFinite(value);
      })
      .map((observation) => observation.date);
    return { factor, observations: dates.length, latestDate: dates.at(-1) ?? null };
  });
  const latestCompleteDate = complete.at(-1)?.date ?? null;
  const completeCoverage = expected.length === 0 ? 0 : complete.length / expected.length;
  const trailingCompleteGaps =
    latestCompleteDate == null
      ? expected.length
      : expected.filter((date) => date > latestCompleteDate).length;
  const lineageErrors: string[] = [];
  const coverageErrors: string[] = [];
  const warnings: string[] = [];
  if (!history.lineage.pointInTimeEligible || history.lineage.futureVintageRows !== 0) {
    lineageErrors.push('market-risk driver lineage is not strictly point-in-time eligible');
  }
  if (trailingCompleteGaps > 5) {
    coverageErrors.push(
      `${trailingCompleteGaps} trailing SSE sessions lack a complete driver vector`,
    );
  }
  const missingFactors = factors.filter((factor) => factor.observations === 0);
  if (missingFactors.length > 0) {
    coverageErrors.push(
      `missing drivers: ${missingFactors.map((factor) => factor.factor).join(', ')}`,
    );
  }
  if (completeCoverage < 0.85) {
    warnings.push(`complete-vector coverage is ${(completeCoverage * 100).toFixed(2)}%`);
  }
  return {
    expectedDates: expected.length,
    completeObservations: complete.length,
    completeCoverage,
    latestCompleteDate,
    trailingCompleteGaps,
    factors,
    lineageErrors,
    coverageErrors,
    warnings,
  };
}
