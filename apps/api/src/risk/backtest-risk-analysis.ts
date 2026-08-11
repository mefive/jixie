import type {
  FactorDependency,
  FactorResearchReportPayloadV1,
  PortfolioRiskAnalysisV1,
} from '@jixie/shared';
import { addDays } from '../lib/date.js';
import { prisma, type Prisma } from '../lib/prisma.js';
import type { BacktestResult } from '../engine/types.js';
import {
  alignAlphaPeriodReturnsToRiskAvailability,
  alphaPeriodsFromFactorReport,
  analyzeAlphaRiskOverlap,
  type RawAlphaPeriodReturnObservation,
} from './alpha-risk-overlap.js';
import { loadMacroRiskAxisHistory, type MacroRiskAxisHistoryV1 } from './macro-risk-axes.js';
import {
  aggregatePortfolioMonthlyReturns,
  estimatePortfolioMacroRisk,
} from './macro-risk-model.js';
import {
  loadMarketRiskDriverHistory,
  type MarketRiskDriverHistoryV1,
} from './market-risk-drivers.js';
import {
  alignPortfolioReturnsToNextSseSession,
  estimatePortfolioMarketRisk,
} from './market-risk-model.js';
import {
  HISTORICAL_RISK_SCENARIO_WINDOWS_V1,
  evaluateDeterministicRiskScenarios,
  evaluateHistoricalRiskScenarios,
} from './risk-scenarios.js';

export interface BacktestRiskResearchInput {
  openDates: string[];
  marketHistory: MarketRiskDriverHistoryV1;
  macroHistory?: MacroRiskAxisHistoryV1 | null;
  factorReports: Map<string, FactorResearchReportPayloadV1>;
}

/** Adds optional Phase 5 risk evidence to a completed multi-asset backtest. */
export function buildBacktestRiskAnalysis(
  result: BacktestResult,
  input: BacktestRiskResearchInput,
): PortfolioRiskAnalysisV1 | undefined {
  if (!result.allocationAnalysis || result.nav.length < 2) {
    return undefined;
  }
  const dailyReturns = result.nav.slice(1).map((point, index) => ({
    tradeDate: point.date,
    return: point.value / result.nav[index]!.value - 1,
  }));
  const alignedPortfolioReturns = alignPortfolioReturnsToNextSseSession(
    dailyReturns,
    input.openDates,
  );
  const market = estimatePortfolioMarketRisk(alignedPortfolioReturns, input.marketHistory, {
    asOfDate: result.end,
  });
  const monthlyReturns = aggregatePortfolioMonthlyReturns(
    dailyReturns.map((observation) => ({
      date: observation.tradeDate,
      return: observation.return,
    })),
  );
  const macro = input.macroHistory
    ? estimatePortfolioMacroRisk(monthlyReturns, input.macroHistory, { asOfDate: result.end })
    : null;
  const alphaRiskOverlap = buildFactorOverlap(
    result,
    input.factorReports,
    input.openDates,
    input.marketHistory,
  );
  const scenarios = market
    ? [
        ...evaluateDeterministicRiskScenarios(market),
        ...evaluateHistoricalRiskScenarios(market, input.marketHistory),
      ]
    : [];
  if (!market && !macro && alphaRiskOverlap.length === 0 && scenarios.length === 0) {
    return undefined;
  }
  return {
    version: 1,
    separationPolicy: 'daily_market_risk_and_monthly_macro_sensitivity',
    ...(market ? { market } : {}),
    ...(macro ? { macro } : {}),
    ...(alphaRiskOverlap.length > 0 ? { alphaRiskOverlap } : {}),
    ...(scenarios.length > 0 ? { scenarios } : {}),
  };
}

/** Loads only the source windows needed by one result, then mutates its allocation-analysis envelope. */
export async function attachBacktestRiskAnalysis(
  result: BacktestResult,
  database: Prisma = prisma,
): Promise<void> {
  if (!result.allocationAnalysis || result.nav.length < 2 || result.end < '20180326') {
    return;
  }
  const dependencies = result.factorDependencies ?? [];
  const factorReports = await loadFactorReports(dependencies, database);
  const factorPeriods = [...factorReports.values()].flatMap(alphaPeriodsFromFactorReport);
  const strategyPeriods = strategyAttributedPeriods(result, dependencies);
  const allPeriods = [...factorPeriods, ...strategyPeriods];
  const historicalStarts = HISTORICAL_RISK_SCENARIO_WINDOWS_V1.map((window) => window.startDate);
  const historicalEnds = HISTORICAL_RISK_SCENARIO_WINDOWS_V1.map((window) => window.endDate);
  const sourceStart = minimumDate([
    result.start,
    ...historicalStarts,
    ...allPeriods.map((period) => period.formationDate),
  ]);
  const sourceEnd = maximumDate([
    result.end,
    ...historicalEnds,
    ...allPeriods.map((period) => period.periodEndDate),
  ]);
  const calendarEnd = addDays(sourceEnd, 14);
  const [calendarRows, marketHistory, macroHistory] = await Promise.all([
    database.tradeCal.findMany({
      where: {
        exchange: 'SSE',
        isOpen: 1,
        calDate: { gte: sourceStart, lte: calendarEnd },
      },
      select: { calDate: true },
      orderBy: { calDate: 'asc' },
    }),
    loadMarketRiskDriverHistory({ startDate: sourceStart, endDate: calendarEnd }, database),
    loadMacroRiskAxisHistory(
      {
        startDate: result.start,
        endDate: result.end,
        revisionPolicy: 'latest_vintage',
      },
      database,
    ),
  ]);
  const risk = buildBacktestRiskAnalysis(result, {
    openDates: calendarRows.map((row) => row.calDate),
    marketHistory,
    macroHistory,
    factorReports,
  });
  if (risk) {
    result.allocationAnalysis.risk = risk;
  }
}

function buildFactorOverlap(
  result: BacktestResult,
  factorReports: Map<string, FactorResearchReportPayloadV1>,
  openDates: string[],
  marketHistory: MarketRiskDriverHistoryV1,
) {
  const dependencies = result.factorDependencies ?? [];
  return dependencies.flatMap((dependency) => {
    const payload = dependency.approvedReportId
      ? factorReports.get(dependency.approvedReportId)
      : undefined;
    const reportPeriods = payload ? alphaPeriodsFromFactorReport(payload) : [];
    const strategyPeriods =
      reportPeriods.length === 0 &&
      dependencies.length === 1 &&
      dependency.analysisKind === 'time_series'
        ? strategyAttributedPeriods(result, dependencies)
        : [];
    const periods = reportPeriods.length > 0 ? reportPeriods : strategyPeriods;
    if (periods.length === 0) {
      return [];
    }
    return analyzeAlphaRiskOverlap(
      dependency.key,
      alignAlphaPeriodReturnsToRiskAvailability(periods, openDates),
      marketHistory,
      {
        alphaReturnKind: reportPeriods.length > 0 ? 'net_long_short' : 'strategy_attributed',
      },
    );
  });
}

function strategyAttributedPeriods(
  result: BacktestResult,
  dependencies: FactorDependency[],
): RawAlphaPeriodReturnObservation[] {
  if (dependencies.length !== 1 || dependencies[0]?.analysisKind !== 'time_series') {
    return [];
  }
  const monthEnds = new Map<string, BacktestResult['nav'][number]>();
  for (const point of result.nav) {
    monthEnds.set(point.date.slice(0, 6), point);
  }
  const points = [...monthEnds.values()].sort((left, right) => left.date.localeCompare(right.date));
  return points.slice(1).map((point, index) => ({
    formationDate: points[index]!.date,
    periodEndDate: point.date,
    return: point.value / points[index]!.value - 1,
  }));
}

async function loadFactorReports(
  dependencies: FactorDependency[],
  database: Prisma,
): Promise<Map<string, FactorResearchReportPayloadV1>> {
  const dependencyByReportId = new Map(
    dependencies.flatMap((dependency) =>
      dependency.approvedReportId ? [[dependency.approvedReportId, dependency] as const] : [],
    ),
  );
  if (dependencyByReportId.size === 0) {
    return new Map();
  }
  const rows = await database.factorReport.findMany({
    where: { id: { in: [...dependencyByReportId.keys()] }, status: 'done', payload: { not: null } },
    select: { id: true, payload: true },
  });
  const result = new Map<string, FactorResearchReportPayloadV1>();
  for (const row of rows) {
    const dependency = dependencyByReportId.get(row.id);
    if (!dependency || !row.payload) {
      continue;
    }
    const report = JSON.parse(row.payload) as unknown;
    result.set(row.id, {
      version: 1,
      analysisKind: dependency.analysisKind,
      report,
    } as FactorResearchReportPayloadV1);
  }
  return result;
}

function minimumDate(dates: string[]): string {
  return dates.reduce((minimum, date) => (date < minimum ? date : minimum));
}

function maximumDate(dates: string[]): string {
  return dates.reduce((maximum, date) => (date > maximum ? date : maximum));
}
