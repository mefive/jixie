import type { Prisma } from '@prisma/client';
import { MarketError } from '../errors.js';
import { DATASET_POLICIES } from './policies.js';
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
  for (const requirement of requirements) {
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
    const daily = [
      'stock-prices',
      'stock-adjustments',
      'stock-valuations',
      'stock-limits',
      'etf-shares',
    ].includes(requirement.dataset);
    if (daily) {
      const calendarProof = await database.datasetSyncPartition.findMany({
        where: {
          dataset: 'calendar',
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
      if (!sessions.length) {
        gaps.push(`${requirement.dataset}: no verified session calendar`);
      }
      for (const session of sessions) {
        if (
          !partitions.some(
            (partition) =>
              partition.startDate <= session.calDate && partition.endDate >= session.calDate,
          )
        ) {
          gaps.push(
            `${requirement.dataset}/${requirement.scope ?? 'all'}: unverified session ${session.calDate}`,
          );
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
        const date = new Date(
          `${partition.endDate.slice(0, 4)}-${partition.endDate.slice(4, 6)}-${partition.endDate.slice(6)}T00:00:00Z`,
        );
        date.setUTCDate(date.getUTCDate() + 1);
        cursor = date.toISOString().slice(0, 10).replaceAll('-', '');
      }
    }
    if (cursor <= requirement.endDate) {
      gaps.push(
        `${requirement.dataset}/${requirement.scope ?? 'all'}: unverified coverage ${cursor}..${requirement.endDate}`,
      );
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
