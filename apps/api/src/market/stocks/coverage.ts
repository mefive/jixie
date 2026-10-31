import { getDatabase } from '#infra/database/prisma.js';
import {
  STOCK_LIST_STATUSES,
  stockMarketMembership,
  type StockMarketRange,
} from '../instruments/market-range.js';
import { canonicalStockCode } from '../instruments/stock-identity.js';
import type { MarketPartition, PreparedMarketPartition } from '../synchronization/partition.js';

/**
 * 范围判断与入库共用，停牌只接受当日证据；当前 P 状态没有历史起止日期。
 *
 * Share ingestion membership and require dated suspensions; current P status has no past interval.
 * Source contracts: https://tushare.pro/document/2?doc_id=25 and doc_id=214.
 */
export async function stockPartitionCoverage(
  partition: MarketPartition,
  prepared: PreparedMarketPartition,
  ranges: ReadonlyMap<string, StockMarketRange>,
): Promise<string[]> {
  const database = getDatabase();
  const codes = new Set(
    prepared.tables.flatMap((table) => table.records.map((row) => String(row.values.tsCode))),
  );
  const membership = new Map(
    [...new Set([...ranges.keys(), ...codes])].map((code) => [
      code,
      stockMarketMembership(code, partition.startDate, ranges),
    ]),
  );
  const outside = [...codes].filter((code) => membership.get(code) === 'outside');
  const unknown = [...codes].filter((code) => membership.get(code) === 'unknown');
  const gaps: string[] = [];
  if (outside.length) {
    gaps.push(`Outside market interval: ${outside.join(', ')}`);
  }
  if (unknown.length) {
    gaps.push(`Unverified market intervals: ${unknown.join(', ')}`);
  }

  if (partition.dataset !== 'stock-prices') {
    const priceProof = await database.datasetSyncPartition.findFirst({
      where: {
        dataset: 'stock-prices',
        scope: 'all',
        startDate: partition.startDate,
        endDate: partition.endDate,
        status: 'complete',
      },
    });
    const prices = await database.daily.findMany({
      where: { tradeDate: partition.startDate },
      select: { tsCode: true },
    });
    const traded = prices.filter(
      (row) => stockMarketMembership(row.tsCode, partition.startDate, ranges) !== 'outside',
    );
    const missingTrade = traded.some((row) => !codes.has(canonicalStockCode(row.tsCode)));
    if (!priceProof || !traded.length || missingTrade) {
      gaps.push('Same-day verified traded-security coverage is incomplete');
    }

    return gaps;
  }

  const masters = await database.datasetSyncPartition.findMany({
    where: { dataset: 'stock-master', status: 'complete' },
    select: { scope: true },
  });
  if (STOCK_LIST_STATUSES.some((scope) => !masters.some((row) => row.scope === scope))) {
    gaps.push('Listing-status inventories are not verified');
  }
  if (prepared.checks.suspensionsVerified !== true) {
    gaps.push('Full-day suspension evidence is unavailable');
  }
  if (!ranges.size) {
    gaps.push('Historical listing intervals are unknown');
  }

  const suspended = new Set(prepared.checks.fullDaySuspended ?? []);
  const missing: string[] = [];
  const unverified: string[] = [];
  for (const [code, range] of ranges) {
    if (membership.get(code) === 'outside' || codes.has(code)) {
      continue;
    }
    if (membership.get(code) === 'unknown') {
      unverified.push(code);
    } else if (suspended.has(code)) {
      continue;
    } else if (range.listStatus === 'P') {
      unverified.push(code);
    } else {
      missing.push(code);
    }
  }
  const contradictions = [...codes].filter((code) => suspended.has(code));
  if (missing.length) {
    gaps.push(`Missing stock prices without suspension evidence: ${missing.join(', ')}`);
  }
  if (unverified.length) {
    gaps.push(
      `Historical listing or suspension intervals are unverified: ${unverified.join(', ')}`,
    );
  }
  if (contradictions.length) {
    gaps.push(`Conflicting full-day suspension evidence: ${contradictions.join(', ')}`);
  }

  return gaps;
}
