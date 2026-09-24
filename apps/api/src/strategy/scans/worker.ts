import { strategyScanWorkerInputSchema } from './job-payload.js';
import type { StrategyScanWorkerMessage } from './worker-protocol.js';
import { prisma } from '#infra/database/prisma.js';
import { errorMessage } from '#infra/errors.js';
import type { Locale } from '@jixie/shared';
import { parentPort, workerData } from 'node:worker_threads';
import { runStrategyScan } from './run.js';

const port = parentPort;
if (!port) {
  throw new Error('strategy-scan-worker must be spawned as a worker thread');
}

const send = (message: StrategyScanWorkerMessage) => port.postMessage(message);
let locale: Locale = 'zh';
try {
  const input = strategyScanWorkerInputSchema.parse(workerData);
  locale = input.locale;
  const payload = await runStrategyScan(input, (text) =>
    send({ type: 'log', entry: { source: 'system', level: 'info', text } }),
  );
  send({ type: 'done', payload });
} catch (error) {
  send({ type: 'error', message: errorMessage(error, locale) });
} finally {
  await prisma.$disconnect();
  port.close();
}
