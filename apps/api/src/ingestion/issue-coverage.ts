import type { IngestionBatch, IngestionIssue, Prisma } from '@prisma/client';
import {
  DIVIDEND_DATE_FIELDS,
  dividendReceiptHasCompleteFields,
  dividendReceiptMatchesRequests,
} from '#market/fundamentals/dividend-identity.js';
import { quarterlyReportPeriods } from '#market/fundamentals/reference-periods.js';
import { isObservationDate } from '#market/synchronization/date.js';
import { canonicalStockCode } from '#market/instruments/stock-identity.js';
import { FINANCIAL_HISTORY_START } from './plan.js';

const receiptFields = {
  id: true,
  runId: true,
  period: true,
  request: true,
  status: true,
  responseComplete: true,
  rangeStart: true,
  rangeEnd: true,
  rejectedCount: true,
  filteredCount: true,
} satisfies Prisma.IngestionBatchSelect;

type Receipt = Prisma.IngestionBatchGetPayload<{ select: typeof receiptFields }>;

function complete(receipt: Receipt) {
  return receipt.status === 'succeeded' && receipt.responseComplete && receipt.rejectedCount === 0;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && !Array.isArray(item),
  );
}

function coversRange(previous: IngestionBatch, receipt: Receipt, targetDate: string) {
  const dateField =
    previous.dataset === 'dividends' &&
    DIVIDEND_DATE_FIELDS.find((field) => field === previous.scope);
  if (dateField) {
    return (
      receipt.rangeStart === previous.period &&
      receipt.rangeEnd === previous.period &&
      dividendReceiptMatchesRequests(receipt.request, [{ [dateField]: previous.period }])
    );
  }

  const end = previous.rangeEnd ?? (previous.dataset === 'dividends' ? targetDate : null);
  return (
    (!previous.rangeStart ||
      (receipt.rangeStart !== null && receipt.rangeStart <= previous.rangeStart)) &&
    (!end || (receipt.rangeEnd !== null && receipt.rangeEnd >= end))
  );
}

/**
 * 只以晚于旧批次且有明确覆盖证据的收据归档。/ Archive only with later receipts proving coverage.
 */
export function issueCoverageReader(
  database: Prisma.TransactionClient,
  run: { id: string; targetDate: string },
) {
  const queries = new Map<string, Promise<Receipt[]>>();
  function laterReceipts(batch: IngestionBatch, scope: string, period?: string) {
    const key = JSON.stringify([batch.id, scope, period]);
    let query = queries.get(key);
    if (!query) {
      query = database.ingestionBatch.findMany({
        where: {
          runId: { not: run.id },
          run: { targetDate: { gte: run.targetDate } },
          dataset: batch.dataset,
          api: batch.api,
          scope,
          period,
          startedAt: { gt: batch.finishedAt ?? batch.startedAt },
        },
        select: receiptFields,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      });
      queries.set(key, query);
    }

    return query;
  }

  return async (batch: IngestionBatch, issue: Pick<IngestionIssue, 'category' | 'payload'>) => {
    const [report, reportType, security, ...extra] = batch.scope.split('|');
    if (
      batch.dataset === 'financial-statements' &&
      batch.period === 'all' &&
      report &&
      reportType &&
      security &&
      !extra.length
    ) {
      const through = batch.rangeEnd ?? run.targetDate;
      const periods = quarterlyReportPeriods(FINANCIAL_HISTORY_START, through);
      const receipts = await laterReceipts(batch, `${report}|${reportType}`);
      const byPeriod = new Map<string, Receipt>();
      for (const receipt of receipts) {
        if (!byPeriod.has(receipt.period)) {
          byPeriod.set(receipt.period, receipt);
        }
      }
      const confirmed = periods.flatMap((period) => {
        const receipt = byPeriod.get(period);
        if (
          !receipt ||
          !complete(receipt) ||
          receipt.rangeStart !== period ||
          receipt.rangeEnd !== period
        ) {
          return [];
        }
        const requests = records(receipt.request);
        const wholeMarket =
          requests.length > 0 &&
          requests.every((request) => {
            const params = records(request.params)[0];

            return (
              request.api === batch.api &&
              params?.period === period &&
              String(params.report_type) === reportType &&
              !params.ts_code &&
              !params.exchange
            );
          });

        return wholeMarket ? [receipt] : [];
      });
      if (periods.length && confirmed.length === periods.length) {
        return {
          reason: 'covered_by_whole_market_financial_quarters',
          receiptIds: confirmed.map(({ id }) => id),
          runIds: [...new Set(confirmed.map(({ runId }) => runId))],
          firstPeriod: periods[0],
          lastPeriod: periods.at(-1),
        };
      }
    }

    const [receipt] = await laterReceipts(batch, batch.scope, batch.period);
    if (
      !receipt ||
      !complete(receipt) ||
      !coversRange(batch, receipt, run.targetDate) ||
      (batch.dataset === 'dividends' && !dividendReceiptHasCompleteFields(receipt.request))
    ) {
      return null;
    }

    let reason = 'covered_by_later_complete_receipt';
    const payload = records(issue.payload)[0];
    if (batch.dataset === 'stock-adjustments' && issue.category === 'record') {
      const code = payload?.ts_code;
      const date = payload?.trade_date;
      if (typeof code !== 'string' || !isObservationDate(date) || date !== batch.period) {
        return null;
      }
      const tsCode = canonicalStockCode(code);
      const [row, stock] = await Promise.all([
        database.adjFactor.findUnique({
          where: { tsCode_tradeDate: { tsCode, tradeDate: date } },
        }),
        database.stockBasic.findUnique({ where: { tsCode }, select: { tsCode: true } }),
      ]);
      if (row) {
        reason = 'covered_by_later_adjustment_row';
      } else if (!stock && receipt.filteredCount > 0) {
        reason = 'excluded_by_current_stock_catalog';
      } else {
        return null;
      }
    }
    if (
      batch.dataset === 'etf-master' &&
      isObservationDate(payload?.list_date) &&
      payload.list_date > run.targetDate
    ) {
      reason = 'etf_listing_after_target';
    }

    return { reason, receiptIds: [receipt.id], runIds: [receipt.runId] };
  };
}
