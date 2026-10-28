import type { Prisma } from '#infra/database/prisma.js';
import { auditEtfRegistry } from '#market/etfs/audit.js';
import {
  auditFinancialPit,
  auditFinancialStatementAccounting,
  auditFinancialStatementVersions,
} from '#market/fundamentals/audit.js';
import { auditStockUniverse } from '#market/instruments/audit.js';
import type { AuditFinding } from '#market/quality/report.js';
import {
  auditAdjustmentJumps,
  auditHistoricalInvestability,
  auditKeyNullRates,
  auditStockCalendarCoverage,
  auditWindowCoverage,
} from '#market/stocks/audit.js';

/**
 * 汇总维护发布前的数据质量检查结果，供审计与发布判断。
 *
 * Summarize pre-publication data-quality checks for auditing and publication decisions.
 */
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

/**
 * 配置数据质量审计的范围及输出选项。
 *
 * Configure the scope and output options of a data-quality audit.
 */
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

/**
 * 组合各数据域的质量检查并生成可追溯维护审计报告。
 *
 * Combine dataset quality checks into a traceable maintenance audit report.
 */
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
  ];

  findings.push(
    await auditKeyNullRates(database, startDate, endDate),
    await auditAdjustmentJumps(database, startDate, endDate),
    await auditStockUniverse(database),
    await auditHistoricalInvestability(database),
    await auditEtfRegistry(database, openDates.at(-1)!),
    await auditWindowCoverage(database, openDates, windowTradingDays, evaluationPoints),
    await auditFinancialPit(database),
    await auditFinancialStatementVersions(database),
    await auditFinancialStatementAccounting(database),
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
