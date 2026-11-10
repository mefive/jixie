import { serialize } from 'node:v8';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { PublicationPlanError } from './errors.js';
import bundledProfile from './publication-budget-profile.json' with { type: 'json' };

export interface PublicationWorkload {
  model: string;
  estimatedTableRows: number | null;
  indexCount: number;
  inserted: number;
  updated: number;
  deleted: number;
  bytes: number;
  insertedBytes: number;
  updatedBytes: number;
  deletedBytes: number;
  calls: number;
  indexMutations: number;
}

const rate = z.number().finite().nonnegative();
const profileSchema = z.object({
  version: z.literal(1),
  evidence: z.string().min(1),
  bufferPercent: rate.max(1000),
  minimumMs: z.number().int().positive(),
  commitMs: rate,
  tables: z.array(
    z.object({
      model: z.string(),
      maximumRows: z.number().int().nonnegative().nullable(),
      indexCount: z.number().int().nonnegative(),
      insertMs: rate,
      updateMs: rate,
      deleteMs: rate,
      insertByteMs: rate,
      updateByteMs: rate,
      deleteByteMs: rate,
      callMs: rate,
      indexMutationMs: rate,
    }),
  ),
});
export type PublicationBudgetProfile = z.infer<typeof profileSchema>;

/**
 * 读取并校验随代码发布的耗时基准。
 *
 * Read and validate the timing calibration bundled with the application.
 */
export function loadPublicationBudgetProfile(): PublicationBudgetProfile {
  return profileSchema.parse(bundledProfile);
}

export function estimatePublicationBudget(
  workloads: readonly PublicationWorkload[],
  profile?: PublicationBudgetProfile,
) {
  const fallback = (reason: string) => ({
    mode: 'fallback' as const,
    reason,
    timeoutMs: 30 * 60_000,
    estimatedMs: null,
    bufferPercent: null,
    evidence: profile?.evidence ?? null,
  });
  if (!profile) {
    return fallback('No calibrated publication profile');
  }
  let estimatedMs = profile.commitMs;
  for (const work of workloads) {
    if (!work.calls) {
      continue;
    }
    const rows = work.estimatedTableRows === null ? null : work.estimatedTableRows + work.inserted;
    const calibration = profile.tables
      .filter(
        (entry) =>
          entry.model === work.model &&
          entry.indexCount === work.indexCount &&
          (rows === null
            ? entry.maximumRows === null
            : entry.maximumRows === null || entry.maximumRows >= rows),
      )
      .sort((left, right) => (left.maximumRows ?? Infinity) - (right.maximumRows ?? Infinity))[0];
    if (!calibration) {
      return fallback(`No calibrated size/index bucket for ${work.model}`);
    }
    // 样本未测量的操作以零占位，不能据此推算为零耗时。
    // Zero placeholders for unmeasured operations do not imply zero execution time.
    const missingOperation = (
      [
        ['insert', work.inserted, calibration.insertMs, calibration.insertByteMs],
        ['update', work.updated, calibration.updateMs, calibration.updateByteMs],
        ['delete', work.deleted, calibration.deleteMs, calibration.deleteByteMs],
      ] as const
    ).find(
      ([, rows, rowMs, byteMs]) =>
        rows > 0 &&
        rowMs === 0 &&
        byteMs === 0 &&
        calibration.callMs === 0 &&
        calibration.indexMutationMs === 0,
    );
    if (missingOperation) {
      return fallback(`No calibrated ${missingOperation[0]} cost for ${work.model}`);
    }
    estimatedMs +=
      work.inserted * calibration.insertMs +
      work.updated * calibration.updateMs +
      work.deleted * calibration.deleteMs +
      work.insertedBytes * calibration.insertByteMs +
      work.updatedBytes * calibration.updateByteMs +
      work.deletedBytes * calibration.deleteByteMs +
      work.calls * calibration.callMs +
      work.indexMutations * calibration.indexMutationMs;
  }
  const timeoutMs = Math.ceil(
    Math.max(profile.minimumMs, estimatedMs * (1 + profile.bufferPercent / 100)),
  );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 2_147_483_647) {
    throw new PublicationPlanError('Estimated publication budget exceeds supported timer range');
  }

  return {
    mode: 'estimated' as const,
    reason: null,
    estimatedMs: Math.ceil(estimatedMs),
    timeoutMs,
    bufferPercent: profile.bufferPercent,
    evidence: profile.evidence,
  };
}

/**
 * 只读 schema／已有规划器统计，不为估时扫描业务表。
 *
 * Read schema and existing planner statistics, never scan business tables to estimate time.
 */
export async function publicationTableWorkload(database: Prisma.TransactionClient, model: string) {
  const table = model[0].toUpperCase() + model.slice(1);
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
  const indexes = await database.$queryRawUnsafe<Array<{ name: string }>>(
    `PRAGMA index_list(${quote(table)})`,
  );
  const indexedFields = new Set<string>();
  for (const index of indexes) {
    const fields = await database.$queryRawUnsafe<Array<{ name: string | null }>>(
      `PRAGMA index_info(${quote(index.name)})`,
    );
    for (const field of fields) {
      if (field.name) {
        indexedFields.add(field.name);
      }
    }
  }
  const statistics = await database.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_schema WHERE name = 'sqlite_stat1' AND type = 'table'
  `;
  let estimatedTableRows: number | null = null;
  if (statistics.length) {
    const entries = await database.$queryRawUnsafe<Array<{ stat: string }>>(
      'SELECT stat FROM sqlite_stat1 WHERE tbl = ?',
      table,
    );
    const counts = entries
      .map(({ stat }) => Number(stat.split(' ')[0]))
      .filter((count) => Number.isSafeInteger(count) && count >= 0);
    if (counts.length) {
      estimatedTableRows = Math.max(...counts);
    }
  }
  const workload: PublicationWorkload = {
    model,
    estimatedTableRows,
    indexCount: indexes.length,
    inserted: 0,
    updated: 0,
    deleted: 0,
    bytes: 0,
    insertedBytes: 0,
    updatedBytes: 0,
    deletedBytes: 0,
    calls: 0,
    indexMutations: 0,
  };

  return { workload, indexedFields };
}

export function recordPublicationWork(
  work: PublicationWorkload,
  operation: 'inserted' | 'updated' | 'deleted',
  rows: readonly Record<string, unknown>[],
) {
  if (!rows.length) {
    return;
  }
  work[operation] += rows.length;
  const bytes = serialize(rows).length;
  work.bytes += bytes;
  work[`${operation}Bytes`] += bytes;
  work.calls += operation === 'updated' ? rows.length : 1;
  if (operation !== 'updated') {
    work.indexMutations += rows.length * work.indexCount;
  }
}
