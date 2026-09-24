import { factorAnalysisWorkerInputSchema } from './worker-input.js';
import type { FactorAnalysisWorkerMessage } from './worker-protocol.js';
import { prisma } from '#infra/database/prisma.js';
import type { LogLevel, LogLine } from '@jixie/shared';
import { parentPort, workerData } from 'node:worker_threads';
import { runFactorEvaluation } from './run.js';

/** Shared computation transport for formal evaluations and weather refreshes. */
const port = parentPort;
if (!port) {
  throw new Error('factor-worker must be spawned as a worker thread');
}

const send = (message: FactorAnalysisWorkerMessage) => port.postMessage(message);

const emit = (entry: LogLine) => send({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const { reportId, factor, source, spec, locale } =
    factorAnalysisWorkerInputSchema.parse(workerData);
  await runFactorEvaluation({
    factor,
    source,
    spec,
    locale,
    onSystemLog,
    onUserLog,
    onResult: (result) => send({ type: 'done', reportId, payload: JSON.stringify(result) }),
  });
} catch (e) {
  send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
