import { factorCorrelationJobPayloadSchema } from './job-payload.js';
import type { FactorCorrelationWorkerMessage } from './worker-protocol.js';
import { parentPort, workerData } from 'node:worker_threads';
import type { LogLine, LogLevel } from '@jixie/shared';
import { computeFactorCorrelation } from './compute.js';
import { prisma } from '#infra/database/prisma.js';

/**
 * Factor-correlation worker thread. Mirrors execution/worker: computeFactorCorrelation loads whole-market
 * panels + per-factor cross-sectional loops (one per selected factor), which would block the HTTP event
 * loop, so it runs here. Streams progress as { type:'log' }; on success posts { type:'done', payload }
 * for the API to commit with its Job; on failure posts { type:'error' }. Dev (tsx) loads via .boot.mjs.
 */
const port = parentPort;
if (!port) {
  throw new Error('correlation-worker must be spawned as a worker thread');
}

const send = (message: FactorCorrelationWorkerMessage) => port.postMessage(message);

const emit = (entry: LogLine) => send({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const { keys, freq, start, end, locale } = factorCorrelationJobPayloadSchema.parse(workerData);
  const report = await computeFactorCorrelation(
    keys,
    freq,
    start,
    end,
    onSystemLog,
    onUserLog,
    locale,
  );
  const payload = JSON.stringify(report);
  send({ type: 'done', payload });
} catch (e) {
  send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
