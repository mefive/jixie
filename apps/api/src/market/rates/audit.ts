import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber } from '../quality/format.js';
import type {
  AuditFinding,
  ExternalMarketPitAuditRow,
  ExternalMarketPitAuditSummary,
} from '../quality/report.js';
import { CHINABOND_PUBLIC_CURVES } from './chinabond-credit-curves.js';

export interface CreditCurvePitAuditSummary extends ExternalMarketPitAuditSummary {
  staleSeries: string[];
}

export function summarizeCreditCurvePit(
  rows: ExternalMarketPitAuditRow[],
  openDates: Set<string>,
  endDate: string,
): CreditCurvePitAuditSummary {
  const requiredSeries = CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode);
  const observedSeries = new Set(rows.map((row) => row.seriesKey));
  const availableDates = rows.map((row) => row.availableDate).sort();
  return {
    missingSeries: requiredSeries.filter((seriesKey) => !observedSeries.has(seriesKey)),
    invalidAvailabilityRows: rows.filter((row) => row.availableDate <= row.tradeDate).length,
    nonTradingAvailabilityRows: rows.filter((row) => !openDates.has(row.availableDate)).length,
    invalidValueRows: rows.filter((row) => !row.validValue).length,
    latestAvailableDate: availableDates.at(-1) ?? null,
    staleSeries: requiredSeries.filter((seriesKey) => {
      const latest = rows
        .filter((row) => row.seriesKey === seriesKey)
        .map((row) => row.availableDate)
        .sort()
        .at(-1);
      return latest != null && latest < endDate;
    }),
  };
}

export async function auditCreditCurvePit(
  database: Prisma,
  endDate: string,
): Promise<AuditFinding> {
  const curveCodes = CHINABOND_PUBLIC_CURVES.map((curve) => curve.curveCode);
  const curveRows = await database.yieldCurvePoint.findMany({
    where: { curveCode: { in: curveCodes }, termYears: 5 },
    select: {
      curveCode: true,
      tradeDate: true,
      availableDate: true,
      yieldPct: true,
    },
  });
  const rows: ExternalMarketPitAuditRow[] = curveRows.map((row) => ({
    seriesKey: row.curveCode,
    tradeDate: row.tradeDate,
    availableDate: row.availableDate,
    validValue: Number.isFinite(row.yieldPct) && row.yieldPct > -10 && row.yieldPct < 30,
  }));
  const availableDates = rows.map((row) => row.availableDate).sort();
  const firstAvailableDate = availableDates[0];
  const lastAvailableDate = availableDates.at(-1);
  const calendarRows =
    firstAvailableDate && lastAvailableDate
      ? await database.tradeCal.findMany({
          where: {
            exchange: 'SSE',
            isOpen: 1,
            calDate: { gte: firstAvailableDate, lte: lastAvailableDate },
          },
          select: { calDate: true },
        })
      : [];
  const summary = summarizeCreditCurvePit(
    rows,
    new Set(calendarRows.map((row) => row.calDate)),
    endDate,
  );
  const broken =
    summary.missingSeries.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0 ||
    summary.invalidValueRows > 0;

  return {
    id: 'credit-curve-pit',
    title: 'China credit curves: coverage and point-in-time availability',
    status: broken ? 'error' : summary.staleSeries.length > 0 ? 'warn' : 'pass',
    summary: `${formatNumber(rows.length)} 5Y observations; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-trading availability dates`,
    details: [
      `Missing required curves: ${summary.missingSeries.length === 0 ? 'none' : summary.missingSeries.join(', ')}.`,
      `Stale required curves: ${summary.staleSeries.length === 0 ? 'none' : summary.staleSeries.join(', ')}.`,
      `${summary.invalidValueRows} rows have invalid yields; latest China-market availability is ${summary.latestAvailableDate ?? 'none'}.`,
      'ChinaBond curves publish after the China close and must use the first strictly later SSE session; credit spreads require exact same-date, same-term subtraction with no interpolation.',
    ],
  };
}
