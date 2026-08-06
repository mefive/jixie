import { parentPort, workerData } from 'node:worker_threads';
import type { FactorAnalysisSpec, Locale, LogLine, LogLevel } from '@jixie/shared';
import type { FactorAnalysisRuntimeSource } from './composite.js';
import { prisma } from '../lib/prisma.js';
import { factorEvaluatorFor } from './evaluator.js';
import { normalizeFactorResearchSpec } from './report-spec.js';

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

const { reportId, factor, source, spec, locale } = workerData as {
  reportId: string;
  factor: string;
  source: FactorAnalysisRuntimeSource;
  spec: FactorAnalysisSpec;
  locale: Locale;
};

// One log sink, tagged here: analysis progress → system, a custom factor's console.* → user.
const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const researchSpec = normalizeFactorResearchSpec(spec);
  const evaluator = factorEvaluatorFor(researchSpec);
  if (researchSpec.analysisKind !== 'cross_sectional') {
    throw new Error(`Factor evaluator ${researchSpec.analysisKind} is not implemented.`);
  }
  const report = await evaluator.evaluate({
    factor,
    researchSpec,
    onSystemLog,
    onUserLog,
    locale,
    source: { ...source },
  });
  port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
