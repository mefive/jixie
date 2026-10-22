import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { resolve } from 'node:path';
import { z } from 'zod';

export const requirementsSchema = z.object({
  active: z.array(z.object({ config: z.unknown(), factorDependencies: z.unknown() })),
  versioned: z.array(
    z.object({ config: z.unknown(), status: z.string(), hasAccounts: z.boolean() }),
  ),
});
export type StagingRequirements = z.output<typeof requirementsSchema>;
export type MaintenanceAction = { kind: 'signals'; tradeDate: string } | { kind: 'weather' };

/**
 * 候选执行的冻结输入和进度能力，不包含正式数据库连接。
 *
 * Frozen candidate inputs and progress capabilities without a formal database client.
 */
export interface StagingContext {
  id: string;
  directory: string;
  formalUrl: string;
  timestamp: string;
  date: string;
  upperBound: string;
  requirements: StagingRequirements;
  reportProgress?: (stage: string, summary?: unknown) => Promise<void>;
}
const contexts = new AsyncLocalStorage<{ value: StagingContext; active: boolean }>();

/** 候选范围结束后拒绝遗留异步任务。 / Reject delayed work after its candidate scope completes. */
export async function withStagingContext<Result>(
  context: StagingContext,
  operation: () => Promise<Result>,
): Promise<Result> {
  const scope = { value: context, active: true };
  try {
    return await contexts.run(scope, operation);
  } finally {
    scope.active = false;
  }
}

export function getStagingContext(): StagingContext | undefined {
  const scope = contexts.getStore();
  if (scope && !scope.active) {
    throw new Error('Candidate execution scope has ended');
  }

  return scope?.value;
}

/** 冻结需求不回读正式用户表。 / Frozen requirements never query formal user tables. */
export function stagingRequirements(): StagingRequirements | null {
  return getStagingContext()?.requirements ?? null;
}

export function deferMaintenanceAction(action: MaintenanceAction): boolean {
  const context = getStagingContext();
  if (!context) {
    return false;
  }
  const descriptor = openSync(resolve(context.directory, 'actions.jsonl'), 'a', 0o600);
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
  return new Date(getStagingContext()?.timestamp ?? Date.now());
}
