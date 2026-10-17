import { prisma } from '#infra/database/prisma.js';
import { pathToFileURL } from 'node:url';
import { TushareClient } from '../providers/tushare/tushare-client.js';
import { loadTushareConfig } from '../providers/tushare/config.js';
import { syncDividend, syncFinaIndicatorVip, type ReferenceSyncSummary } from './reference-sync.js';
import type {
  ReferenceWorkerAcknowledgement,
  ReferenceWorkerStage,
} from './reference-worker-protocol.js';
import { syncFinancialStatementsVip } from './sync.js';

/**
 * 按阶段执行财务参考同步，逐项等待父进程确认后继续。
 * Execute financial reference stages and await parent acknowledgement for each completed item.
 */
export async function runReferenceWorker(
  stage: ReferenceWorkerStage,
  codes: string[],
  onItemComplete?: (item: string) => Promise<void>,
): Promise<ReferenceSyncSummary> {
  const config = loadTushareConfig();
  const client = new TushareClient({
    token: config.token,
    baseUrl: config.baseUrl,
    minIntervalMs: Math.max(config.minIntervalMs, 800),
  });

  switch (stage) {
    case 'financial_statements':
      return syncFinancialStatementsVip(client, codes, { onPeriodComplete: onItemComplete });
    case 'financials':
      return syncFinaIndicatorVip(client, codes, { onPeriodComplete: onItemComplete });
    case 'dividends':
      return syncDividend(client, codes, { refreshExisting: true, onCodeComplete: onItemComplete });
  }
}

/**
 * 解析财报 Worker 启动参数并接入父进程协议，统一收尾。
 * Parse financial worker startup and connect the parent protocol with resource cleanup.
 */
async function main(): Promise<void> {
  const [stageArgument, ...items] = process.argv.slice(2);
  if (
    stageArgument !== 'financial_statements' &&
    stageArgument !== 'financials' &&
    stageArgument !== 'dividends'
  ) {
    throw new Error(
      'Reference worker stage must be financial_statements, financials, or dividends',
    );
  }
  if (items.length === 0) {
    throw new Error('Reference worker requires at least one item');
  }

  const summary = await runReferenceWorker(
    stageArgument,
    items,
    process.send ? reportCompletedItem : undefined,
  );
  const peakMemoryMib = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(
    `[maintenance:reference-worker] ${stageArgument} batch complete; ${items.length} items; peak RSS ${peakMemoryMib} MiB`,
  );
  const message = { type: 'reference-worker-summary', summary };
  if (process.send) {
    await new Promise<void>((resolve, reject) => {
      process.send!(message, (error) => (error ? reject(error) : resolve()));
    });
  }
}

/**
 * 只有调用方持久接受当前完成结果后，才允许开始下一项。
 * The next item may start only after the caller durably accepts this completion.
 */
async function reportCompletedItem(item: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      process.off('message', acknowledge);
      process.off('disconnect', disconnected);
    };
    const disconnected = () => {
      cleanup();
      reject(new Error('Reference worker caller disconnected before acknowledgement'));
    };
    const acknowledge = (message: unknown) => {
      const acknowledgement = message as Partial<ReferenceWorkerAcknowledgement> | null;
      if (
        acknowledgement?.type === 'reference-worker-acknowledged' &&
        acknowledgement.item === item
      ) {
        cleanup();
        resolve();
      }
    };
    process.on('message', acknowledge);
    process.once('disconnect', disconnected);
    process.send!({ type: 'reference-worker-item', item }, (error) => {
      if (error) {
        cleanup();
        reject(error);
      }
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parentDisconnected = () => process.exit(1);
  process.once('disconnect', parentDisconnected);
  main()
    .catch((error: unknown) => {
      console.error(
        '[maintenance:reference-worker] failed:',
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      process.off('disconnect', parentDisconnected);
      await prisma.$disconnect();
      if (process.connected) {
        process.disconnect();
      }
    });
}
