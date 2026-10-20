import { openSync, writeSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { databaseFilename, isStagingDatabase } from './market-access.js';

export const requirementsSchema = z.object({
  active: z.array(z.object({ config: z.unknown(), factorDependencies: z.unknown() })),
  versioned: z.array(
    z.object({ config: z.unknown(), status: z.string(), hasAccounts: z.boolean() }),
  ),
});
export type StagingRequirements = z.output<typeof requirementsSchema>;
export type MaintenanceAction = { kind: 'signals'; tradeDate: string } | { kind: 'weather' };

/**
 * 暂存进程只接收冻结需求参数，不复制用户表或隐式回读正式库。
 *
 * Supply frozen dependency inputs without copying user tables or querying the formal database.
 */
export function stagingRequirements(): StagingRequirements | null {
  if (!isStagingDatabase()) {
    return null;
  }
  const directory = dirname(databaseFilename());

  return requirementsSchema.parse(
    JSON.parse(readFileSync(resolve(directory, 'requirements.json'), 'utf8')),
  );
}

export function deferMaintenanceAction(action: MaintenanceAction): boolean {
  if (!isStagingDatabase()) {
    return false;
  }
  const descriptor = openSync(resolve(dirname(databaseFilename()), 'actions.jsonl'), 'a', 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(action)}\n`);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }

  return true;
}

/** 默认日期绑定本轮目标，重试跨日也不扩大范围。 / Bind default dates to the original attempt across retries. */
export function stagingNow(): Date {
  if (!isStagingDatabase()) {
    return new Date();
  }
  const timestamp = z.iso.datetime().parse(process.env.JIXIE_MAINTENANCE_TIME);
  return new Date(timestamp);
}
