import { etfDownloadRange } from '../etfs/download-range.js';
import type { Prisma } from '@prisma/client';
import { MarketError } from '../errors.js';
import { DATASET_POLICIES } from './policies.js';
import { calendarDay } from './date.js';
import { contiguousCoverage } from './coverage.js';
import { getDatabase } from '#infra/database/prisma.js';

export interface InputRequirement {
  dataset: string;
  scope?: string;
  startDate: string;
  endDate: string;
}
export interface InputReadiness {
  ready: boolean;
  gaps: string[];
}

/**
 * 覆盖必须来自连续分区证据，最大观察日或非零行数都不够。
 *
 * Coverage requires contiguous partition evidence, never a max date or nonzero row count.
 */
export async function datasetInputReadiness(
  requirements: InputRequirement[],
  database: Pick<Prisma.TransactionClient, 'datasetSyncPartition' | 'tradeCal'> = getDatabase(),
): Promise<InputReadiness> {
  const gaps: string[] = [];
  const dependencies = requirements
    .filter((entry) =>
      ['stock-adjustments', 'stock-valuations', 'stock-limits'].includes(entry.dataset),
    )
    .map((entry) => ({ ...entry, dataset: 'stock-prices' }));
  for (const requirement of [...requirements, ...dependencies]) {
    const label = `${requirement.dataset}/${requirement.scope ?? 'all'}`;
    const master =
      requirement.dataset === 'stock-prices'
        ? { dataset: 'stock-master', scopes: ['L', 'D', 'P', 'G'] }
        : ['etf-prices', 'etf-adjustments'].includes(requirement.dataset)
          ? { dataset: 'etf-master', scopes: ['all'] }
          : null;
    if (master) {
      const catalogs = await database.datasetSyncPartition.findMany({
        where: {
          dataset: master.dataset,
          policyVersion: DATASET_POLICIES.find((policy) => policy.dataset === master.dataset)!
            .version,
          status: 'complete',
        },
      });
      if (master.scopes.some((scope) => !catalogs.some((entry) => entry.scope === scope))) {
        gaps.push(`${master.dataset}: listing-status inventories are not verified`);
      }
    }
    const unavailable = await database.datasetSyncPartition.findMany({
      where: {
        dataset: requirement.dataset,
        scope: requirement.scope ?? 'all',
        status: 'unavailable',
        policyVersion: DATASET_POLICIES.find((policy) => policy.dataset === requirement.dataset)
          ?.version,
        startDate: { lte: requirement.endDate },
        endDate: { gte: requirement.startDate },
      },
    });
    if (unavailable.length) {
      gaps.push(
        `${requirement.dataset}/${requirement.scope}: requested history precedes the source`,
      );
    }
    const partitions = await database.datasetSyncPartition.findMany({
      where: {
        dataset: requirement.dataset,
        scope: requirement.scope ?? 'all',
        policyVersion:
          DATASET_POLICIES.find((policy) => policy.dataset === requirement.dataset)?.version ??
          'unknown',
        startDate: { lte: requirement.endDate },
        endDate: { gte: requirement.startDate },
        status: { in: ['complete', 'not_applicable'] },
      },
      orderBy: { startDate: 'asc' },
    });
    const daily =
      DATASET_POLICIES.find((policy) => policy.dataset === requirement.dataset)?.completion ===
      'sessions';
    if (daily) {
      const calendarProof = await database.datasetSyncPartition.findMany({
        where: {
          dataset: 'calendar',
          policyVersion: DATASET_POLICIES.find((policy) => policy.dataset === 'calendar')!.version,
          scope: 'SSE',
          status: 'complete',
          startDate: { lte: requirement.endDate },
          endDate: { gte: requirement.startDate },
        },
      });
      if ((contiguousCoverage(requirement.startDate, calendarProof) ?? '') < requirement.endDate) {
        gaps.push(`${requirement.dataset}: calendar coverage is unverified`);
      }
      const sessions = await database.tradeCal.findMany({
        where: {
          exchange: 'SSE',
          isOpen: 1,
          calDate: { gte: requirement.startDate, lte: requirement.endDate },
        },
        select: { calDate: true },
      });
      for (const session of sessions) {
        if (
          !partitions.some(
            (partition) =>
              partition.startDate <= session.calDate && partition.endDate >= session.calDate,
          )
        ) {
          gaps.push(`${label}: unverified session ${session.calDate}`);
        }
      }
      continue;
    }
    let cursor = requirement.startDate;
    for (const partition of partitions) {
      if (partition.startDate > cursor) {
        break;
      }
      if (partition.endDate >= cursor) {
        cursor = calendarDay(partition.endDate, 1);
      }
    }
    if (cursor <= requirement.endDate) {
      const range = `${cursor}..${requirement.endDate}`;
      gaps.push(`${label}: unverified coverage ${range}`);
    }
  }

  return { ready: gaps.length === 0, gaps };
}

export async function marketRevision(): Promise<number> {
  return (
    (
      await getDatabase().marketDataState.findUnique({
        where: { key: 'global' },
        select: { revision: true },
      })
    )?.revision ?? 0
  );
}

/**
 * 正式消费者在自己的范围内拒绝缺输入，不把全产品关闭。
 *
 * Formal consumers reject missing inputs in their own scope without closing the product.
 */
export async function assertDatasetInputReadiness(
  requirements: InputRequirement[],
  database: Pick<Prisma.TransactionClient, 'datasetSyncPartition' | 'tradeCal'> = getDatabase(),
): Promise<void> {
  const status = await datasetInputReadiness(requirements, database);
  if (!status.ready) {
    throw new MarketError('inputs_not_ready', { details: { gaps: status.gaps } });
  }
}

/**
 * Research 和因子序列共用有效生命周期及价格／复权资格。
 *
 * Research and factor series share lifecycle and price/adjustment eligibility.
 */
export async function assertPriceSeriesReadiness(
  assetType: 'stock' | 'etf' | 'index',
  code: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  if (assetType === 'etf') {
    const row = await getDatabase().etfBasic.findUnique({ where: { tsCode: code } });
    const range = etfDownloadRange(row ?? undefined, '20150101');
    if (range.blockedReason) {
      throw new MarketError('inputs_not_ready', { details: { gaps: [range.blockedReason] } });
    }
    startDate = [startDate, range.startDate].sort().at(-1)!;
    endDate = [endDate, range.endDate ?? endDate].sort()[0];
  }
  if (startDate > endDate) {
    return;
  }

  const datasets =
    assetType === 'index' ? ['index-prices'] : [`${assetType}-prices`, `${assetType}-adjustments`];
  await assertDatasetInputReadiness(
    datasets.map((dataset) => ({
      dataset,
      scope: assetType === 'stock' ? 'all' : code,
      startDate,
      endDate,
    })),
  );
}
