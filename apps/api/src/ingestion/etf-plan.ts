import { createHash } from 'node:crypto';
import { getMarketDatabase } from '#infra/database/market-database.js';
import { readDownloadCodes } from '#market/downloads/lists.js';
import { etfDownloadRange } from '#market/etfs/download-range.js';
import { isObservationDate } from '#market/synchronization/date.js';
import type { IngestionUnit } from './schema.js';

const ETF_SERIES_APIS = { 'etf-prices': 'fund_daily', 'etf-adjustments': 'fund_adj' } as const;
export const ETF_CALENDARS: Readonly<Record<string, string>> = { SH: 'SSE', SZ: 'SZSE' };

function selectionScope(codes: readonly string[]) {
  return 'etfs/' + createHash('sha256').update(JSON.stringify(codes)).digest('hex');
}

function receiptMembers(scope: string, request: unknown): readonly string[] {
  if (!request || typeof request !== 'object' || !('etfCodes' in request)) {
    return [];
  }

  const members = request.etfCodes;
  if (
    !Array.isArray(members) ||
    !members.every((code): code is string => typeof code === 'string')
  ) {
    return [];
  }

  return selectionScope(members) === scope ? members : [];
}

/** 逐股收据建立历史基线；日收据只覆盖该日实际计划中的代码。
 *
 * Per-security receipts establish history. Daily receipts cover only the codes planned for that session.
 */
export async function planEtfSeries(end: string, runId?: string) {
  const database = getMarketDatabase();
  const codes = await readDownloadCodes('etf');
  const units: IngestionUnit[] = [];
  const blocked: Array<{ dataset: string; scope: string; message: string }> = [];
  if (!codes.length) {
    return { units, blocked };
  }

  const catalog = await database.etfBasic.findMany({ where: { tsCode: { in: codes } } });
  const byCode = new Map(catalog.map((row) => [row.tsCode, row]));
  const funds = codes.flatMap((code) => {
    const row = byCode.get(code);
    if (isObservationDate(row?.listDate) && row.listDate > end) {
      return [];
    }

    const range = etfDownloadRange(row, '19901219');
    if (range.blockedReason) {
      blocked.push({ dataset: 'etf-prices', scope: code, message: range.blockedReason });
      return [];
    }

    return [
      {
        code,
        start: range.startDate,
        end: range.endDate && range.endDate < end ? range.endDate : end,
        exchange: row && ETF_CALENDARS[row.exchange],
      },
    ];
  });

  for (const [dataset, api] of Object.entries(ETF_SERIES_APIS)) {
    const successful = {
      dataset,
      status: 'succeeded',
      responseComplete: true,
      rejectedCount: 0,
      ...(runId ? { runId: { not: runId } } : {}),
    };
    const histories = await database.ingestionBatch.groupBy({
      by: ['scope'],
      where: {
        ...successful,
        scope: { in: codes },
        rangeEnd: { not: null },
        OR: [{ rangeStart: { not: null } }, { sourceStart: { not: null } }],
      },
      _max: { rangeEnd: true },
    });
    const lastByCode = new Map(histories.map((row) => [row.scope, row._max.rangeEnd]));
    const earliest = histories.flatMap((row) => row._max.rangeEnd ?? []).sort()[0];

    const sessions =
      earliest && earliest < end
        ? await database.tradeCal.findMany({
            where: {
              exchange: { in: ['SSE', 'SZSE'] },
              isOpen: 1,
              calDate: { gt: earliest, lte: end },
            },
            select: { exchange: true, calDate: true },
            orderBy: { calDate: 'asc' },
          })
        : [];

    const covered = new Map<string, Set<string>>();
    if (sessions.length) {
      const receipts = await database.ingestionBatch.findMany({
        where: {
          ...successful,
          scope: { startsWith: 'etfs/' },
          rangeEnd: { gt: earliest, lte: end },
        },
        select: { scope: true, rangeStart: true, rangeEnd: true, request: true },
      });

      for (const receipt of receipts) {
        const date = receipt.rangeEnd;
        if (!date || date !== receipt.rangeStart) {
          continue;
        }

        const members = receiptMembers(receipt.scope, receipt.request);
        const saved = covered.get(date) ?? new Set<string>();
        for (const code of members) {
          saved.add(code);
        }
        covered.set(date, saved);
      }
    }

    const byDay = new Map<string, string[]>();
    for (const fund of funds) {
      const last = lastByCode.get(fund.code);

      // 旧逐股区间中的内部缺口仍由原范围收据规划器补齐。
      // The range planner still fills interior holes in the legacy per-security baseline.
      const through = last && fund.exchange && last < fund.end ? last : fund.end;
      if (fund.start <= through) {
        units.push({
          dataset,
          api,
          scope: fund.code,
          startDate: fund.start,
          endDate: through,
          period: `range/${fund.start}/${through}`,
          adaptiveRange: true,
          refresh: false,
        });
      }
      if (!last || !fund.exchange || last >= fund.end) {
        continue;
      }

      for (const { exchange, calDate } of sessions) {
        if (
          exchange !== fund.exchange ||
          calDate <= last ||
          calDate < fund.start ||
          calDate > fund.end ||
          covered.get(calDate)?.has(fund.code)
        ) {
          continue;
        }
        const members = byDay.get(calDate) ?? [];
        members.push(fund.code);
        byDay.set(calDate, members);
      }
    }

    for (const [date, members] of byDay) {
      members.sort();
      units.push({
        dataset,
        api,
        scope: selectionScope(members),
        period: date,
        startDate: date,
        endDate: date,
        etfCodes: members,
        refresh: false,
      });
    }
  }

  return { units, blocked };
}
