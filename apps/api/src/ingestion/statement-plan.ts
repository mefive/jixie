import type { IngestionBatch } from '@prisma/client';
import { getDatabase } from '#infra/database/prisma.js';
import { canonicalStockCode, stockSourceCodes } from '#market/instruments/stock-identity.js';
import { stockMarketRanges } from '#market/instruments/market-range.js';
import { quarterlyReportPeriods } from '#market/fundamentals/reference-periods.js';
import type { FinancialStatementKind } from '#market/fundamentals/source-contract.js';
import {
  FINANCIAL_ANNOUNCEMENT_FIELDS,
  FINANCIAL_REPORT_TYPES,
  FINANCIAL_STATEMENT_APIS,
  statementReceiptMatchesRequests,
} from '#market/fundamentals/statement-requests.js';
import { calendarDay, isObservationDate, localDate } from '#market/synchronization/date.js';
import { isSettledReceipt } from './receipts.js';
import { runPlanSchema, type IngestionUnit } from './schema.js';

export const FINANCIAL_HISTORY_START = '19880101';

/**
 * 报告期收据建立历史基线，两个公告日期流接纳后续披露及修订。
 *
 * Establish history from report-period receipts, then acquire disclosures and revisions from both date streams.
 */
export async function planStatementUnits(
  codes: readonly string[],
  targetDate: string,
  startedAt: Date,
  runId?: string,
): Promise<IngestionUnit[]> {
  const database = getDatabase();
  const through = [targetDate, calendarDay(localDate(startedAt), -1)].sort()[0];
  const periods = quarterlyReportPeriods(FINANCIAL_HISTORY_START, through);
  if (!codes.length || !periods.length) {
    return [];
  }

  const receipts = await database.ingestionBatch.findMany({
    where: {
      dataset: 'financial-statements',
      ...(runId ? { runId: { not: runId } } : {}),
    },
    include: { run: { select: { targetDate: true, startedAt: true } } },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  const previousRuns = await database.ingestionRun.findMany({
    where: { id: { in: [...new Set(receipts.map((batch) => batch.runId))] } },
    select: { id: true, scopeSnapshot: true },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
  });
  const universes = new Map<string, Set<string>>();
  const marketRanges = stockMarketRanges(await database.stockBasic.findMany());
  const cutoffs = new Map<string, string>();
  let inherited = new Set<string>();
  for (const run of previousRuns) {
    const parsed = runPlanSchema.safeParse(run.scopeSnapshot);
    const plan = parsed.success ? parsed.data.plan : undefined;
    for (const unit of plan?.units ?? []) {
      if (unit.dataset === 'financial-statements' && isObservationDate(unit.catalogThrough)) {
        cutoffs.set(`${run.id}/${unit.scope}/${unit.period}`, unit.catalogThrough);
      }
    }
    if (plan?.statementCodes) {
      inherited = new Set(plan.statementCodes);
    } else {
      // 旧版完整分红计划枚举了同一股票目录；后续新增标的计划补充该名单。
      // Legacy complete-dividend plans enumerate the same stock catalog; later bootstrap units extend it.
      for (const unit of plan?.units ?? []) {
        if (unit.dataset === 'dividends' && unit.period === 'all') {
          inherited.add(canonicalStockCode(unit.scope));
        }
      }
    }
    universes.set(run.id, plan ? new Set(inherited) : new Set());
  }

  const settled = new Map<string, Promise<boolean>>();
  const complete = (batch: IngestionBatch) => {
    let result = settled.get(batch.id);
    if (!result) {
      result = isSettledReceipt(batch);
      settled.set(batch.id, result);
    }

    return result;
  };
  const units: IngestionUnit[] = [];
  const coveredThrough = (batch: (typeof receipts)[number]) => {
    const bound = cutoffs.get(`${batch.runId}/${batch.scope}/${batch.period}`);

    return [
      batch.run.targetDate,
      bound ?? calendarDay(localDate(batch.run.startedAt), -1),
    ].sort()[0];
  };
  for (const [kind, api] of Object.entries(FINANCIAL_STATEMENT_APIS)) {
    const statementKind = kind as FinancialStatementKind;
    for (const reportType of FINANCIAL_REPORT_TYPES) {
      const scope = `${kind}|${reportType}`;
      const quarters = new Map<string, (typeof receipts)[number]>();
      const histories = new Map<string, string>();
      const dated = new Map<string, (typeof receipts)[number]>();

      for (const batch of receipts) {
        if (batch.api !== api) {
          continue;
        }
        if (batch.scope === scope) {
          const dateField = FINANCIAL_ANNOUNCEMENT_FIELDS.find(
            (field) => batch.period === `${field}/${batch.rangeStart}`,
          );
          if (dateField) {
            if (!dated.has(batch.period)) {
              dated.set(batch.period, batch);
            }
          } else if (
            periods.includes(batch.period) &&
            batch.rangeStart === batch.period &&
            batch.rangeEnd === batch.period &&
            statementReceiptMatchesRequests(batch.request, statementKind, [
              { period: batch.period, report_type: reportType },
            ]) &&
            (await complete(batch))
          ) {
            const previous = quarters.get(batch.period);
            if (!previous || coveredThrough(batch) > coveredThrough(previous)) {
              quarters.set(batch.period, batch);
            }
          }
        } else if (
          batch.scope.startsWith(`${scope}|`) &&
          batch.period === 'all' &&
          (!batch.rangeStart || batch.rangeStart <= FINANCIAL_HISTORY_START) &&
          isObservationDate(batch.rangeEnd)
        ) {
          const code = batch.scope.slice(scope.length + 1);
          if (
            codes.includes(code) &&
            statementReceiptMatchesRequests(
              batch.request,
              statementKind,
              stockSourceCodes(code).map((ts_code) => ({ ts_code, report_type: reportType })),
            ) &&
            (await complete(batch))
          ) {
            histories.set(code, [histories.get(code) ?? '', batch.rangeEnd].sort().at(-1)!);
          }
        }
      }

      const knownQuarters = [...quarters.values()];
      const baseline = knownQuarters.length
        ? knownQuarters.map(coveredThrough).sort()[0]
        : undefined;
      const baselineKnown =
        baseline && knownQuarters.every((batch) => universes.get(batch.runId)?.size);
      const bootstrap = periods.filter(
        (period) => !baselineKnown || (!quarters.has(period) && period <= baseline),
      );
      for (const period of bootstrap) {
        units.push({
          dataset: 'financial-statements',
          scope,
          period,
          startDate: period,
          endDate: period,
          catalogThrough: through,
          api,
          refresh: true,
        });
      }
      if (!baselineKnown || bootstrap.length === periods.length) {
        continue;
      }

      for (const code of codes) {
        const missingThrough = knownQuarters
          .filter((batch) => {
            const marketStart = marketRanges.get(code)?.startDate;

            return (
              !universes.get(batch.runId)!.has(code) ||
              Boolean(marketStart && marketStart > coveredThrough(batch))
            );
          })
          .map((batch) => batch.period)
          .sort()
          .at(-1);
        if (missingThrough && (histories.get(code) ?? '') < missingThrough) {
          units.push({
            dataset: 'financial-statements',
            scope: `${scope}|${code}`,
            period: 'all',
            fullHistory: true,
            startDate: FINANCIAL_HISTORY_START,
            endDate: through,
            catalogThrough: through,
            api,
            refresh: true,
          });
        }
      }

      for (let date = calendarDay(baseline, 1); date <= through; date = calendarDay(date, 1)) {
        for (const announcementField of FINANCIAL_ANNOUNCEMENT_FIELDS) {
          const period = `${announcementField}/${date}`;
          const batch = dated.get(period);
          if (
            batch &&
            batch.rangeEnd === date &&
            statementReceiptMatchesRequests(batch.request, statementKind, [
              { [announcementField]: date, report_type: reportType },
            ]) &&
            (await complete(batch))
          ) {
            continue;
          }
          units.push({
            dataset: 'financial-statements',
            scope,
            period,
            startDate: date,
            endDate: date,
            catalogThrough: through,
            announcementField,
            api,
            refresh: true,
          });
        }
      }
    }
  }

  return units;
}
