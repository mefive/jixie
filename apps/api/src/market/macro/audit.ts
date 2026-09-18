import type { Prisma } from '#infra/database/prisma.js';
import { formatNumber } from '../quality/format.js';
import type { AuditFinding, AuditStatus } from '../quality/report.js';
import { CHINA_MACRO_SERIES } from './china-macro.js';
import { US_HEADLINE_CPI_SERIES_KEY } from './us-headline-cpi.js';

export interface MacroPitAuditRow {
  seriesKey: string;
  period: string;
  releaseDate: string | null;
  availableDate: string;
  availabilityKind: string;
  vintageKind: string;
}

export interface MacroPitAuditSummary {
  missingSeries: string[];
  invalidAvailabilityRows: number;
  nonTradingAvailabilityRows: number;
  conservativeLagRows: number;
  latestValueBackfillRows: number;
  capturedAsAvailableRows: number;
}

export function summarizeMacroPit(
  observedSeries: string[],
  observations: MacroPitAuditRow[],
  openDates: Set<string>,
): MacroPitAuditSummary {
  const observed = new Set(observedSeries);
  return {
    missingSeries: [
      ...CHINA_MACRO_SERIES.map((definition) => definition.seriesKey),
      US_HEADLINE_CPI_SERIES_KEY,
    ].filter((seriesKey) => !observed.has(seriesKey)),
    invalidAvailabilityRows: observations.filter(
      (row) =>
        (row.releaseDate != null && row.availableDate < row.releaseDate) ||
        (row.availabilityKind === 'official_schedule' && row.releaseDate == null) ||
        (row.availabilityKind === 'conservative_lag' && row.releaseDate != null) ||
        (row.availabilityKind === 'published_intraday' && row.releaseDate !== row.period) ||
        !['official_schedule', 'published_intraday', 'conservative_lag'].includes(
          row.availabilityKind,
        ),
    ).length,
    nonTradingAvailabilityRows: observations.filter((row) => !openDates.has(row.availableDate))
      .length,
    conservativeLagRows: observations.filter((row) => row.availabilityKind === 'conservative_lag')
      .length,
    latestValueBackfillRows: observations.filter(
      (row) => row.vintageKind === 'latest_value_backfill',
    ).length,
    capturedAsAvailableRows: observations.filter(
      (row) => row.vintageKind === 'captured_as_available',
    ).length,
  };
}

export async function auditMacroPit(database: Prisma): Promise<AuditFinding> {
  const observations = await database.macroObservation.findMany({
    select: {
      seriesKey: true,
      period: true,
      releaseDate: true,
      availableDate: true,
      availabilityKind: true,
      vintageKind: true,
    },
  });
  const observedSeries = [...new Set(observations.map((row) => row.seriesKey))];
  const availableDates = observations.map((row) => row.availableDate).sort();
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
  const summary = summarizeMacroPit(
    observedSeries,
    observations,
    new Set(calendarRows.map((row) => row.calDate)),
  );
  const hasBrokenInvariant =
    summary.missingSeries.length > 0 ||
    summary.invalidAvailabilityRows > 0 ||
    summary.nonTradingAvailabilityRows > 0;
  const hasEstimatedHistory =
    summary.conservativeLagRows > 0 || summary.latestValueBackfillRows > 0;
  const status: AuditStatus = hasBrokenInvariant ? 'error' : hasEstimatedHistory ? 'warn' : 'pass';

  return {
    id: 'macro-pit',
    title: 'Macro observations: point-in-time availability',
    status,
    summary: `${formatNumber(observations.length)} vintages; ${summary.invalidAvailabilityRows} invalid availability rows; ${summary.nonTradingAvailabilityRows} non-trading availability dates`,
    details: [
      `Missing required series: ${summary.missingSeries.length === 0 ? 'none' : summary.missingSeries.join(', ')}.`,
      `${formatNumber(summary.conservativeLagRows)} rows use conservative release lags; ${formatNumber(summary.latestValueBackfillRows)} rows are latest-value historical backfills.`,
      `${formatNumber(summary.capturedAsAvailableRows)} rows were captured near their original availability date.`,
      'Latest-value backfills are suitable for exploratory research only and must not be presented as real-time vintages.',
    ],
  };
}
