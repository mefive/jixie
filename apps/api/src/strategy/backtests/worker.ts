import { backtestWorkerInputSchema } from './job-payload.js';
import type { BacktestWorkerMessage } from './worker-protocol.js';
import { prisma } from '#infra/database/prisma.js';
import { errorMessage } from '#infra/errors.js';
import type { Locale, LogLevel, LogLine } from '@jixie/shared';
import { parentPort, workerData } from 'node:worker_threads';
import { runConfiguredBacktest } from './run.js';

/**
 * Backtest worker thread. A backtest is CPU-heavy (loads whole-market panels + ranks them), so it
 * runs here instead of on the HTTP event loop. The worker reads market data through its OWN
 * PrismaClient (one client per thread — never shared across threads), posts progress as
 * { type:'log', entry } messages while running, then a final { type:'done', payload } or
 * { type:'error', message }, and disconnects its DB connection before exiting.
 *
 * Loadable in both dev (tsx runs this .ts directly) and prod (compiled to dist/src/strategy/backtests/worker.js);
 * the backtest Job resolves the matching extension. DATABASE_URL/token env is inherited from the parent.
 */
const port = parentPort;
if (!port) {
  throw new Error('backtest-worker must be spawned as a worker thread');
}

// One log sink, tagged at this boundary: engine progress → system, the strategy's console.* → user.
const send = (message: BacktestWorkerMessage) => port.postMessage(message);

const emit = (entry: LogLine) => send({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

let locale: Locale = 'zh';
try {
  const input = backtestWorkerInputSchema.parse(workerData);
  const { config, userId } = input;
  locale = input.locale;
  const result = await runConfiguredBacktest(config, userId, locale, onSystemLog, onUserLog);
  send({ type: 'done', payload: result });
} catch (e) {
  console.error('[backtest-worker] run failed', e);
  send({ type: 'error', message: errorMessage(e, locale) });
} finally {
  await prisma.$disconnect();
}
