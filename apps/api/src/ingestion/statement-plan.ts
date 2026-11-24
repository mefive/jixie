import { getMarketDatabase } from '#infra/database/market-database.js';
import { sourceCaptureStartedAt } from '#market/synchronization/execution.js';
import type { IngestionBatch } from '@jixie/market-db-client';

import {
  FINANCIAL_REPORT_TYPES,
  FINANCIAL_STATEMENT_APIS,
  STATEMENT_HISTORY_SNAPSHOT,
  statementAnnouncementWindow,
  statementReceiptMatchesBatch,
} from '#market/fundamentals/statement-requests.js';
import { calendarDay, localDate } from '#market/synchronization/date.js';
import { isSettledReceipt } from './receipts.js';
import { runPlanSchema, type IngestionUnit } from './schema.js';

export const FINANCIAL_HISTORY_START = '19880101';
export const STATEMENT_STRATEGY = 'announcement_range';

interface DisclosureReceipt {
  startDate: string;
  endDate: string;
  capturedDate: string;
  codes: ReadonlySet<string>;
}

function disclosureReceipt(
  batch: IngestionBatch,
  unit: IngestionUnit,
  codes: ReadonlySet<string>,
  through: string,
): DisclosureReceipt | undefined {
  if (!batch.finishedAt || !statementReceiptMatchesBatch(batch, true)) {
    return undefined;
  }
  const window = statementAnnouncementWindow(batch.period);
  if (
    unit.startDate !== batch.rangeStart ||
    unit.endDate !== (window?.endDate ?? batch.rangeStart)
  ) {
    return undefined;
  }
  if (!batch.rangeEnd && (!unit.catalogThrough || unit.catalogThrough < through)) {
    return undefined;
  }

  const capturedDate = localDate(sourceCaptureStartedAt(batch));
  const endDate = [unit.endDate, calendarDay(capturedDate, -1)].sort()[0];
  if (unit.startDate > endDate) {
    return undefined;
  }

  return { startDate: unit.startDate, endDate, capturedDate, codes };
}

function announcementUnits(
  scope: string,
  api: string,
  days: readonly string[],
  coverage: ReadonlyMap<string, DisclosureReceipt>,
  through: string,
): IngestionUnit[] {
  const units: IngestionUnit[] = [];
  let start: string | undefined;
  for (const [index, date] of days.entries()) {
    if (coverage.has(date)) {
      continue;
    }
    start ??= date;
    const next = days[index + 1];
    if (next && !coverage.has(next)) {
      continue;
    }

    units.push({
      dataset: 'financial-statements',
      scope,
      api,
      period: `ann_range/${start}/${date}`,
      startDate: start,
      endDate: date,
      catalogThrough: through,
      announcementField: 'ann_date',
      announcementRange: true,
      adaptiveRange: true,
      refresh: true,
    });
    start = undefined;
  }

  return units;
}

/**
 * 用公告日区间收据证明历史，按最早实际抓取日补查实际披露。
 *
 * Use announcement-window receipts for history and cover actual disclosures since the oldest capture.
 */
export async function planStatementUnits(
  codes: readonly string[],
  targetDate: string,
  observedAt: Date,
): Promise<IngestionUnit[]> {
  const observedDate = localDate(observedAt);
  const through = [targetDate, calendarDay(observedDate, -1)].sort()[0];
  if (!codes.length || through < FINANCIAL_HISTORY_START) {
    return [];
  }

  const database = getMarketDatabase();
  const batches = await database.ingestionBatch.findMany({
    where: {
      dataset: 'financial-statements',
      status: { in: ['succeeded', 'partial'] },
      responseComplete: true,
      OR: [
        { period: { startsWith: 'ann_range/' } },
        { period: { startsWith: 'ann_date/' } },
        { period: { startsWith: 'f_ann_date/' } },
        { period: { in: ['all', STATEMENT_HISTORY_SNAPSHOT] } },
      ],
    },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const previousRuns = await database.ingestionRun.findMany({
    where: { id: { in: [...new Set(batches.map(({ runId }) => runId))] } },
    select: { id: true, scopeSnapshot: true },
  });
  const plans = new Map<
    string,
    { codes: ReadonlySet<string>; units: ReadonlyMap<string, IngestionUnit> }
  >();
  for (const run of previousRuns) {
    const parsed = runPlanSchema.safeParse(run.scopeSnapshot);
    const plan = parsed.success ? parsed.data.plan : undefined;
    plans.set(run.id, {
      codes: new Set(plan?.statementCodes),
      units: new Map(
        plan?.units
          .filter((unit) => unit.dataset === 'financial-statements')
          .map((unit) => [`${unit.scope}/${unit.period}`, unit]),
      ),
    });
  }

  const requestedCodes = new Set(codes);
  const announcements = new Map<string, DisclosureReceipt[]>();
  const actualDays = new Map<string, DisclosureReceipt[]>();
  const historyEnds = new Map<string, string>();
  for (const batch of batches) {
    const [kind, reportType, security] = batch.scope.split('|');
    const scope = `${kind}|${reportType}`;
    const plan = plans.get(batch.runId);
    const unit = plan?.units.get(`${batch.scope}/${batch.period}`);
    if (!batch.finishedAt || batch.startedAt > observedAt) {
      continue;
    }
    if (security) {
      // 有延后报告期的旧收据只在原截止范围内使用。
      // Reuse a legacy receipt with deferred periods only within its original horizon.
      let horizon = batch.rangeEnd;
      if (
        !horizon &&
        batch.period === STATEMENT_HISTORY_SNAPSHOT &&
        unit?.catalogThrough &&
        unit.catalogThrough >= through
      ) {
        horizon = unit.catalogThrough;
      }

      if (
        horizon &&
        requestedCodes.has(security) &&
        (!batch.rangeStart || batch.rangeStart <= FINANCIAL_HISTORY_START) &&
        statementReceiptMatchesBatch(batch) &&
        (await isSettledReceipt(batch))
      ) {
        const captured = localDate(sourceCaptureStartedAt(batch));
        const end = [horizon, calendarDay(captured, -1)].sort()[0];
        if (end > (historyEnds.get(batch.scope) ?? '')) {
          historyEnds.set(batch.scope, end);
        }
      }
      continue;
    }
    if (!plan?.codes.size || !unit) {
      continue;
    }

    const receipt = disclosureReceipt(batch, unit, plan.codes, through);
    if (!receipt || !(await isSettledReceipt(batch))) {
      continue;
    }
    if (unit.announcementField === 'f_ann_date') {
      addDisclosureReceipt(actualDays, `${scope}/${receipt.startDate}`, receipt);
    } else if (unit.announcementField === 'ann_date') {
      addDisclosureReceipt(announcements, scope, receipt);
    }
  }

  // 最晚公告日作为可得性门槛，公告标签晚于目标的记录无需提前采集。
  // Latest-date availability makes announcement labels beyond the target unnecessary.
  const days: string[] = [];
  for (let date = FINANCIAL_HISTORY_START; date <= through; date = calendarDay(date, 1)) {
    days.push(date);
  }

  const units: IngestionUnit[] = [];
  for (const [kind, api] of Object.entries(FINANCIAL_STATEMENT_APIS)) {
    for (const reportType of FINANCIAL_REPORT_TYPES) {
      const scope = `${kind}|${reportType}`;
      const coverage = new Map<string, DisclosureReceipt>();
      for (const receipt of announcements.get(scope) ?? []) {
        for (let date = receipt.startDate; date <= receipt.endDate; date = calendarDay(date, 1)) {
          if (!coverage.has(date)) {
            coverage.set(date, receipt);
          }
        }
      }

      // 每份名单只比较一次。逐股收据补足其截止日以前的缺口，不证明其他股票或日期。
      // Compare each universe once. A security receipt covers only that stock through its horizon.
      const latestByUniverse = new Map<ReadonlySet<string>, string>();
      for (const [date, receipt] of coverage) {
        if (date > (latestByUniverse.get(receipt.codes) ?? '')) {
          latestByUniverse.set(receipt.codes, date);
        }
      }

      const missingCodes = new Set<string>();
      const coveredThrough = new Map<ReadonlySet<string>, string>();
      const firstActualByCode = new Map<string, string>();
      for (const [universe, lastDate] of latestByUniverse) {
        for (const code of codes) {
          if (universe.has(code)) {
            continue;
          }
          const end = historyEnds.get(`${scope}|${code}`) ?? '';
          if (end < lastDate) {
            missingCodes.add(code);
            const earliest = coveredThrough.get(universe);
            if (earliest === undefined || end < earliest) {
              coveredThrough.set(universe, end);
            }
          }
          if (end) {
            firstActualByCode.set(code, calendarDay(end, 1));
          }
        }
      }

      const replayDays = [...coverage].filter(([date, receipt]) => {
        const end = coveredThrough.get(receipt.codes);
        return end !== undefined && date > end;
      });
      if (replayDays.length && replayDays.length <= missingCodes.size) {
        for (const [date] of replayDays) {
          coverage.delete(date);
        }
      } else {
        for (const code of missingCodes) {
          units.push({
            dataset: 'financial-statements',
            scope: `${scope}|${code}`,
            api,
            period: STATEMENT_HISTORY_SNAPSHOT,
            startDate: FINANCIAL_HISTORY_START,
            endDate: through,
            catalogThrough: through,
            fullHistory: true,
            refresh: true,
          });
          firstActualByCode.set(code, calendarDay(through, 1));
        }
      }
      units.push(...announcementUnits(scope, api, days, coverage, through));

      const reused = new Set(coverage.values());
      const firstActualDate = [
        observedDate,
        ...firstActualByCode.values(),
        ...[...reused].map(({ capturedDate }) => capturedDate),
      ].sort()[0];
      for (let date = firstActualDate; date <= through; date = calendarDay(date, 1)) {
        const covered = actualDays
          .get(`${scope}/${date}`)
          ?.some((receipt) =>
            codes.every(
              (code) => receipt.codes.has(code) || (firstActualByCode.get(code) ?? '') > date,
            ),
          );
        if (covered) {
          continue;
        }
        units.push({
          dataset: 'financial-statements',
          scope,
          period: `f_ann_date/${date}`,
          startDate: date,
          endDate: date,
          catalogThrough: through,
          announcementField: 'f_ann_date',
          api,
          refresh: true,
        });
      }
    }
  }

  return units;
}

function addDisclosureReceipt(
  coverage: Map<string, DisclosureReceipt[]>,
  key: string,
  receipt: DisclosureReceipt,
) {
  const saved = coverage.get(key) ?? [];
  saved.push(receipt);
  coverage.set(key, saved);
}
