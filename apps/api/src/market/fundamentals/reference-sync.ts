import type { TradeDate } from '@jixie/shared';
import { ulid } from 'ulid';
import { prisma } from '../../infra/database/prisma.js';
import { log } from '../../infra/logging.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import { dividend, finaIndicator, finaIndicatorVip } from '../providers/tushare/api.js';
import type { TushareClient } from '../providers/tushare/client.js';
import { stockCodesWithDailyData } from '../queries/stock-codes.js';

/**
 * Sync financial indicators per stock. One call returns a stock's full period history (with
 * duplicate periods from restatements); we keep the latest annDate per (tsCode, endDate). Resumable:
 * skips stocks already synced. Financial APIs are rate-limited (~80/min), so run with a ≥800ms interval.
 * `refresh` re-pulls stocks synced before the 2026-07 column expansion (their new columns are all
 * NULL) — "already backfilled" is detected via a non-null debtToAssets on any period, which is a
 * near-universal field, so an interrupted refresh resumes instead of restarting.
 */
export async function syncFinaIndicator(
  client: TushareClient,
  codes?: string[],
  opts: {
    refresh?: boolean;
    refreshExisting?: boolean;
    onCodeComplete?: (code: string) => Promise<void> | void;
  } = {},
): Promise<ReferenceSyncSummary> {
  const all = codes ?? (await stockCodesWithDailyData());
  const existing = opts.refreshExisting
    ? []
    : await prisma.finaIndicator.findMany({
        ...(opts.refresh ? { where: { debtToAssets: { not: null } } } : {}),
        distinct: ['tsCode'],
        select: { tsCode: true },
      });
  const have = new Set(existing.map((e) => e.tsCode));
  const todo = all.filter((c) => !have.has(c));
  log(
    `syncFinaIndicator${opts.refreshExisting ? '(增量核对)' : opts.refresh ? '(扩列回填)' : ''}: 共 ${all.length} 只，跳过 ${have.size}，待处理 ${todo.length}`,
  );

  const summary: ReferenceSyncSummary = {
    requested: all.length,
    skipped: have.size,
    processed: 0,
    changed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };
  for (const code of todo) {
    const rows = await finaIndicator(client, { ts_code: code });
    // Dedup by period, keeping the latest announcement (restatements supersede earlier figures).
    const byPeriod = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const prev = byPeriod.get(r.end_date);
      if (!prev || (r.ann_date ?? '') > (prev.ann_date ?? '')) {
        byPeriod.set(r.end_date, r);
      }
    }
    const data = [...byPeriod.values()].map((r) => ({
      tsCode: canonicalStockCode(r.ts_code),
      endDate: r.end_date,
      annDate: r.ann_date,
      roe: r.roe,
      roeWaa: r.roe_waa,
      roa: r.roa,
      grossprofitMargin: r.grossprofit_margin,
      netprofitMargin: r.netprofit_margin,
      debtToAssets: r.debt_to_assets,
      orYoy: r.or_yoy,
      netprofitYoy: r.netprofit_yoy,
      ocfToProfit: r.ocf_to_profit,
    }));
    const changes = await reconcileFinaIndicator(canonicalStockCode(code), data);
    summary.processed++;
    summary.created += changes.created;
    summary.updated += changes.updated;
    if (changes.created + changes.updated > 0) {
      summary.changed++;
    }
    await opts.onCodeComplete?.(code);
    if (summary.processed % 100 === 0 || summary.processed === todo.length) {
      log(
        `  fina ${summary.processed}/${todo.length} (${code}) ${data.length} 期，变更 ${summary.changed} 只`,
      );
    }
  }
  log('syncFinaIndicator 完成');
  return summary;
}

/**
 * Sync dividend distributions per stock (raw rows across proposal→execution stages). Resumable:
 * skips stocks already synced. Same financial rate limit applies.
 */
export async function syncDividend(
  client: TushareClient,
  codes?: string[],
  options: {
    refreshExisting?: boolean;
    onCodeComplete?: (code: string) => Promise<void> | void;
  } = {},
): Promise<ReferenceSyncSummary> {
  const all = codes ?? (await stockCodesWithDailyData());
  const existing = options.refreshExisting
    ? []
    : await prisma.dividend.findMany({
        distinct: ['tsCode'],
        select: { tsCode: true },
      });
  const have = new Set(existing.map((e) => e.tsCode));
  const todo = all.filter((c) => !have.has(c));
  log(
    `syncDividend${options.refreshExisting ? '(增量核对)' : ''}: 共 ${all.length} 只，跳过 ${have.size}，待处理 ${todo.length}`,
  );

  const summary: ReferenceSyncSummary = {
    requested: all.length,
    skipped: have.size,
    processed: 0,
    changed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };
  for (const code of todo) {
    const rows = await dividend(client, { ts_code: code });
    const data = rows.map((r) => ({
      tsCode: canonicalStockCode(r.ts_code),
      endDate: r.end_date,
      annDate: r.ann_date,
      exDate: r.ex_date,
      divProc: r.div_proc,
      cashDiv: r.cash_div,
      cashDivTax: r.cash_div_tax,
    }));
    const changes = await reconcileDividend(canonicalStockCode(code), data);
    summary.processed++;
    summary.created += changes.created;
    summary.deleted += changes.deleted;
    if (changes.created + changes.deleted > 0) {
      summary.changed++;
    }
    await options.onCodeComplete?.(code);
    if (summary.processed % 100 === 0 || summary.processed === todo.length) {
      log(
        `  divi ${summary.processed}/${todo.length} (${code}) ${data.length} 行，变更 ${summary.changed} 只`,
      );
    }
  }
  log('syncDividend 完成');
  return summary;
}

export interface ReferenceSyncSummary {
  requested: number;
  skipped: number;
  processed: number;
  changed: number;
  created: number;
  updated: number;
  deleted: number;
}

export async function syncFinaIndicatorVip(
  client: TushareClient,
  periods: string[],
  options: { onPeriodComplete?: (period: string) => Promise<void> | void } = {},
): Promise<ReferenceSyncSummary> {
  const summary: ReferenceSyncSummary = {
    requested: periods.length,
    skipped: 0,
    processed: 0,
    changed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
  };

  for (const period of periods) {
    const rows = await finaIndicatorVip(client, period as TradeDate);
    if (rows.some((row) => row.end_date !== period)) {
      throw new Error(`fina_indicator_vip returned a mismatched report period for ${period}`);
    }

    const byStock = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const tsCode = canonicalStockCode(row.ts_code);
      const previous = byStock.get(tsCode);
      if (!previous || isNewerFinaIndicator(row, previous)) {
        byStock.set(tsCode, row);
      }
    }
    const source = [...byStock.values()].map(toFinaIndicatorData);
    const changes = await reconcileFinaIndicatorPeriod(period, source);
    summary.processed++;
    summary.changed += changes.changed;
    summary.created += changes.created;
    summary.updated += changes.updated;
    await options.onPeriodComplete?.(period);
    log(
      `  fina VIP ${summary.processed}/${periods.length} (${period}) ${rows.length} 行 / ${source.length} 只，变更 ${changes.changed} 只`,
    );
  }
  log('syncFinaIndicatorVip 完成');
  return summary;
}

function isNewerFinaIndicator(
  candidate: { ann_date: string | null; update_flag: string | null },
  current: { ann_date: string | null; update_flag: string | null },
): boolean {
  const announcementComparison = (candidate.ann_date ?? '').localeCompare(current.ann_date ?? '');
  return (
    announcementComparison > 0 ||
    (announcementComparison === 0 && candidate.update_flag === '1' && current.update_flag !== '1')
  );
}

function toFinaIndicatorData(row: Awaited<ReturnType<typeof finaIndicatorVip>>[number]) {
  return {
    tsCode: canonicalStockCode(row.ts_code),
    endDate: row.end_date,
    annDate: row.ann_date,
    roe: row.roe,
    roeWaa: row.roe_waa,
    roa: row.roa,
    grossprofitMargin: row.grossprofit_margin,
    netprofitMargin: row.netprofit_margin,
    debtToAssets: row.debt_to_assets,
    orYoy: row.or_yoy,
    netprofitYoy: row.netprofit_yoy,
    ocfToProfit: row.ocf_to_profit,
  };
}

async function reconcileFinaIndicatorPeriod(
  period: string,
  source: ReturnType<typeof toFinaIndicatorData>[],
): Promise<{ changed: number; created: number; updated: number }> {
  const existing = await prisma.finaIndicator.findMany({ where: { endDate: period } });
  const existingByCode = new Map(existing.map((row) => [row.tsCode, row]));
  const created = source.filter((row) => !existingByCode.has(row.tsCode));
  const updated = source.filter((row) => {
    const current = existingByCode.get(row.tsCode);
    return current != null && !sameFinaIndicator(current, row);
  });
  if (created.length === 0 && updated.length === 0) {
    return { changed: 0, created: 0, updated: 0 };
  }

  await prisma.$transaction(async (transaction) => {
    if (created.length > 0) {
      await transaction.finaIndicator.createMany({ data: created });
    }
    for (const row of updated) {
      await transaction.finaIndicator.update({
        where: { tsCode_endDate: { tsCode: row.tsCode, endDate: period } },
        data: row,
      });
    }
  });
  return {
    changed: new Set([...created, ...updated].map((row) => row.tsCode)).size,
    created: created.length,
    updated: updated.length,
  };
}

async function reconcileFinaIndicator(
  tsCode: string,
  source: Array<{
    tsCode: string;
    endDate: string;
    annDate: string | null;
    roe: number | null;
    roeWaa: number | null;
    roa: number | null;
    grossprofitMargin: number | null;
    netprofitMargin: number | null;
    debtToAssets: number | null;
    orYoy: number | null;
    netprofitYoy: number | null;
    ocfToProfit: number | null;
  }>,
): Promise<{ created: number; updated: number }> {
  const existing = await prisma.finaIndicator.findMany({ where: { tsCode } });
  const existingByPeriod = new Map(existing.map((row) => [row.endDate, row]));
  const created = source.filter((row) => !existingByPeriod.has(row.endDate));
  const updated = source.filter((row) => {
    const current = existingByPeriod.get(row.endDate);
    return current != null && !sameFinaIndicator(current, row);
  });
  if (created.length === 0 && updated.length === 0) {
    return { created: 0, updated: 0 };
  }

  await prisma.$transaction(async (transaction) => {
    if (created.length > 0) {
      await transaction.finaIndicator.createMany({ data: created });
    }
    for (const row of updated) {
      await transaction.finaIndicator.update({
        where: { tsCode_endDate: { tsCode, endDate: row.endDate } },
        data: row,
      });
    }
  });
  return { created: created.length, updated: updated.length };
}

function sameFinaIndicator(
  left: {
    annDate: string | null;
    roe: number | null;
    roeWaa: number | null;
    roa: number | null;
    grossprofitMargin: number | null;
    netprofitMargin: number | null;
    debtToAssets: number | null;
    orYoy: number | null;
    netprofitYoy: number | null;
    ocfToProfit: number | null;
  },
  right: {
    annDate: string | null;
    roe: number | null;
    roeWaa: number | null;
    roa: number | null;
    grossprofitMargin: number | null;
    netprofitMargin: number | null;
    debtToAssets: number | null;
    orYoy: number | null;
    netprofitYoy: number | null;
    ocfToProfit: number | null;
  },
): boolean {
  return (
    left.annDate === right.annDate &&
    left.roe === right.roe &&
    left.roeWaa === right.roeWaa &&
    left.roa === right.roa &&
    left.grossprofitMargin === right.grossprofitMargin &&
    left.netprofitMargin === right.netprofitMargin &&
    left.debtToAssets === right.debtToAssets &&
    left.orYoy === right.orYoy &&
    left.netprofitYoy === right.netprofitYoy &&
    left.ocfToProfit === right.ocfToProfit
  );
}

async function reconcileDividend(
  tsCode: string,
  source: Array<{
    tsCode: string;
    endDate: string;
    annDate: string | null;
    exDate: string | null;
    divProc: string | null;
    cashDiv: number | null;
    cashDivTax: number | null;
  }>,
): Promise<{ created: number; deleted: number }> {
  const existing = await prisma.dividend.findMany({
    where: { tsCode },
    select: {
      tsCode: true,
      endDate: true,
      annDate: true,
      exDate: true,
      divProc: true,
      cashDiv: true,
      cashDivTax: true,
    },
  });
  if (sameRowMultiset(existing, source)) {
    return { created: 0, deleted: 0 };
  }
  if (source.length === 0 && existing.length > 0) {
    log(`  divi ${tsCode}: provider returned no rows; preserving ${existing.length} existing rows`);
    return { created: 0, deleted: 0 };
  }

  await prisma.$transaction([
    prisma.dividend.deleteMany({ where: { tsCode } }),
    prisma.dividend.createMany({
      data: source.map((row) => ({ id: ulid(), ...row })),
    }),
  ]);
  return { created: source.length, deleted: existing.length };
}

function sameRowMultiset(left: unknown[], right: unknown[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalize = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).sort();
  const leftRows = normalize(left);
  const rightRows = normalize(right);
  return leftRows.every((row, index) => row === rightRows[index]);
}
