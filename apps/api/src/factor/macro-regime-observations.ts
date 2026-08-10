import type { MacroRegimeFactorResearchSpecV1 } from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import {
  loadMacroRegimeScoreHistory,
  type MacroRegimeHistoryV1,
  type MacroRegimeScoreV1,
} from '../macro/regime-score.js';

export interface MacroRegimeEtfDailyRow {
  assetId: string;
  tradeDate: string;
  close: number;
  adjustmentFactor: number;
}

export interface MacroRegimeEvaluationObservation {
  assetId: string;
  asOfDate: string;
  featureAvailableDate: string;
  latestVintageDate: string;
  targetDate: string;
  state: MacroRegimeScoreV1['state'];
  growthScore: number;
  inflationScore: number;
  forwardReturn: number;
}

export interface MacroRegimeEvaluationPeriod {
  score: MacroRegimeScoreV1;
  targetDate: string;
}

export interface MacroRegimeEvaluationData {
  observations: MacroRegimeEvaluationObservation[];
  periods: MacroRegimeEvaluationPeriod[];
  skippedTargetDates: string[];
  skippedMacroDates: string[];
}

export async function loadMacroRegimeObservations(
  researchSpec: MacroRegimeFactorResearchSpecV1,
  database: Prisma = prisma,
): Promise<MacroRegimeEvaluationData> {
  assertSupportedProtocol(researchSpec);
  const targetEnd = addDays(researchSpec.end, (researchSpec.target.horizon + 10) * 3);
  const upperBound = researchSpec.dataPolicy.dataCutoff
    ? minimumDate(researchSpec.dataPolicy.dataCutoff, targetEnd)
    : targetEnd;
  const [calendarRows, bars, adjustments, assets] = await Promise.all([
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: researchSpec.start, lte: upperBound },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
    database.etfDaily.findMany({
      where: {
        tsCode: { in: researchSpec.targetAssets },
        tradeDate: { gte: researchSpec.start, lte: upperBound },
        close: { not: null },
      },
      select: { tsCode: true, tradeDate: true, close: true },
      orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }],
    }),
    database.etfAdjFactor.findMany({
      where: {
        tsCode: { in: researchSpec.targetAssets },
        tradeDate: { gte: researchSpec.start, lte: upperBound },
      },
      select: { tsCode: true, tradeDate: true, adjFactor: true },
    }),
    database.etfBasic.findMany({
      where: { tsCode: { in: researchSpec.targetAssets } },
      select: { tsCode: true },
    }),
  ]);
  if (assets.length !== researchSpec.targetAssets.length) {
    throw new Error('Macro regime research requires metadata for every target ETF.');
  }
  const openDates = calendarRows.map((row) => row.calDate);
  const decisionTargets = macroRegimeDecisionTargets(researchSpec, openDates);
  if (decisionTargets.eligible.length === 0) {
    throw new Error('Macro regime research has no decision date with a complete target horizon.');
  }
  const history = await loadMacroRegimeScoreHistory(database, {
    decisionDates: decisionTargets.eligible.map((period) => period.asOfDate),
    revisionPolicy: researchSpec.dataPolicy.revisionPolicy,
    dataCutoff: researchSpec.dataPolicy.dataCutoff,
  });
  const adjustmentByAssetDate = new Map(
    adjustments.map((row) => [`${row.tsCode}:${row.tradeDate}`, row.adjFactor]),
  );

  return buildMacroRegimeEvaluationData(
    researchSpec,
    bars.map((bar) => ({
      assetId: bar.tsCode,
      tradeDate: bar.tradeDate,
      close: bar.close!,
      adjustmentFactor: adjustmentByAssetDate.get(`${bar.tsCode}:${bar.tradeDate}`) ?? Number.NaN,
    })),
    openDates,
    history,
  );
}

export function buildMacroRegimeEvaluationData(
  researchSpec: MacroRegimeFactorResearchSpecV1,
  rows: MacroRegimeEtfDailyRow[],
  openDates: string[],
  history: MacroRegimeHistoryV1,
): MacroRegimeEvaluationData {
  assertSupportedProtocol(researchSpec);
  if (history.revisionPolicy !== researchSpec.dataPolicy.revisionPolicy) {
    throw new Error('Macro regime history revision policy does not match the research spec.');
  }
  const decisionTargets = macroRegimeDecisionTargets(researchSpec, openDates);
  const targetDateByDecision = new Map(
    decisionTargets.eligible.map((period) => [period.asOfDate, period.targetDate]),
  );
  const declaredAssets = new Set(researchSpec.targetAssets);
  const adjustedCloseByAssetDate = new Map<string, number>();
  for (const row of rows) {
    if (!declaredAssets.has(row.assetId)) {
      throw new Error(`Macro regime ETF data uses undeclared asset ${row.assetId}.`);
    }
    if (
      !/^\d{8}$/.test(row.tradeDate) ||
      !Number.isFinite(row.close) ||
      row.close <= 0 ||
      !Number.isFinite(row.adjustmentFactor) ||
      row.adjustmentFactor <= 0
    ) {
      throw new Error(
        `Macro regime ETF data is incomplete for ${row.assetId} on ${row.tradeDate}.`,
      );
    }
    const key = `${row.assetId}:${row.tradeDate}`;
    if (adjustedCloseByAssetDate.has(key)) {
      throw new Error(`Duplicate macro regime ETF bar ${key}.`);
    }
    adjustedCloseByAssetDate.set(key, row.close * row.adjustmentFactor);
  }

  const periods = history.scores.map((score) => {
    const targetDate = targetDateByDecision.get(score.asOfDate);
    if (!targetDate) {
      throw new Error(`Macro regime score ${score.asOfDate} has no frozen target date.`);
    }
    return { score, targetDate };
  });
  const observations: MacroRegimeEvaluationObservation[] = [];
  for (const { score, targetDate } of periods) {
    for (const assetId of researchSpec.targetAssets) {
      const startPrice = adjustedCloseByAssetDate.get(`${assetId}:${score.asOfDate}`);
      const targetPrice = adjustedCloseByAssetDate.get(`${assetId}:${targetDate}`);
      if (startPrice == null || targetPrice == null) {
        continue;
      }
      observations.push({
        assetId,
        asOfDate: score.asOfDate,
        featureAvailableDate: score.featureAvailableDate,
        latestVintageDate: score.latestVintageDate,
        targetDate,
        state: score.state,
        growthScore: score.growth.score,
        inflationScore: score.inflation.score,
        forwardReturn: targetPrice / startPrice - 1,
      });
    }
  }

  return {
    observations,
    periods,
    skippedTargetDates: decisionTargets.skipped,
    skippedMacroDates: history.skippedDates.slice(),
  };
}

export function macroRegimeDecisionTargets(
  researchSpec: MacroRegimeFactorResearchSpecV1,
  openDates: string[],
): {
  eligible: Array<{ asOfDate: string; targetDate: string }>;
  skipped: string[];
} {
  const calendar = [...openDates].sort();
  if (
    calendar.length === 0 ||
    calendar.some((date) => !/^\d{8}$/.test(date)) ||
    new Set(calendar).size !== calendar.length
  ) {
    throw new Error('Macro regime trading calendar is invalid.');
  }
  const calendarIndex = new Map(calendar.map((date, index) => [date, index]));
  const byMonth = new Map<string, string>();
  for (const date of calendar) {
    if (date >= researchSpec.start && date <= researchSpec.end) {
      byMonth.set(date.slice(0, 6), date);
    }
  }
  const eligible: Array<{ asOfDate: string; targetDate: string }> = [];
  const skipped: string[] = [];
  for (const asOfDate of byMonth.values()) {
    const targetDate = calendar[calendarIndex.get(asOfDate)! + researchSpec.target.horizon];
    if (
      !targetDate ||
      (researchSpec.dataPolicy.dataCutoff && targetDate > researchSpec.dataPolicy.dataCutoff)
    ) {
      skipped.push(asOfDate);
      continue;
    }
    eligible.push({ asOfDate, targetDate });
  }
  return { eligible, skipped };
}

function assertSupportedProtocol(researchSpec: MacroRegimeFactorResearchSpecV1): void {
  if (
    researchSpec.observationFrequency !== 'monthly' ||
    researchSpec.target.horizonUnit !== 'trade_day'
  ) {
    throw new Error('Macro regime V1 requires monthly observations and trade-day horizons.');
  }
  if (researchSpec.stateModel.kind !== 'threshold' || researchSpec.stateModel.states !== 4) {
    throw new Error('Macro regime V1 requires the frozen four-state threshold model.');
  }
}

function minimumDate(left: string, right: string): string {
  return left < right ? left : right;
}
