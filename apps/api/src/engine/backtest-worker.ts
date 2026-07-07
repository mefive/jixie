import { parentPort, workerData } from 'node:worker_threads';
import type { BacktestConfig, Locale, LogLine, LogLevel } from '@jixie/shared';
import { runWalledBacktest } from './walled-run.js';
import { prismaDataPort } from './prisma-port.js';
import { prisma } from '../lib/prisma.js';

/**
 * Backtest worker thread. A backtest is CPU-heavy (loads whole-market panels + ranks them), so it
 * runs here instead of on the HTTP event loop. The worker reads market data through its OWN
 * PrismaClient (one client per thread — never shared across threads), posts progress as
 * { type:'log', line } messages while running, then a final { type:'done', result } or
 * { type:'error', message }, and disconnects its DB connection before exiting.
 *
 * Loadable in both dev (tsx runs this .ts directly) and prod (compiled to dist/.../backtest-worker.js);
 * the route resolves the matching extension. DATABASE_URL/token env is inherited from the parent.
 */
const port = parentPort;
if (!port) {
  throw new Error('backtest-worker must be spawned as a worker thread');
}

const { config, userId, strategyId, locale } = workerData as {
  config: BacktestConfig;
  userId: string;
  strategyId: string;
  locale: Locale;
};

// One log sink, tagged at this boundary: engine progress → system, the strategy's console.* → user.
const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  // WALLED lane (lane rule: this code came from the DB — user/AI authored): the engine runs inside
  // an isolated-vm isolate; this worker only serves DataPort crossings with its own Prisma client.
  const result = await runWalledBacktest(
    { ...config, locale },
    prismaDataPort,
    onSystemLog,
    onUserLog,
  );
  // Result lands on the entity (Strategy.lastResult) — the Job only tracks status. Scoped by userId.
  await prisma.strategy
    .updateMany({
      where: { id: strategyId, userId },
      data: { lastResult: JSON.parse(JSON.stringify(result)) }, // plain JSON for the Prisma Json column
    })
    .catch(() => {});
  port.postMessage({ type: 'done' });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
