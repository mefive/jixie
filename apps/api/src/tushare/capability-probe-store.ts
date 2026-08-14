import { type PrismaClient } from '@prisma/client';
import { ulid } from 'ulid';
import { prisma } from '../lib/prisma.js';
import type { AssetAllocationProbeResult } from './asset-allocation-probe.js';

export interface StoredTushareCapabilityProbe {
  catalogVersion: number;
  apiName: string;
  domain: string;
  probeDate: string;
  status: AssetAllocationProbeResult['status'];
  rowCount: number;
  fields: string[];
  history?: {
    field: string;
    start: string;
    end: string;
    coverage: string;
  };
  errorCode?: number;
  errorMessage?: string;
  probedAt: Date;
}

export async function persistTushareCapabilityProbes(
  results: AssetAllocationProbeResult[],
  probeDate: string,
  probedAt: Date = new Date(),
  database: PrismaClient = prisma,
): Promise<number> {
  const persisted = await database.tushareCapabilityProbe.createMany({
    data: results.map((result) => ({
      id: ulid(),
      catalogVersion: result.catalogVersion,
      apiName: result.apiName,
      domain: result.domain,
      probeDate,
      status: result.status,
      rowCount: result.rowCount,
      fields: result.fields,
      historyField: result.history?.field,
      historyStart: result.history?.start,
      historyEnd: result.history?.end,
      probeCoverage: result.history?.coverage,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      probedAt,
    })),
  });
  return persisted.count;
}

export async function latestTushareCapabilityProbes(
  apiNames: string[],
  database: PrismaClient = prisma,
): Promise<Map<string, StoredTushareCapabilityProbe>> {
  if (apiNames.length === 0) {
    return new Map();
  }
  const latestTimes = await database.tushareCapabilityProbe.groupBy({
    by: ['apiName'],
    where: { apiName: { in: apiNames } },
    _max: { probedAt: true },
  });
  const rows = await database.tushareCapabilityProbe.findMany({
    where: {
      OR: latestTimes.flatMap((entry) =>
        entry._max.probedAt ? [{ apiName: entry.apiName, probedAt: entry._max.probedAt }] : [],
      ),
    },
    orderBy: { probedAt: 'desc' },
  });
  const latest = new Map<string, StoredTushareCapabilityProbe>();
  for (const row of rows) {
    if (latest.has(row.apiName)) {
      continue;
    }
    latest.set(row.apiName, {
      catalogVersion: row.catalogVersion,
      apiName: row.apiName,
      domain: row.domain,
      probeDate: row.probeDate,
      status: row.status as AssetAllocationProbeResult['status'],
      rowCount: row.rowCount,
      fields: row.fields as string[],
      ...(row.historyField && row.historyStart && row.historyEnd && row.probeCoverage
        ? {
            history: {
              field: row.historyField,
              start: row.historyStart,
              end: row.historyEnd,
              coverage: row.probeCoverage,
            },
          }
        : {}),
      ...(row.errorCode !== null ? { errorCode: row.errorCode } : {}),
      ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
      probedAt: row.probedAt,
    });
  }
  return latest;
}

export async function tushareCapabilityProbesAreFresh(
  apiNames: string[],
  maxAgeDays: number,
  now: Date = new Date(),
  database: PrismaClient = prisma,
): Promise<boolean> {
  const latest = await latestTushareCapabilityProbes(apiNames, database);
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1_000;
  return apiNames.every((apiName) => (latest.get(apiName)?.probedAt.getTime() ?? 0) >= cutoff);
}
