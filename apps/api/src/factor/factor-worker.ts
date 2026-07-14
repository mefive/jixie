import { parentPort, workerData } from 'node:worker_threads';
import type { FactorFreq, Locale, LogLine, LogLevel, Neutral } from '@jixie/shared';
import { analyzeFactor } from './analysis.js';
import { prisma } from '../lib/prisma.js';

/**
 * Factor-analysis worker thread. analyzeFactor loads whole-market panels + tight cross-sectional loops,
 * which would block the HTTP event loop, so it runs here (own PrismaClient per thread). Streams progress
 * as { type:'log', line }; on success returns the payload to the parent process, which persists it and
 * updates the report/job statuses together. Dev (tsx) loads via the .boot.mjs bootstrap; prod spawns
 * the compiled .js.
 */
const port = parentPort;
if (!port) {
  throw new Error('factor-worker must be spawned as a worker thread');
}

const { reportId, factor, factorCodeSnapshot, factorLabel, freq, start, end, neutral, locale } =
  workerData as {
    reportId: string;
    factor: string;
    factorCodeSnapshot: string;
    factorLabel: string;
    freq: FactorFreq;
    start: string;
    end: string;
    neutral: Neutral;
    locale: Locale;
  };

// One log sink, tagged here: analysis progress → system, a custom factor's console.* → user.
const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const report = await analyzeFactor(
    factor,
    freq,
    start,
    end,
    neutral,
    onSystemLog,
    onUserLog,
    locale,
    { code: factorCodeSnapshot, label: factorLabel },
  );
  port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
