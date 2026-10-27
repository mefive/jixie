import { FactorSandbox } from '../sandbox/factor-sandbox.js';
import { t } from '#i18n/index.js';
import type {
  FactorAnalysisSpec,
  FactorMacroRegimeReportV1,
  FactorPanelReportV1,
  FactorReport,
  FactorResearchSpecV1,
  FactorTimeSeriesReportV1,
  Locale,
  LogLevel,
} from '@jixie/shared';
import { loadEtfTimeSeriesObservations } from '../observations/etf-trend-observations.js';
import { loadMacroRegimeObservations } from '../observations/macro-regime-observations.js';
import { loadPanelEtfObservations } from '../observations/panel-observations.js';
import type { FactorAnalysisSource } from '../sources/snapshot.js';
import { factorEvaluatorFor } from './cross-sectional/cross-sectional-evaluator.js';
import { MacroRegimeEvaluator } from './macro-regime-evaluator.js';
import { PanelEvaluator } from './panel-evaluator.js';
import { normalizeFactorResearchSpec } from './spec.js';
import { TimeSeriesEvaluator } from './time-series-evaluator.js';

/**
 * 统一不同因子种类的冻结计算输出，供报告生命周期持久化。
 *
 * Unify kind-specific frozen evaluation outputs for report persistence.
 */
export type FactorEvaluationResult =
  | FactorReport
  | FactorTimeSeriesReportV1
  | FactorPanelReportV1
  | FactorMacroRegimeReportV1;

/**
 * 对冻结来源执行计算，不管理报告或任务的持久化生命周期。
 *
 * Compute a frozen source without owning a report or job persistence lifecycle.
 */
export async function runFactorEvaluation({
  factor,
  source,
  spec,
  locale,
  onSystemLog,
  onUserLog,
  onResult,
}: {
  factor: string;
  source: FactorAnalysisSource;
  spec: FactorAnalysisSpec | FactorResearchSpecV1;
  locale: Locale;
  onSystemLog: (text: string) => void;
  onUserLog: (level: LogLevel, text: string) => void;
  /** Deliver before runtime disposal to preserve worker message and failure ordering. */
  onResult?: (result: FactorEvaluationResult) => void;
}): Promise<FactorEvaluationResult> {
  const complete = (result: FactorEvaluationResult) => {
    onResult?.(result);
    return result;
  };
  const researchSpec = normalizeFactorResearchSpec(spec);
  switch (researchSpec.analysisKind) {
    case 'cross_sectional': {
      if (source.kind !== 'single') {
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
      return complete(report);
    }
    case 'time_series': {
      if (source.kind !== 'time_series') {
        throw new Error('Time-series evaluator requires a Factor V2 source.');
      }
      const sandbox = await FactorSandbox.start({
        language: source.language ?? 'typescript',
        analysisKind: 'time_series',
        code: source.code,
        onUserLog: onUserLog,
      });
      try {
        onSystemLog(t(locale, 'factorTimeSeriesLoading', { count: researchSpec.assets.length }));
        const observations = await loadEtfTimeSeriesObservations(researchSpec, sandbox);
        onSystemLog(t(locale, 'factorTimeSeriesEvaluating', { count: observations.length }));
        const report = new TimeSeriesEvaluator().evaluate(researchSpec, observations);
        return complete(report);
      } finally {
        sandbox.close();
      }
    }
    case 'panel': {
      if (source.kind !== 'panel') {
        throw new Error('Panel evaluator requires a panel Factor V2 source.');
      }
      const sandbox = await FactorSandbox.start({
        language: source.language ?? 'typescript',
        analysisKind: 'panel',
        code: source.code,
        onUserLog: onUserLog,
      });
      try {
        onSystemLog(t(locale, 'factorPanelLoading', { count: researchSpec.assets.length }));
        const observations = await loadPanelEtfObservations(researchSpec, sandbox);
        onSystemLog(t(locale, 'factorPanelEvaluating', { count: observations.length }));
        const report = new PanelEvaluator().evaluate(researchSpec, observations);
        return complete(report);
      } finally {
        sandbox.close();
      }
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
      return complete(report);
    }
  }
}
