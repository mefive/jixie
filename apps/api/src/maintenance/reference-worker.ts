import { pathToFileURL } from 'node:url';
import { loadTushareConfig } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { syncDividend, syncFinaIndicatorVip, type ReferenceSyncSummary } from '../store/sync.js';
import { TushareClient } from '../tushare/client.js';
import { completeMaintenanceItem } from './state.js';

export type ReferenceWorkerStage = 'financials' | 'dividends';

export interface ReferenceWorkerMessage {
  type: 'reference-worker-summary';
  summary: ReferenceSyncSummary;
}

export async function runReferenceWorker(
  stage: ReferenceWorkerStage,
  checkpointRunId: string | null,
  codes: string[],
): Promise<ReferenceSyncSummary> {
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: Math.max(config.minIntervalMs, 800),
  });
  const onCodeComplete = checkpointRunId
    ? (code: string): Promise<void> => completeMaintenanceItem(checkpointRunId, stage, code)
    : undefined;

  switch (stage) {
    case 'financials':
      return syncFinaIndicatorVip(client, codes, { onPeriodComplete: onCodeComplete });
    case 'dividends':
      return syncDividend(client, codes, { refreshExisting: true, onCodeComplete });
  }
}

async function main(): Promise<void> {
  const [stageArgument, checkpointArgument, ...items] = process.argv.slice(2);
  if (stageArgument !== 'financials' && stageArgument !== 'dividends') {
    throw new Error('Reference worker stage must be financials or dividends');
  }
  if (!checkpointArgument || items.length === 0) {
    throw new Error('Reference worker requires a checkpoint argument and at least one item');
  }

  const summary = await runReferenceWorker(
    stageArgument,
    checkpointArgument === '-' ? null : checkpointArgument,
    items,
  );
  const peakMemoryMib = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(
    `[maintenance:reference-worker] ${stageArgument} batch complete; ${items.length} items; peak RSS ${peakMemoryMib} MiB`,
  );
  const message: ReferenceWorkerMessage = { type: 'reference-worker-summary', summary };
  process.send?.(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error: unknown) => {
      console.error(
        '[maintenance:reference-worker] failed:',
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
