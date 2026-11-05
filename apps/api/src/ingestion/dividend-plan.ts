import type { IngestionBatch } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import {
  DIVIDEND_DATE_FIELDS,
  dividendReceiptMatchesRequests,
  dividendSourceCodes,
} from '#market/fundamentals/dividend-identity.js';
import { calendarDay, isObservationDate, localDate } from '#market/synchronization/date.js';
import { readIssueHandling } from './resolutions.js';
import type { IngestionUnit } from './schema.js';

const FIRST_DATED_DIVIDEND = '20000101';

/**
 * 逐股建立基线，按自然日补齐两个公告流；空响应也可建立覆盖。
 *
 * Bootstrap per stock, then fill both announcement streams by calendar day, including empty days.
 */
export async function planDividendUnits(
  codes: readonly string[],
  targetDate: string,
  startedAt: Date,
  runId?: string,
): Promise<IngestionUnit[]> {
  if (!codes.length) {
    return [];
  }

  const database = getDatabase();
  const through = [targetDate, calendarDay(localDate(startedAt), -1)].sort()[0];
  const receipts = await database.ingestionBatch.findMany({
    where: {
      dataset: 'dividends',
      ...(runId ? { runId: { not: runId } } : {}),
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const coveredThrough = new Map<string, string>();
  const dates = new Map<string, boolean>();
  const activeCodes = new Set(codes);

  for (const batch of receipts) {
    const dateField = DIVIDEND_DATE_FIELDS.find((field) => field === batch.scope);
    if (dateField && isObservationDate(batch.period)) {
      const key = `${dateField}/${batch.period}`;
      if (!dates.has(key)) {
        const coversDate =
          batch.rangeStart === batch.period &&
          batch.rangeEnd === batch.period &&
          dividendReceiptMatchesRequests(batch.request, [{ [dateField]: batch.period }]);
        dates.set(key, coversDate && (await isSettled(batch)));
      }
      continue;
    }

    if (
      batch.period !== 'all' ||
      !activeCodes.has(batch.scope) ||
      !isObservationDate(batch.rangeEnd)
    ) {
      continue;
    }
    const covered = [batch.rangeEnd, calendarDay(localDate(batch.startedAt), -1)].sort()[0];
    if (covered <= (coveredThrough.get(batch.scope) ?? '')) {
      continue;
    }
    const requests = dividendSourceCodes(batch.scope).map((ts_code) => ({ ts_code }));
    if (dividendReceiptMatchesRequests(batch.request, requests) && (await isSettled(batch))) {
      coveredThrough.set(batch.scope, covered);
    }
  }

  const units: IngestionUnit[] = [];
  let firstUncovered: string | undefined;
  for (const scope of codes) {
    const covered = coveredThrough.get(scope);
    const nextDate = covered ? calendarDay(covered, 1) : undefined;
    if (!nextDate || (nextDate < FIRST_DATED_DIVIDEND && nextDate <= through)) {
      units.push({
        dataset: 'dividends',
        scope,
        period: 'all',
        fullHistory: true,
        startDate: '',
        endDate: targetDate,
        api: 'dividend',
        refresh: true,
      });
    } else if (!firstUncovered || nextDate < firstUncovered) {
      firstUncovered = nextDate;
    }
  }

  for (let date = firstUncovered; date && date <= through; date = calendarDay(date, 1)) {
    for (const scope of DIVIDEND_DATE_FIELDS) {
      if (!dates.get(`${scope}/${date}`)) {
        units.push({
          dataset: 'dividends',
          scope,
          period: date,
          startDate: date,
          endDate: date,
          catalogThrough: through,
          api: 'dividend',
          refresh: true,
        });
      }
    }
  }

  return units;
}

async function isSettled(batch: IngestionBatch): Promise<boolean> {
  if (!batch.responseComplete) {
    return false;
  }
  if (batch.status === 'succeeded') {
    return batch.rejectedCount === 0;
  }
  if (batch.status !== 'partial') {
    return false;
  }

  const database = getDatabase();
  const issues = await database.ingestionIssue.findMany({
    where: { batchId: batch.id, severity: 'error' },
    include: { resolution: true },
  });
  if (!issues.length) {
    return false;
  }
  for (const { resolution, ...issue } of issues) {
    const handling = await readIssueHandling(database, {
      issue,
      batch,
      resolution,
      classification: 'current',
      reason: 'dividend_receipt_review',
      coverage: null,
    });
    if (handling.status !== 'accepted' && handling.status !== 'resolved') {
      return false;
    }
  }

  return true;
}
