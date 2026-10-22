import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { getDatabase } from '#infra/database/prisma.js';
import { addDays } from '#date';
import { allMarketIndicatorScope, type DerivedMarketScope } from '#market/state/scope.js';
import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '#market/registry/index-presets.js';
import { marketChangeSchema, type MarketChange, type TableChanges } from './changes.js';

export interface DerivedImpactRange {
  startDate: string;
  endDate: string;
  scope: DerivedMarketScope;
}

const INPUT_FIELDS: Record<string, readonly string[]> = {
  Daily: ['tsCode', 'tradeDate', 'close', 'pctChg', 'amount'],
  AdjFactor: ['tsCode', 'tradeDate', 'adjFactor'],
  DailyBasic: ['tsCode', 'tradeDate', 'circMv', 'turnoverRateF', 'turnoverRate', 'peTtm', 'pb'],
  StkLimit: ['tsCode', 'tradeDate', 'upLimit', 'downLimit'],
  IndexDaily: ['tsCode', 'tradeDate', 'close'],
  IndexWeight: ['indexCode', 'conCode', 'tradeDate', 'weight'],
  SwIndustryMember: ['tsCode', 'l1Code', 'l1Name', 'inDate', 'outDate'],
  TradeCal: ['exchange', 'calDate', 'isOpen'],
};

/**
 * 只按计算 SQL 实际读取的字段判断变化；名称、代码映射及行情非输入字段不使指标失效。
 *
 * Invalidate only fields read by indicator SQL, excluding reference-only and unused bar fields.
 */
export function affectsIndicators(table: string, change: MarketChange): boolean {
  const fields = INPUT_FIELDS[table];
  if (!fields) {
    return false;
  }
  if (change.operation !== 'update') {
    return true;
  }
  if (!change.before) {
    throw new Error(`Missing baseline values for ${table}`);
  }

  return fields.some((field) => change.before![field] !== change.row[field]);
}

/**
 * 将冻结增删改转换为有界输出区间；预热读取不增加输出日期。
 *
 * Convert frozen changes into bounded output ranges without treating warmup reads as writes.
 */
export async function planDerivedImpact(
  directory: string,
  changes: TableChanges[],
  outputDates: string[],
  requiredDates: string[],
): Promise<DerivedImpactRange[]> {
  const dates = [...new Set([...outputDates, ...requiredDates])].sort();
  if (!dates.length) {
    return [];
  }
  const last = dates.at(-1)!;
  const scopes = new Map<string, DerivedMarketScope>();
  const add = (start: string, end: string, scope = allMarketIndicatorScope()) => {
    let low = 0;
    let high = dates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (dates[middle] < start) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    for (let index = low; index < dates.length && dates[index] <= end; index++) {
      const date = dates[index];
      const current = scopes.get(date) ?? { market: false, industries: false, indexCodes: [] };
      current.market ||= scope.market;
      current.industries ||= scope.industries;
      current.indexCodes = [...new Set([...current.indexCodes, ...scope.indexCodes])].sort();
      scopes.set(date, current);
    }
  };
  for (const date of requiredDates) {
    add(date, date);
  }

  const stockChanges = new Map<string, { daily: MarketChange[]; factors: MarketChange[] }>();
  const indexPrices = new Map<string, MarketChange[]>();
  const memberships = new Map<string, Set<string>>();
  const industries = new Map<string, MarketChange[]>();
  const directDates = new Set<string>();
  for (const entry of changes) {
    if (!INPUT_FIELDS[entry.table] || entry.count === 0) {
      continue;
    }
    const lines = createInterface({
      input: createReadStream(resolve(directory, `${entry.table}.changes`)),
      crlfDelay: Infinity,
    });
    try {
      for await (const line of lines) {
        const change = marketChangeSchema.parse(JSON.parse(line));
        if (!affectsIndicators(entry.table, change)) {
          continue;
        }
        const row = change.row;
        const tradeDate = String(row.tradeDate);
        const code = String(row.tsCode);
        switch (entry.table) {
          case 'Daily':
          case 'AdjFactor': {
            directDates.add(tradeDate);
            if (
              entry.table === 'Daily' &&
              change.operation === 'update' &&
              change.before?.close === row.close
            ) {
              break;
            }
            const group = stockChanges.get(code) ?? { daily: [], factors: [] };
            group[entry.table === 'Daily' ? 'daily' : 'factors'].push(change);
            stockChanges.set(code, group);
            break;
          }
          case 'DailyBasic':
          case 'StkLimit':
            directDates.add(tradeDate);
            break;
          case 'IndexDaily': {
            if (!MARKET_WEATHER_INDICATOR_INDEX_CODES.includes(code)) {
              break;
            }
            const group = indexPrices.get(code) ?? [];
            group.push(change);
            indexPrices.set(code, group);
            break;
          }
          case 'IndexWeight': {
            const indexCode = String(row.indexCode);
            if (!MARKET_WEATHER_INDICATOR_INDEX_CODES.includes(indexCode)) {
              break;
            }
            const group = memberships.get(indexCode) ?? new Set<string>();
            group.add(tradeDate);
            memberships.set(indexCode, group);
            break;
          }
          case 'SwIndustryMember': {
            const group = industries.get(code) ?? [];
            group.push(change);
            industries.set(code, group);
            break;
          }
          case 'TradeCal': {
            if (row.exchange !== 'SSE') {
              break;
            }
            const date = String(row.calDate);
            // 日历决定 SQL 预热起点，开闭市修订影响之后最多 60 个开市日。
            // Calendar revisions can change SQL warmup boundaries for the following 60 sessions.
            const following = dates.filter((value) => value >= date).slice(0, 61);
            add(date, following.at(-1) ?? date);
            break;
          }
        }
      }
    } finally {
      lines.close();
    }
  }
  for (const date of directDates) {
    add(date, date);
  }

  for (const [code, group] of stockChanges) {
    const changedDates = [...group.daily, ...group.factors]
      .map((change) => String(change.row.tradeDate))
      .sort();
    const start = changedDates[0];
    if (start > last) {
      continue;
    }
    // 已纳入完整重算的目标尾段无需逐证券再次读取窗口；历史修订仍逐项传播。
    // A fully scheduled output tail needs no additional per-stock window reads.
    if (
      dates
        .filter((date) => date >= start)
        .every((date) => {
          const scope = scopes.get(date);

          return (
            scope?.market &&
            scope.industries &&
            scope.indexCodes.length === MARKET_WEATHER_INDICATOR_INDEX_CODES.length
          );
        })
    ) {
      continue;
    }
    const [bars, factors] = await Promise.all([
      getDatabase().daily.findMany({
        where: { tsCode: code, tradeDate: { gte: start, lte: last } },
        select: { tradeDate: true, close: true },
      }),
      getDatabase().adjFactor.findMany({
        where: { tsCode: code, tradeDate: { gte: start, lte: last } },
        select: { tradeDate: true },
      }),
    ]);
    const afterBars = new Map(bars.map((row) => [row.tradeDate, row.close]));
    const beforeBars = new Map(afterBars);
    const afterFactors = new Set(factors.map((row) => row.tradeDate));
    const beforeFactors = new Set(afterFactors);
    for (const change of group.daily) {
      const date = String(change.row.tradeDate);
      if (change.operation === 'insert') {
        beforeBars.delete(date);
      } else {
        beforeBars.set(date, (change.before ?? change.row).close as number | null);
      }
    }
    for (const change of group.factors) {
      const date = String(change.row.tradeDate);
      if (change.operation === 'insert') {
        beforeFactors.delete(date);
      } else {
        beforeFactors.add(date);
      }
    }
    const before = [...beforeBars]
      .filter(([date, close]) => close != null && beforeFactors.has(date))
      .map(([date]) => date)
      .sort();
    const after = [...afterBars]
      .filter(([date, close]) => close != null && afterFactors.has(date))
      .map(([date]) => date)
      .sort();
    for (const date of new Set(changedDates)) {
      add(date, rollingEnd(date, before, after, 59));
    }
  }

  for (const [code, group] of indexPrices) {
    const changedDates = group.map((change) => String(change.row.tradeDate)).sort();
    const rows = await getDatabase().indexDaily.findMany({
      where: { tsCode: code, tradeDate: { gte: changedDates[0], lte: last } },
      select: { tradeDate: true },
    });
    const after = rows.map((row) => row.tradeDate).sort();
    const before = new Set(after);
    for (const change of group) {
      const date = String(change.row.tradeDate);
      if (change.operation === 'insert') {
        before.delete(date);
      } else {
        before.add(date);
      }
    }
    for (const date of new Set(changedDates)) {
      add(date, rollingEnd(date, [...before].sort(), after, 20), {
        market: false,
        industries: false,
        indexCodes: [code],
      });
    }
  }

  for (const [code, changedDates] of memberships) {
    const snapshots = await getDatabase().indexWeight.groupBy({
      where: { indexCode: code },
      by: ['tradeDate'],
      orderBy: { tradeDate: 'asc' },
    });
    for (const date of changedDates) {
      const next = snapshots.find((snapshot) => snapshot.tradeDate > date)?.tradeDate;
      add(date, next ? addDays(next, -1) : last, {
        market: false,
        industries: false,
        indexCodes: [code],
      });
    }
  }

  for (const [code, group] of industries) {
    const after = await getDatabase().swIndustryMember.findMany({
      where: { tsCode: code },
      select: { tsCode: true, l1Code: true, l1Name: true, inDate: true, outDate: true },
    });
    type Membership = (typeof after)[number];
    const key = (row: Membership) => `${row.l1Code}|${row.inDate}`;
    const before = new Map(after.map((row) => [key(row), row]));
    for (const change of group) {
      const row = change.row as unknown as Membership;
      if (change.operation === 'insert') {
        before.delete(key(row));
      } else {
        const old = (change.before ?? change.row) as unknown as Membership;
        before.set(key(old), old);
      }
    }
    const selected = (rows: Membership[], date: string) => {
      const member = rows
        .filter((row) => row.inDate <= date && (!row.outDate || date < row.outDate))
        .sort((left, right) =>
          left.inDate === right.inDate
            ? left.l1Code < right.l1Code
              ? 1
              : left.l1Code > right.l1Code
                ? -1
                : 0
            : left.inDate < right.inDate
              ? 1
              : -1,
        )[0];

      return member ? `${member.l1Code}|${member.l1Name}` : null;
    };
    const previous = [...before.values()];
    for (const date of dates) {
      if (selected(previous, date) !== selected(after, date)) {
        add(date, date, { market: false, industries: true, indexCodes: [] });
      }
    }
  }

  const result: DerivedImpactRange[] = [];
  let precedingDate: string | undefined;
  for (const date of dates) {
    const scope = scopes.get(date);
    if (scope) {
      const previous = result.at(-1);
      if (
        previous &&
        previous.endDate === precedingDate &&
        JSON.stringify(previous.scope) === JSON.stringify(scope)
      ) {
        previous.endDate = date;
      } else {
        result.push({ startDate: date, endDate: date, scope });
      }
    }
    precedingDate = date;
  }

  return result;
}

/** 前后观察序列取并集，删除也必须修正后续窗口。 / Include both observation sequences when propagating deletions. */
export function rollingEnd(
  date: string,
  before: string[],
  after: string[],
  following: number,
): string {
  return [
    date,
    before
      .filter((value) => value > date)
      .slice(0, following)
      .at(-1),
    after
      .filter((value) => value > date)
      .slice(0, following)
      .at(-1),
  ]
    .filter((value): value is string => !!value)
    .sort()
    .at(-1)!;
}
