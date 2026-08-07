import { parentPort, workerData } from 'node:worker_threads';
import type { FactorResearchSpecV1, Locale, LogLine, LogLevel } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';
import { prisma } from '../lib/prisma.js';
import { factorEvaluatorFor } from './evaluator.js';
import { normalizeFactorResearchSpec } from './report-spec.js';
import { loadEtfTimeSeriesObservations } from './etf-trend-observations.js';
import { TimeSeriesEvaluator } from './time-series-evaluator.js';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { t } from '../i18n/index.js';

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
  source: FactorAnalysisSource;
  spec: FactorResearchSpecV1;
  locale: Locale;
};

// One log sink, tagged here: analysis progress → system, a custom factor's console.* → user.
const emit = (entry: LogLine) => port.postMessage({ type: 'log', entry });
const onSystemLog = (text: string) => emit({ source: 'system', level: 'info', text });
const onUserLog = (level: LogLevel, text: string) => emit({ source: 'user', level, text });

try {
  const researchSpec = normalizeFactorResearchSpec(spec);
  switch (researchSpec.analysisKind) {
    case 'cross_sectional': {
      if (source.kind === 'time_series') {
        throw new Error('Time-series source cannot run with a cross-sectional protocol.');
      }
      const evaluator = factorEvaluatorFor(researchSpec);
      const report = await evaluator.evaluate({
        factor,
        researchSpec,
        onSystemLog,
        onUserLog,
        locale,
        source: { ...source },
      });
      port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
      break;
    }
    case 'time_series': {
      if (source.kind !== 'time_series') {
        throw new Error('Time-series evaluator requires a Factor V2 source.');
      }
      const compiled = await compileTimeSeriesFactor(source.code, onUserLog);
      try {
        onSystemLog(t(locale, 'factorTimeSeriesLoading', { count: researchSpec.assets.length }));
        const observations = await loadEtfTimeSeriesObservations(researchSpec, compiled);
        onSystemLog(t(locale, 'factorTimeSeriesEvaluating', { count: observations.length }));
        const report = new TimeSeriesEvaluator().evaluate(researchSpec, observations);
        port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
      } finally {
        compiled.dispose();
      }
      break;
    }
    case 'panel':
    case 'macro_regime':
      throw new Error(`Factor evaluator ${researchSpec.analysisKind} is not implemented.`);
  }
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
