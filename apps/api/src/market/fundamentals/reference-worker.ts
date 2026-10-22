import {
  isStagingDatabase,
  databaseFilename,
  withMaintenanceLock,
} from '#infra/coordination/market-access.js';
import { withStagingContext, requirementsSchema } from '#infra/coordination/staging-input.js';
import { resolve, dirname } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isMarketSourceFailure } from '../errors.js';
import { createDatabase, withDatabase, closeDatabase } from '#infra/database/prisma.js';
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
 *
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
 *
 * Parse financial worker startup and connect the parent protocol with resource cleanup.
 */
async function main(): Promise<void> {
  if (!isStagingDatabase() || !process.connected) {
    throw new Error('Financial workers require isolated coordinator ownership and IPC');
  }
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
 *
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

/** 校验启动身份，创建并绑定候选连接及共享 M 描述符。 / Validate identity and bind a candidate client plus the shared M descriptor. */
async function runIsolatedWorker(): Promise<void> {
  const context = z
    .object({
      id: z.string().regex(/^[A-Z0-9]+$/),
      directory: z.string(),
      formalUrl: z.string(),
      timestamp: z.iso.datetime(),
      date: z.string().regex(/^\d{8}$/),
      upperBound: z.string().regex(/^\d{8}$/),
      requirements: requirementsSchema,
    })
    .parse(JSON.parse(process.env.JIXIE_STAGING_CONTEXT ?? 'null'));
  const expected = resolve(
    dirname(databaseFilename(context.formalUrl)),
    'maintenance-staging',
    context.id,
  );
  if ((await realpath(context.directory)) !== expected) {
    throw new Error('Invalid candidate worker directory');
  }
  const persisted = requirementsSchema.parse(
    JSON.parse(await readFile(resolve(expected, 'requirements.json'), 'utf8')),
  );
  if (JSON.stringify(persisted) !== JSON.stringify(context.requirements)) {
    throw new Error('Candidate requirements changed');
  }

  await withStagingContext(context, () =>
    withMaintenanceLock(async () => {
      const database = createDatabase(`file:${resolve(expected, 'candidate.db')}`);
      try {
        await withDatabase(database, main);
      } finally {
        await closeDatabase(database);
      }
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parentDisconnected = () => process.exit(1);
  process.once('disconnect', parentDisconnected);
  await runIsolatedWorker()
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[maintenance:reference-worker] failed:', message);
      if (process.connected) {
        await new Promise<void>((done) =>
          process.send!(
            {
              type: 'reference-worker-error',
              message,
              sourceFailure: isMarketSourceFailure(error),
            },
            () => done(),
          ),
        );
      }
      process.exitCode = 1;
    })
    .finally(() => {
      process.off('disconnect', parentDisconnected);
      if (process.connected) {
        process.disconnect();
      }
    });
}
