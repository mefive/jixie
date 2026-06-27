import { parentPort, workerData } from 'node:worker_threads';
import type { BacktestConfig } from '@jixie/shared';
import { runCodeBacktest } from '../strategy/code/run.js';
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
if (!port) throw new Error('backtest-worker must be spawned as a worker thread');

const { config } = workerData as { config: BacktestConfig };

try {
  const result = await runCodeBacktest(config, (line) => port.postMessage({ type: 'log', line }));
  port.postMessage({ type: 'done', result });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
