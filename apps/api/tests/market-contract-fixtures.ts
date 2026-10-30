import { createHash } from 'node:crypto';
import type { Prisma } from '#infra/database/prisma.js';
import { calendarDay } from '#market/synchronization/date.js';
import { DATASET_POLICIES } from '#market/synchronization/policies.js';
import { prepareMarketPartition, writeMarketPartition } from '#market/synchronization/prepare.js';
import type { MarketPartition } from '#market/synchronization/partition.js';
import type { SyncSource } from '#market/synchronization/source.js';

export const capturedAt = new Date('2026-09-16T10:00:00Z');

/**
 * 正式路径夹具，仅用于隔离库。
 *
 * Formal-path fixtures, only for isolated databases.
 */
export async function proveRange(
  database: Prisma,
  partition: MarketPartition,
  version = 'sync-v2',
) {
  const id = createHash('sha256')
    .update(JSON.stringify(Object.values(partition)))
    .digest('hex');
  await database.datasetSyncPartition.upsert({
    where: { id },
    create: { id, ...partition, policyVersion: version, status: 'complete', checkedAt: capturedAt },
    update: { policyVersion: version, status: 'complete' },
  });
}

export async function proveStockCatalog(database: Prisma) {
  for (const scope of ['L', 'D', 'P', 'G']) {
    await proveRange(database, {
      dataset: 'stock-master',
      scope,
      startDate: '20260916',
      endDate: '20260916',
    });
  }
}

export async function seedSessions(database: Prisma, start: string, end = start) {
  for (let date = start; date <= end; date = calendarDay(date, 1)) {
    await database.tradeCal.upsert({
      where: { exchange_calDate: { exchange: 'SSE', calDate: date } },
      create: { exchange: 'SSE', calDate: date, isOpen: 1 },
      update: {},
    });
  }
  await proveRange(database, { dataset: 'calendar', scope: 'SSE', startDate: start, endDate: end });
}

export async function acceptSource(
  database: Prisma,
  source: SyncSource,
  partition: MarketPartition,
  fetchedAt = capturedAt,
) {
  const prepared = await prepareMarketPartition({ source }, partition, fetchedAt);
  const accepted = await database.$transaction((transaction) =>
    writeMarketPartition(transaction, prepared, partition, fetchedAt),
  );
  return { prepared, accepted };
}

export const currentPolicy = (dataset: string) =>
  DATASET_POLICIES.find((policy) => policy.dataset === dataset)!;
