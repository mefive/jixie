import { calendarDay } from '../synchronization/date.js';
import { getDatabase } from '#infra/database/prisma.js';
import { contiguousCoverage } from '../synchronization/coverage.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';

/**
 * 交易日序列共用日历证明，领域自行决定是否需要。
 *
 * Session-series domains explicitly request calendar proof.
 */
export async function qualifySessionSeries(
  partition: MarketPartition,
  prepared: PreparedMarketPartition,
  exchange = 'SSE',
  allowSourceAbsence = false,
): Promise<PreparedMarketPartition> {
  if (
    !prepared.checks.terminalPage ||
    prepared.checks.sourceFailed ||
    prepared.checks.invalidRows
  ) {
    return prepared;
  }

  const database = getDatabase();
  const calendar = await database.datasetSyncPartition.findMany({
    where: {
      dataset: 'calendar',
      scope: exchange,
      status: 'complete',
      startDate: { lte: partition.endDate },
      endDate: { gte: partition.startDate },
    },
  });
  const gaps: string[] = [];
  if ((contiguousCoverage(partition.startDate, calendar) ?? '') < partition.endDate) {
    gaps.push(`${exchange}: unverified source session calendar`);
  }
  const sessions = await database.tradeCal.findMany({
    where: { exchange, isOpen: 1, calDate: { gte: partition.startDate, lte: partition.endDate } },
    select: { calDate: true },
    orderBy: { calDate: 'asc' },
  });
  if (
    !sessions.length &&
    !gaps.length &&
    prepared.checks.emptyResponse &&
    !prepared.errors.length
  ) {
    prepared.status = 'not_applicable';
    prepared.gaps = [];

    return prepared;
  }

  const openDates = new Set(sessions.map((session) => session.calDate));
  if (!gaps.length) {
    const closedDates = prepared.observedDates.filter((date) => !openDates.has(date));
    if (closedDates.length) {
      prepared.errors.push(`Observations on closed sessions: ${closedDates.join(', ')}`);
      prepared.status = 'error';
      for (const table of prepared.tables) {
        table.records = table.records.filter((record) =>
          openDates.has(String(record.values.tradeDate)),
        );
        table.replace = false;
      }
    }
  }

  const observed = new Set(prepared.observedDates);
  const sourceAbsences: string[] = [];
  for (const session of sessions) {
    if (!observed.has(session.calDate)) {
      if (allowSourceAbsence && !gaps.length && !prepared.errors.length) {
        sourceAbsences.push(session.calDate);
      } else {
        gaps.push(
          `${partition.dataset}/${partition.scope}: missing observation ${session.calDate}`,
        );
      }
    }
  }
  if (sourceAbsences.length) {
    // 成功且完整的来源检查可以没有观察值；这不代表停牌，也不生成价格。
    // A complete source check may have no observations.
    // This neither proves suspension nor creates prices.
    (prepared.notes ??= []).push(
      `Source returned no observations on sessions: ${sourceAbsences.join(', ')}`,
    );
    prepared.checks.sourceAbsences = true;
  }
  if (gaps.length) {
    prepared.status = prepared.errors.length ? 'error' : 'partial';
    prepared.gaps.push(...gaps);
    for (const table of prepared.tables) {
      table.replace = false;
    }
  }

  return prepared;
}

/**
 * 捕获日期之后的可得日必须由完整日历证明。
 *
 * Prove the first available session after a capture date.
 */
export async function nextVerifiedSession(
  date: string,
  database: Pick<
    import('@prisma/client').Prisma.TransactionClient,
    'tradeCal' | 'datasetSyncPartition'
  > = getDatabase(),
): Promise<string | null> {
  const next = await database.tradeCal.findFirst({
    where: { exchange: 'SSE', isOpen: 1, calDate: { gt: date } },
    orderBy: { calDate: 'asc' },
    select: { calDate: true },
  });
  if (!next) {
    return null;
  }

  const proof = await database.datasetSyncPartition.findMany({
    where: {
      dataset: 'calendar',
      scope: 'SSE',
      status: 'complete',
      startDate: { lte: next.calDate },
      endDate: { gt: date },
    },
  });

  return (contiguousCoverage(calendarDay(date, 1), proof) ?? '') >= next.calDate
    ? next.calDate
    : null;
}
