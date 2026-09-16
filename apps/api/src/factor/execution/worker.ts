import { prisma } from '#infra/database/prisma.js';
import type {
  FactorAnalysisSpec,
  FactorResearchSpecV1,
  Locale,
  LogLevel,
  LogLine,
} from '@jixie/shared';
import { parentPort, workerData } from 'node:worker_threads';
import type { FactorAnalysisSource } from '../sources/snapshot.js';
import { runFactorEvaluation } from './run.js';

/** Shared computation transport for formal evaluations and weather refreshes. */
const port = parentPort;
if (!port) {
  throw new Error('factor-worker must be spawned as a worker thread');
}

// reportId is an opaque transport identifier; weather also uses this envelope.
const { reportId, factor, source, spec, locale } = workerData as {
  reportId: string;
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorAnalysisSpec | FactorResearchSpecV1;
  locale: Locale;
};

const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  await runFactorEvaluation({
    factor,
    source,
    spec,
    locale,
    onSystemLog,
    onUserLog,
    onResult: (result) =>
      port.postMessage({ type: 'done', reportId, payload: JSON.stringify(result) }),
  });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
