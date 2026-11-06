import type { IngestionBatch } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
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

  const capturedDate = localDate(batch.startedAt);
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
    if (next?.startsWith(date.slice(0, 6)) && !coverage.has(next)) {
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

  const database = getDatabase();
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
  const histories = new Map<string, string>();
  for (const batch of batches) {
    const [kind, reportType, security] = batch.scope.split('|');
    const scope = `${kind}|${reportType}`;
    const plan = plans.get(batch.runId);
    const unit = plan?.units.get(`${batch.scope}/${batch.period}`);
    if (!batch.finishedAt || batch.startedAt > observedAt) {
      continue;
    }
    if (security) {
      const coversReportHorizon =
        batch.period === STATEMENT_HISTORY_SNAPSHOT
          ? Boolean(batch.rangeEnd || (unit?.catalogThrough && unit.catalogThrough >= through))
          : Boolean(batch.rangeEnd && batch.rangeEnd >= through);
      if (
        requestedCodes.has(security) &&
        !histories.has(batch.scope) &&
        (!batch.rangeStart || batch.rangeStart <= FINANCIAL_HISTORY_START) &&
        coversReportHorizon &&
        statementReceiptMatchesBatch(batch) &&
        (await isSettledReceipt(batch))
      ) {
        histories.set(batch.scope, localDate(batch.startedAt));
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

  // 历史目标也读到抓取当日的公告标签，以覆盖实际公告较早的记录。
  // Read announcement labels up to capture day even for historical targets, for earlier actual dates.
  const days: string[] = [];
  for (let date = FINANCIAL_HISTORY_START; date <= observedDate; date = calendarDay(date, 1)) {
    days.push(date);
  }

  const units: IngestionUnit[] = [];
  for (const [kind, api] of Object.entries(FINANCIAL_STATEMENT_APIS)) {
    for (const reportType of FINANCIAL_REPORT_TYPES) {
      const scope = `${kind}|${reportType}`;
      let coverage = new Map<string, DisclosureReceipt>();
      for (const receipt of announcements.get(scope) ?? []) {
        for (let date = receipt.startDate; date <= receipt.endDate; date = calendarDay(date, 1)) {
          if (!coverage.has(date)) {
            coverage.set(date, receipt);
          }
        }
      }

      let windows = announcementUnits(scope, api, days, coverage, through);
      const coveredUniverses = [...new Set([...coverage.values()].map((receipt) => receipt.codes))];
      const codesWithoutHistory = codes.filter(
        (code) =>
          !histories.has(`${scope}|${code}`) &&
          coveredUniverses.some((universe) => !universe.has(code)),
      );
      if (codesWithoutHistory.length) {
        // 批量补齐名单缺口成本更低时，重扫受影响的日期窗口。
        // Replay affected windows when bulk coverage costs fewer planned units than per-security history.
        const replayReceipts = new Set(
          [...new Set(coverage.values())].filter((receipt) =>
            codesWithoutHistory.some((code) => !receipt.codes.has(code)),
          ),
        );
        const remainingCoverage = new Map(
          [...coverage].filter(([, receipt]) => !replayReceipts.has(receipt)),
        );
        const replayWindows = announcementUnits(scope, api, days, remainingCoverage, through);
        if (replayWindows.length < windows.length + codesWithoutHistory.length) {
          coverage = remainingCoverage;
          windows = replayWindows;
        }
      }
      units.push(...windows);

      const reused = new Set(coverage.values());
      const universes = [...new Set([...reused].map((receipt) => receipt.codes))];
      const codeCaptures = new Map<string, string>();
      for (const code of codes.filter((code) =>
        universes.some((universe) => !universe.has(code)),
      )) {
        const historyScope = `${scope}|${code}`;
        const existing = histories.get(historyScope);
        codeCaptures.set(code, existing ?? observedDate);
        if (existing) {
          continue;
        }

        units.push({
          dataset: 'financial-statements',
          scope: historyScope,
          period: STATEMENT_HISTORY_SNAPSHOT,
          api,
          startDate: FINANCIAL_HISTORY_START,
          endDate: through,
          catalogThrough: through,
          fullHistory: true,
          refresh: true,
        });
      }

      const firstActualDate = [
        observedDate,
        ...codeCaptures.values(),
        ...[...reused].map(({ capturedDate }) => capturedDate),
      ].sort()[0];
      for (let date = firstActualDate; date <= through; date = calendarDay(date, 1)) {
        const covered = actualDays
          .get(`${scope}/${date}`)
          ?.some((receipt) =>
            codes.every((code) => receipt.codes.has(code) || (codeCaptures.get(code) ?? '') > date),
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
