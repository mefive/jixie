import type { Prisma } from '#infra/database/prisma.js';
import {
  auditCommodityContinuousReturnPit,
  auditCommodityHoldingPit,
  auditCommodityWarehouseReceiptPit,
} from '#market/commodity/audit.js';
import {
  auditCrossMarketBenchmarkPit,
  auditExternalMarketPit,
} from '#market/cross-market/audit.js';
import { auditEtfRegistry } from '#market/etfs/audit.js';
import {
  auditFinancialPit,
  auditFinancialStatementAccounting,
  auditFinancialStatementVersions,
} from '#market/fundamentals/audit.js';
import { auditIndustryCalendarCoverage } from '#market/indices/audit.js';
import { auditStockUniverse } from '#market/instruments/audit.js';
import { auditMacroPit } from '#market/macro/audit.js';
import { formatNumber, formatPercent } from '#market/quality/format.js';
import type { AuditFinding } from '#market/quality/report.js';
import { auditCreditCurvePit } from '#market/rates/audit.js';
import {
  auditAdjustmentJumps,
  auditHistoricalInvestability,
  auditKeyNullRates,
  auditSparseTopList,
  auditStockCalendarCoverage,
  auditWindowCoverage,
} from '#market/stocks/audit.js';
import { auditMacroRiskAxes, auditMarketRiskDrivers } from './risk-audit.js';

export interface DataQualityAuditReport {
  generatedAt: string;
  scope: {
    startDate: string;
    endDate: string;
    openTradingDays: number;
    windowTradingDays: number;
  };
  findings: AuditFinding[];
}

export interface DataQualityAuditOptions {
  startDate?: string;
  endDate?: string;
  windowTradingDays?: number;
  evaluationPoints?: number;
}

export const DATE_PATTERN = /^\d{8}$/;

export function validateDateRange(startDate: string, endDate: string): void {
  if (!DATE_PATTERN.test(startDate) || !DATE_PATTERN.test(endDate)) {
    throw new Error('Audit dates must use YYYYMMDD');
  }
  if (startDate > endDate) {
    throw new Error('Audit start date must not be after end date');
  }
}

export async function runDataQualityAudit(
  database: Prisma,
  options: DataQualityAuditOptions = {},
): Promise<DataQualityAuditReport> {
  const dailyBounds = await database.daily.aggregate({
    _min: { tradeDate: true },
    _max: { tradeDate: true },
  });
  const availableStart = dailyBounds._min.tradeDate;
  const availableEnd = dailyBounds._max.tradeDate;
  if (!availableStart || !availableEnd) {
    throw new Error('Daily is empty; sync market data before running the audit');
  }

  const startDate = options.startDate ?? availableStart;
  const endDate = options.endDate ?? availableEnd;
  validateDateRange(startDate, endDate);
  const windowTradingDays = options.windowTradingDays ?? 60;
  const evaluationPoints = options.evaluationPoints ?? 5;
  if (!Number.isInteger(windowTradingDays) || windowTradingDays < 20 || windowTradingDays > 504) {
    throw new Error('windowTradingDays must be an integer between 20 and 504');
  }
  if (!Number.isInteger(evaluationPoints) || evaluationPoints < 1 || evaluationPoints > 12) {
    throw new Error('evaluationPoints must be an integer between 1 and 12');
  }

  const calendarRows = await database.tradeCal.findMany({
    where: {
      exchange: 'SSE',
      isOpen: 1,
      calDate: { gte: startDate, lte: endDate },
    },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  const openDates = calendarRows.map((row) => row.calDate);
  if (openDates.length === 0) {
    throw new Error(`TradeCal has no SSE open days in ${startDate}..${endDate}`);
  }

  const findings: AuditFinding[] = [
    ...(await auditStockCalendarCoverage(database, startDate, endDate, openDates)),
    await auditIndustryCalendarCoverage(database, startDate, endDate, openDates),
  ];

  findings.push(
    await auditSparseTopList(database, startDate, endDate),
    await auditKeyNullRates(database, startDate, endDate),
    await auditAdjustmentJumps(database, startDate, endDate),
    await auditStockUniverse(database),
    await auditHistoricalInvestability(database),
    await auditEtfRegistry(database, openDates.at(-1)!),
    await auditWindowCoverage(database, openDates, windowTradingDays, evaluationPoints),
    await auditFinancialPit(database),
    await auditFinancialStatementVersions(database),
    await auditFinancialStatementAccounting(database),
    await auditMacroPit(database),
    await auditExternalMarketPit(database, endDate),
    await auditCrossMarketBenchmarkPit(database, endDate),
    await auditCreditCurvePit(database, endDate),
    await auditCommodityWarehouseReceiptPit(database, startDate, endDate),
    await auditCommodityHoldingPit(database, startDate, endDate),
    await auditCommodityContinuousReturnPit(database, startDate, endDate),
    await auditMarketRiskDriverPit(database, startDate, endDate),
    await auditMacroRiskAxisPit(database, startDate, endDate),
  );

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      startDate,
      endDate,
      openTradingDays: openDates.length,
      windowTradingDays,
    },
    findings,
  };
}

export async function auditMarketRiskDriverPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditMarketRiskDrivers({ startDate, endDate }, database);
  return {
    id: 'market-risk-driver-readiness',
    title: 'Daily market-risk drivers: complete-vector PIT readiness',
    status: summary.status,
    summary: `${formatNumber(summary.completeObservations)}/${formatNumber(summary.expectedDates)} complete SSE sessions (${formatPercent(summary.completeCoverage)}); latest ${summary.latestCompleteDate ?? 'n/a'}`,
    details: [
      ...summary.factors.map(
        (factor) =>
          `${factor.factor}: ${formatNumber(factor.observations)} observations, latest ${factor.latestDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Daily market-risk vectors remain separate from monthly macro axes. Missing drivers remove the date from multivariate estimation; no factor is filled with zero.',
    ],
  };
}

export async function auditMacroRiskAxisPit(
  database: Prisma,
  startDate: string,
  endDate: string,
): Promise<AuditFinding> {
  const summary = await auditMacroRiskAxes({ startDate, endDate }, database);
  return {
    id: 'macro-risk-axis-readiness',
    title: 'Monthly macro-risk axes: exploratory and strict-PIT readiness',
    status: summary.status,
    summary: `${formatNumber(summary.exploratoryCompleteObservations)} exploratory and ${formatNumber(summary.strictCompleteObservations)} strict-PIT complete months; latest ${summary.latestExploratoryCompleteDate ?? 'n/a'}`,
    details: [
      ...summary.axes.map(
        (axis) =>
          `${axis.axis}: ${formatNumber(axis.exploratoryObservations)} exploratory changes, ${formatNumber(axis.strictObservations)} strict-PIT changes, latest ${axis.latestExploratoryDate ?? 'n/a'}.`,
      ),
      ...summary.errors.map((error) => `Error: ${error}.`),
      ...summary.warnings.map((warning) => `Warning: ${warning}.`),
      'Growth, inflation, liquidity, credit, and external-pressure score changes are monthly and remain separate from the daily market-risk covariance model.',
      'Latest-vintage history supports exploration only. Macro sensitivity becomes publishable only after enough locally captured as-available vintages accumulate.',
    ],
  };
}
