import { assertMaintenanceOwner, isStagingDatabase } from '#infra/coordination/market-access.js';

/**
 * 数据准备必须在候选中执行；正式发布由协调器通过 P/R 句柄排空业务。
 *
 * Prepare data only in a candidate; the coordinator drains formal work through P/R descriptors.
 */
export async function waitForRunningWork(_onLog: (line: string) => void): Promise<void> {
  if (!isStagingDatabase()) {
    throw new Error('Formal draining requires the publication coordinator');
  }
}

export function assertProductionLock(): void {
  if (isStagingDatabase()) {
    return;
  }
  assertMaintenanceOwner();
  throw new Error('Market workflows must run in an isolated maintenance candidate');
}
