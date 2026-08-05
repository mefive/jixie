import { parentPort, workerData } from 'node:worker_threads';
import type { BacktestConfig, Locale } from '@jixie/shared';
import { runConfiguredBacktest } from './configured-run.js';
import { metricSummary } from '../strategy/scan.js';
import { prisma } from '../lib/prisma.js';

const port = parentPort;
if (!port) {
  throw new Error('agent-backtest-worker must be spawned as a worker thread');
}

const { config, userId, locale } = workerData as {
  config: BacktestConfig;
  userId: string;
  locale: Locale;
};

try {
  const result = await runConfiguredBacktest(config, userId, locale);
  port.postMessage({ type: 'done', summary: metricSummary(result) });
} catch (error) {
  port.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
} finally {
  await prisma.$disconnect();
}
