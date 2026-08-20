import { parentPort, workerData } from 'node:worker_threads';
import type { FactorResearchSpecV1, Locale, LogLine, LogLevel } from '@jixie/shared';
import type { FactorAnalysisSource } from './analysis-job.js';
import { prisma } from '../lib/prisma.js';
import { factorEvaluatorFor } from './evaluator.js';
import { normalizeFactorResearchSpec } from './report-spec.js';
import { loadEtfTimeSeriesObservations } from './etf-trend-observations.js';
import {
  loadCommodityCarryTimeSeriesObservations,
  timeSeriesFactorUsesCommodityCarry,
} from './commodity-carry-time-series-observations.js';
import {
  loadCommodityWarehouseReceiptTimeSeriesObservations,
  timeSeriesFactorUsesCommodityWarehouseReceipts,
} from './commodity-warehouse-receipt-time-series-observations.js';
import { TimeSeriesEvaluator } from './time-series-evaluator.js';
import { compileTimeSeriesFactor } from './compile-time-series-factor.js';
import { compilePanelFactor } from './compile-time-series-factor.js';
import {
  compilePythonPanelFactor,
  compilePythonTimeSeriesFactor,
} from './python-asset-factor-runtime.js';
import { loadPanelEtfObservations } from './panel-observations.js';
import {
  loadCommodityCarryPanelObservations,
  panelFactorUsesCommodityCarry,
} from './commodity-carry-panel-observations.js';
import { PanelEvaluator } from './panel-evaluator.js';
import { combinePanelFactorObservations } from './composite.js';
import { loadMacroRegimeObservations } from './macro-regime-observations.js';
import { MacroRegimeEvaluator } from './macro-regime-evaluator.js';
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
      if (source.kind !== 'single' && source.kind !== 'composite') {
        throw new Error('Asset-scope Factor V2 source cannot run with a cross-sectional protocol.');
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
      const compiled =
        source.language === 'python'
          ? await compilePythonTimeSeriesFactor(source.code, onUserLog)
          : await compileTimeSeriesFactor(source.code, onUserLog);
      try {
        const usesCommodityCarry = timeSeriesFactorUsesCommodityCarry(compiled);
        const usesCommodityWarehouseReceipts =
          timeSeriesFactorUsesCommodityWarehouseReceipts(compiled);
        onSystemLog(
          t(
            locale,
            usesCommodityCarry
              ? 'factorCommodityCarryTimeSeriesLoading'
              : usesCommodityWarehouseReceipts
                ? 'factorCommodityWarehouseReceiptTimeSeriesLoading'
                : 'factorTimeSeriesLoading',
            { count: researchSpec.assets.length },
          ),
        );
        const observations = usesCommodityCarry
          ? await loadCommodityCarryTimeSeriesObservations(researchSpec, compiled)
          : usesCommodityWarehouseReceipts
            ? await loadCommodityWarehouseReceiptTimeSeriesObservations(researchSpec, compiled)
            : await loadEtfTimeSeriesObservations(researchSpec, compiled);
        onSystemLog(t(locale, 'factorTimeSeriesEvaluating', { count: observations.length }));
        const report = new TimeSeriesEvaluator().evaluate(researchSpec, observations);
        port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
      } finally {
        compiled.dispose();
      }
      break;
    }
    case 'panel': {
      if (source.kind !== 'panel' && source.kind !== 'panel_composite') {
        throw new Error('Panel evaluator requires a panel Factor V2 source.');
      }
      if (source.kind === 'panel') {
        const compiled =
          source.language === 'python'
            ? await compilePythonPanelFactor(source.code, onUserLog)
            : await compilePanelFactor(source.code, onUserLog);
        try {
          onSystemLog(t(locale, 'factorPanelLoading', { count: researchSpec.assets.length }));
          const observations = panelFactorUsesCommodityCarry(compiled)
            ? await loadCommodityCarryPanelObservations(researchSpec, compiled)
            : await loadPanelEtfObservations(researchSpec, compiled);
          onSystemLog(t(locale, 'factorPanelEvaluating', { count: observations.length }));
          const report = new PanelEvaluator().evaluate(researchSpec, observations);
          port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
        } finally {
          compiled.dispose();
        }
        break;
      }

      const compiledComponents: Array<Awaited<ReturnType<typeof compilePanelFactor>>> = [];
      try {
        for (const component of source.components) {
          compiledComponents.push(
            component.language === 'python'
              ? await compilePythonPanelFactor(component.code, onUserLog)
              : await compilePanelFactor(component.code, onUserLog),
          );
        }
        onSystemLog(t(locale, 'factorPanelLoading', { count: researchSpec.assets.length }));
        const componentObservations = await Promise.all(
          compiledComponents.map((compiled, index) =>
            (panelFactorUsesCommodityCarry(compiled)
              ? loadCommodityCarryPanelObservations(researchSpec, compiled)
              : loadPanelEtfObservations(researchSpec, compiled)
            ).then((observations) => ({
              factor: source.components[index].factor,
              observations,
            })),
          ),
        );
        const observations = combinePanelFactorObservations(
          componentObservations,
          source.definition,
        );
        onSystemLog(t(locale, 'factorPanelEvaluating', { count: observations.length }));
        const report = new PanelEvaluator().evaluate(researchSpec, observations);
        port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
      } finally {
        compiledComponents.forEach((compiled) => compiled.dispose());
      }
      break;
    }
    case 'macro_regime': {
      if (source.kind !== 'macro_regime') {
        throw new Error('Macro-regime evaluator requires the frozen macro model source.');
      }
      onSystemLog(
        t(locale, 'factorMacroRegimeLoading', { count: researchSpec.targetAssets.length }),
      );
      const data = await loadMacroRegimeObservations(researchSpec);
      onSystemLog(t(locale, 'factorMacroRegimeEvaluating', { count: data.observations.length }));
      const report = new MacroRegimeEvaluator().evaluate(researchSpec, data);
      port.postMessage({ type: 'done', reportId, payload: JSON.stringify(report) });
      break;
    }
  }
} catch (e) {
  port.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
} finally {
  await prisma.$disconnect();
}
