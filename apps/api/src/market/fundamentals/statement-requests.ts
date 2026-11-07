import { sourceRequests } from '../synchronization/execution.js';
import { financialStatementSourceFields, type FinancialStatementKind } from './source-contract.js';
import { stockSourceCodes } from '../instruments/stock-identity.js';
import { calendarDay, isObservationDate } from '../synchronization/date.js';

export const FINANCIAL_STATEMENT_APIS = {
  income: 'income_vip',
  balance_sheet: 'balancesheet_vip',
  cash_flow: 'cashflow_vip',
} as const;
export const FINANCIAL_REPORT_TYPES = ['1', '4', '5'] as const;
export const FINANCIAL_ANNOUNCEMENT_FIELDS = ['ann_date', 'f_ann_date'] as const;
export const STATEMENT_HISTORY_SNAPSHOT = 'history_snapshot';

export function statementAnnouncementWindow(period: string) {
  const [mode, startDate, endDate, extra] = period.split('/');
  if (
    mode !== 'ann_range' ||
    !isObservationDate(startDate) ||
    !isObservationDate(endDate) ||
    startDate > endDate ||
    extra !== undefined
  ) {
    return undefined;
  }

  return { startDate, endDate };
}

/** 满页窗口按自然日二分，子区间无重叠。 / Bisect saturated windows into disjoint calendar ranges. */
export function splitStatementAnnouncementWindow(startDate: string, endDate: string) {
  const dayTime = (date: string) =>
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6)));
  const midpoint = Math.floor((dayTime(endDate) - dayTime(startDate)) / (2 * 86_400_000));
  const leftEnd = calendarDay(startDate, midpoint);

  return { leftEnd, rightStart: calendarDay(leftEnd, 1) };
}

function matchesStatementAnnouncementRange(
  request: unknown,
  kind: FinancialStatementKind,
  reportType: string,
  startDate: string,
  endDate: string,
): boolean {
  request = sourceRequests(request);
  if (!Array.isArray(request)) {
    return false;
  }

  const expected: Record<string, string>[] = [];
  const visit = (start: string, end: string): boolean => {
    const params = { start_date: start, end_date: end, report_type: reportType };
    const current = request[expected.length]?.params;
    if (current?.start_date !== start || current?.end_date !== end) {
      return false;
    }
    expected.push(params);

    if (start < end && request[expected.length]?.params?.start_date === start) {
      const { leftEnd, rightStart } = splitStatementAnnouncementWindow(start, end);

      return visit(start, leftEnd) && visit(rightStart, end);
    }

    return true;
  };

  return (
    visit(startDate, endDate) &&
    expected.length === request.length &&
    statementReceiptMatchesRequests(request, kind, expected)
  );
}

/**
 * 只复用请求参数和完整字段都匹配的来源收据。
 *
 * Reuse source receipts only when their parameters and complete field selection match.
 */
export function statementReceiptMatchesRequests(
  request: unknown,
  kind: FinancialStatementKind,
  expected: readonly Record<string, string>[],
): boolean {
  request = sourceRequests(request);
  if (!Array.isArray(request)) {
    return false;
  }
  const api = FINANCIAL_STATEMENT_APIS[kind];
  const requests = request.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === 'object' && item.api === api,
  );
  const fields = financialStatementSourceFields(kind);
  const remaining = [...expected];
  for (const item of requests) {
    if (typeof item.fields !== 'string' || !item.params || typeof item.params !== 'object') {
      return false;
    }
    const selected = item.fields.split(',');
    const params = item.params;
    const index = remaining.findIndex(
      (candidate) =>
        Object.keys(params).length === Object.keys(candidate).length &&
        Object.entries(candidate).every(([key, value]) => Reflect.get(params, key) === value),
    );
    if (index < 0 || fields.some((field) => !selected.includes(field))) {
      return false;
    }
    remaining.splice(index, 1);
  }

  return requests.length > 0 && remaining.length === 0;
}

/**
 * 区分季度、证券历史与公告日期收据，防止不同时间口径互相覆盖。
 *
 * Distinguish quarter, security-history and announcement receipts so their time dimensions cannot cover each other.
 */
export function statementReceiptMatchesBatch(
  batch: {
    scope: string;
    period: string;
    rangeStart: string | null;
    rangeEnd: string | null;
    request: unknown;
  },
  allowDeferred = false,
): boolean {
  const [kind, reportType, code, ...extra] = batch.scope.split('|');
  if (
    !Object.hasOwn(FINANCIAL_STATEMENT_APIS, kind) ||
    !FINANCIAL_REPORT_TYPES.some((value) => value === reportType) ||
    extra.length
  ) {
    return false;
  }
  const statementKind = kind as FinancialStatementKind;
  if (code) {
    return (
      (batch.period === 'all' || batch.period === STATEMENT_HISTORY_SNAPSHOT) &&
      statementReceiptMatchesRequests(
        batch.request,
        statementKind,
        stockSourceCodes(code).map((ts_code) => ({ ts_code, report_type: reportType })),
      )
    );
  }

  const window = statementAnnouncementWindow(batch.period);
  if (window) {
    return (
      batch.rangeStart === window.startDate &&
      (batch.rangeEnd === window.endDate || (allowDeferred && batch.rangeEnd === null)) &&
      matchesStatementAnnouncementRange(
        batch.request,
        statementKind,
        reportType,
        window.startDate,
        window.endDate,
      )
    );
  }

  const field = FINANCIAL_ANNOUNCEMENT_FIELDS.find(
    (candidate) => batch.period === `${candidate}/${batch.rangeStart}`,
  );
  if (field) {
    return (
      isObservationDate(batch.rangeStart) &&
      (batch.rangeEnd === batch.rangeStart || (allowDeferred && batch.rangeEnd === null)) &&
      statementReceiptMatchesRequests(batch.request, statementKind, [
        { [field]: batch.rangeStart, report_type: reportType },
      ])
    );
  }

  return (
    isObservationDate(batch.period) &&
    batch.rangeStart === batch.period &&
    batch.rangeEnd === batch.period &&
    statementReceiptMatchesRequests(batch.request, statementKind, [
      { period: batch.period, report_type: reportType },
    ])
  );
}
