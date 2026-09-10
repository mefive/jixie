import { parentPort, workerData } from 'node:worker_threads';
import type { FactorFreq, Locale, LogLine, LogLevel } from '@jixie/shared';
import { computeFactorCorrelation } from './correlation.js';
import { prisma } from '#infra/database/prisma.js';

/**
 * Factor-correlation worker thread. Mirrors factor-worker: computeFactorCorrelation loads whole-market
 * panels + per-factor cross-sectional loops (one per selected factor), which would block the HTTP event
 * loop, so it runs here. Streams progress as { type:'log' }; on success posts { type:'done', payload }
 * for the API to commit with its Job; on failure posts { type:'error' }. Dev (tsx) loads via .boot.mjs.
 */
const port = parentPort;
if (!port) {
  throw new Error('correlation-worker must be spawned as a worker thread');
}

const { keys, freq, start, end, locale } = workerData as {
  id: string;
  userId: string;
  keys: string[];
  freq: FactorFreq;
  start: string;
  end: string;
  locale: Locale;
};

const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
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
  port.postMessage({ type: 'done', payload });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
