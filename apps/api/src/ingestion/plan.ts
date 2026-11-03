import { getDatabase } from '#infra/database/prisma.js';
import {
  calendarDay,
  isObservationDate,
  localDate,
  localHour,
} from '#market/synchronization/date.js';
import {
  STOCK_LIST_STATUSES,
  stockMarketRanges,
  confirmedMarketStart,
} from '#market/instruments/market-range.js';
import { canonicalStockCode } from '#market/instruments/stock-identity.js';
import { etfDownloadRange } from '#market/etfs/download-range.js';
import { readDownloadCodes } from '#market/downloads/lists.js';
import { INDEX_VALUATION_SUPPORTED_CODES } from '#market/registry/index-presets.js';
import {
  FINANCIAL_PERIOD_SOURCES,
  financialStockCodes,
} from '#market/fundamentals/period-catalog.js';
import type { IngestionUnit } from './schema.js';

/**
 * 使用来源可提供的交易所日历范围；不为历史缺失补造日期。
 *
 * Use available exchange-calendar history without fabricating dates for missing history.
 */
export const CALENDAR_ORIGINS = { SSE: '19901219', SZSE: '19910703', BSE: '20211115' } as const;
const ETF_CALENDARS: Readonly<Record<string, string>> = { SH: 'SSE', SZ: 'SZSE' };

export interface IngestionPlan {
  units: IngestionUnit[];
  blocked: Array<{ dataset: string; scope: string; message: string }>;
}

export function referenceUnits(targetDate: string, startedAt: Date): IngestionUnit[] {
  const capturedDate = localDate(startedAt);
  const calendarEnd = calendarDay([targetDate, capturedDate].sort().at(-1)!, 31);
  const units: IngestionUnit[] = [];
  for (const [scope, origin] of Object.entries(CALENDAR_ORIGINS)) {
    for (const range of yearRanges(origin, calendarEnd)) {
      units.push({
        dataset: 'calendar',
        scope,
        ...range,
        api: 'trade_cal',
        refresh: range.period >= capturedDate.slice(0, 4),
      });
    }
  }
  for (const scope of STOCK_LIST_STATUSES) {
    units.push({
      dataset: 'stock-master',
      scope,
      period: 'snapshot',
      startDate: capturedDate,
      endDate: capturedDate,
      api: 'stock_basic',
      refresh: true,
    });
  }
  units.push({
    dataset: 'etf-master',
    scope: 'all',
    period: 'snapshot',
    startDate: capturedDate,
    endDate: targetDate,
    api: 'etf_basic',
    refresh: true,
  });

  return units;
}

/**
 * 每个历史开市日独立选取 Top N，收据按日期恢复；不借用其他交易所日历。
 *
 * Select a top N for every historical session with dated recovery receipts and venue calendars.
 */
export async function planEtfSelections(
  targetDate: string,
  startedAt: Date,
): Promise<IngestionUnit[]> {
  const database = getDatabase();
  const end = ingestionEnd(targetDate, startedAt);
  const catalog = await database.etfBasic.findMany({
    where: { listDate: { lte: end }, listStatus: { in: ['L', 'D'] } },
    select: { exchange: true, listDate: true },
  });
  const origins = new Map<string, string>();
  for (const row of catalog) {
    const exchange = ETF_CALENDARS[row.exchange];
    if (!exchange || !isObservationDate(row.listDate)) {
      continue;
    }
    const previous = origins.get(exchange);
    if (!previous || row.listDate < previous) {
      origins.set(exchange, row.listDate);
    }
  }
  if (!origins.size) {
    return [];
  }
  const sessions = await database.tradeCal.findMany({
    where: {
      isOpen: 1,
      OR: [...origins].map(([exchange, start]) => ({
        exchange,
        calDate: { gte: start, lte: end },
      })),
    },
    orderBy: { calDate: 'asc' },
    select: { exchange: true, calDate: true },
  });
  const dates = new Map<string, string[]>();
  for (const session of sessions) {
    const exchanges = dates.get(session.calDate) ?? [];
    exchanges.push(session.exchange);
    dates.set(session.calDate, exchanges);
  }

  return [...dates].map(([date, exchanges]) => {
    exchanges.sort();

    return {
      dataset: 'etf-selection',
      scope: `top-100/${exchanges.join(',')}`,
      period: date,
      startDate: date,
      endDate: date,
      exchanges,
      api: 'etf_share_size',
      refresh: false,
    };
  });
}

/**
 * 按自然范围生成稳定单元；阶段计划保存在 Run 快照，执行尝试才创建批次记录。
 *
 * Build stable natural-range units; freeze phase plans in the run and create batch rows only on attempts.
 */
export async function planIngestion(
  targetDate: string,
  startedAt: Date,
  financialPeriods: Record<string, string[]> = {},
): Promise<IngestionPlan> {
  const database = getDatabase();
  const today = localDate(startedAt);
  const end = ingestionEnd(targetDate, startedAt);
  const stocks = await database.stockBasic.findMany();
  const ranges = stockMarketRanges(stocks);
  const blocked: IngestionPlan['blocked'] = [];
  const streams: IngestionUnit[][] = [];
  const marketStarts = new Map<string, string>();
  const stockStarts = [...ranges.entries()].flatMap(([code, range]) => {
    if (range.startDate && range.startDate > end) {
      return [];
    }
    if (
      !range.startDate ||
      range.uncertain ||
      !['SSE', 'SZSE', 'BSE'].includes(range.exchange ?? '')
    ) {
      blocked.push({
        dataset: 'stock-prices',
        scope: code,
        message: 'Stock market-entry dates are not known',
      });
      return [];
    }
    const admission = confirmedMarketStart(code, range.exchange)?.date;

    const startDate = [range.startDate, admission ?? range.startDate].sort().at(-1)!;
    const exchange = range.exchange!;
    const previous = marketStarts.get(exchange);
    marketStarts.set(exchange, previous && previous < startDate ? previous : startDate);

    return [startDate];
  });
  const stockStart = stockStarts.sort()[0];
  const calendarRows = stockStart
    ? await database.tradeCal.findMany({
        where: {
          exchange: { in: [...marketStarts.keys()] },
          isOpen: 1,
          calDate: { gte: stockStart, lte: end },
        },
        orderBy: [{ calDate: 'asc' }, { exchange: 'asc' }],
        select: { exchange: true, calDate: true },
      })
    : [];
  const sessions = new Map<string, string[]>();
  for (const row of calendarRows) {
    if (row.calDate < marketStarts.get(row.exchange)!) {
      continue;
    }
    const exchanges = sessions.get(row.calDate) ?? [];
    exchanges.push(row.exchange);
    sessions.set(row.calDate, exchanges);
  }
  for (const [dataset, api] of Object.entries({
    'stock-prices': 'daily',
    'stock-adjustments': 'adj_factor',
    'stock-valuations': 'daily_basic',
    'stock-limits': 'stk_limit',
  })) {
    streams.push(
      alternate(
        [...sessions].map(([calDate, exchanges]) => ({
          dataset,
          scope: exchanges.join(','),
          exchanges,
          period: calDate,
          startDate: calDate,
          endDate: calDate,
          api,
          refresh: false,
        })),
      ),
    );
  }
  const etfs = await readDownloadCodes('etf');
  for (const code of etfs) {
    const row = await database.etfBasic.findUnique({ where: { tsCode: code } });
    if (isObservationDate(row?.listDate) && row.listDate > end) {
      continue;
    }
    const range = etfDownloadRange(row ?? undefined, CALENDAR_ORIGINS.SSE);
    if (range.blockedReason) {
      blocked.push({ dataset: 'etf-prices', scope: code, message: range.blockedReason });
      continue;
    }
    const through = [end, range.endDate ?? end].sort()[0];
    for (const [dataset, api] of Object.entries({
      'etf-prices': 'fund_daily',
      'etf-adjustments': 'fund_adj',
    })) {
      streams.push(
        alternate(
          yearRanges(range.startDate, through).map((dates) => ({
            dataset,
            scope: code,
            ...dates,
            api,
            refresh: false,
          })),
        ),
      );
    }
  }
  for (const code of await readDownloadCodes('index')) {
    const datasets = [{ dataset: 'index-prices', api: 'index_daily' }];
    if (INDEX_VALUATION_SUPPORTED_CODES.includes(code)) {
      datasets.push({ dataset: 'index-valuations', api: 'index_dailybasic' });
    }
    for (const entry of datasets) {
      const earliest = await database.ingestionBatch.findFirst({
        where: {
          dataset: entry.dataset,
          scope: code,
          period: 'history',
          status: 'succeeded',
          sourceStart: { not: null },
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { sourceStart: true },
      });
      if (earliest?.sourceStart) {
        streams.push(
          alternate(
            yearRanges(earliest.sourceStart, end).map((dates) => ({
              ...entry,
              scope: code,
              ...dates,
              refresh: false,
            })),
          ),
        );
      } else {
        streams.push([
          {
            ...entry,
            scope: code,
            period: 'history',
            fullHistory: true,
            startDate: '',
            endDate: end,
            refresh: false,
          },
        ]);
      }
    }
    if (code !== 'H00300.CSI') {
      streams.push(
        alternate(
          monthRanges(CALENDAR_ORIGINS.SSE, end).map((dates) => ({
            dataset: 'index-weights',
            scope: code,
            ...dates,
            api: 'index_weight',
            refresh: false,
          })),
        ),
      );
    }
  }
  streams.push(
    alternate(
      yearRanges(CALENDAR_ORIGINS.SSE, targetDate).map((dates) => ({
        dataset: 'stock-names',
        scope: 'all',
        ...dates,
        api: 'namechange',
        refresh: true,
      })),
    ),
  );
  const financialEnd = [targetDate, calendarDay(today, -1)].sort()[0];
  const codes = [...new Set(stocks.map((row) => canonicalStockCode(row.tsCode)))]
    .filter((code) => {
      const start = ranges.get(code)?.startDate;

      return !start || start <= financialEnd;
    })
    .sort();
  streams.push(financialUnits(targetDate, startedAt, financialPeriods));
  streams.push(
    codes.map((scope) => ({
      dataset: 'dividends',
      scope,
      period: 'all',
      fullHistory: true,
      startDate: '',
      endDate: targetDate,
      api: 'dividend',
      refresh: true,
    })),
  );
  const units: IngestionUnit[] = [];
  const maximum = Math.max(0, ...streams.map((stream) => stream.length));
  for (let index = 0; index < maximum; index++) {
    for (const stream of streams) {
      if (stream[index]) {
        units.push(stream[index]);
      }
    }
  }

  return { units, blocked };
}

/**
 * 来源目录保存实际报告期，包括上市前及非标准季末；每期保持独立重试。
 *
 * Plan actual source periods, including pre-IPO and nonstandard dates, with independent retries.
 */
export function financialUnits(
  targetDate: string,
  startedAt: Date,
  periods: Record<string, string[]>,
): IngestionUnit[] {
  const end = [targetDate, calendarDay(localDate(startedAt), -1)].sort()[0];

  return FINANCIAL_PERIOD_SOURCES.flatMap((definition) =>
    (periods[definition.scope] ?? [])
      .filter((period) => period <= end)
      .map((period) => ({
        dataset: definition.dataset,
        scope: definition.scope,
        period,
        startDate: period,
        endDate: period,
        catalogThrough: end,
        api: definition.api,
        refresh: true,
      })),
  );
}

/**
 * 每轮完整发现来源报告期；恢复时复用本轮成功目录与固定范围。
 *
 * Discover complete source periods once per run and reuse successful catalogs on recovery.
 */
export async function financialCatalogUnits(
  targetDate: string,
  startedAt: Date,
): Promise<IngestionUnit[]> {
  const end = [targetDate, calendarDay(localDate(startedAt), -1)].sort()[0];
  if (!(await financialStockCodes(end)).size) {
    return [];
  }

  return FINANCIAL_PERIOD_SOURCES.map((definition) => ({
    dataset: 'financial-periods',
    scope: definition.scope,
    period: 'history',
    startDate: '',
    endDate: end,
    api: definition.api,
    refresh: true,
    fullHistory: true,
  }));
}

function ingestionEnd(targetDate: string, startedAt: Date): string {
  const today = localDate(startedAt);
  const closed = localHour(startedAt, 'Asia/Shanghai') >= 16 ? today : calendarDay(today, -1);

  return [targetDate, closed].sort()[0];
}

function alternate<Value>(values: Value[]): Value[] {
  const ordered: Value[] = [];
  for (let left = 0, right = values.length - 1; left <= right; left++, right--) {
    ordered.push(values[right]);
    if (left < right) {
      ordered.push(values[left]);
    }
  }

  return ordered;
}

function yearRanges(start: string, end: string) {
  if (start > end) {
    return [];
  }
  const ranges: Array<{ period: string; startDate: string; endDate: string }> = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++) {
    ranges.push({
      period: String(year),
      startDate: [start, `${year}0101`].sort().at(-1)!,
      endDate: [end, `${year}1231`].sort()[0],
    });
  }

  return ranges;
}

function monthRanges(start: string, end: string) {
  const ranges: Array<{ period: string; startDate: string; endDate: string }> = [];
  for (let cursor = `${start.slice(0, 6)}01`; cursor <= end; ) {
    const year = Number(cursor.slice(0, 4));
    const month = Number(cursor.slice(4, 6));
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10).replaceAll('-', '');
    ranges.push({
      period: cursor.slice(0, 6),
      startDate: [cursor, start].sort().at(-1)!,
      endDate: [last, end].sort()[0],
    });
    cursor = calendarDay(last, 1);
  }

  return ranges;
}
