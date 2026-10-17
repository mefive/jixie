import { FactorSandbox } from '../sandbox/factor-sandbox.js';
import type { PanelFactorSandbox } from '../sandbox/contract.js';
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
import { combinePanelFactorObservations } from '../composition/composite.js';
import {
  loadCommodityCarryPanelObservations,
  panelFactorUsesCommodityCarry,
} from '../observations/commodity-carry-panel-observations.js';
import {
  loadCommodityCarryTimeSeriesObservations,
  timeSeriesFactorUsesCommodityCarry,
} from '../observations/commodity-carry-time-series-observations.js';
import {
  loadCommodityWarehouseReceiptTimeSeriesObservations,
  timeSeriesFactorUsesCommodityWarehouseReceipts,
} from '../observations/commodity-warehouse-receipt-time-series-observations.js';
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
 * Unify kind-specific frozen evaluation outputs for report persistence.
 */
export type FactorEvaluationResult =
  | FactorReport
  | FactorTimeSeriesReportV1
  | FactorPanelReportV1
  | FactorMacroRegimeReportV1;

/**
 * 对冻结来源执行计算，不管理报告、任务或因子气象的持久化生命周期。
 * Compute a frozen source without owning a report, job, or weather persistence lifecycle.
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
        const usesCommodityCarry = timeSeriesFactorUsesCommodityCarry(sandbox);
        const usesCommodityWarehouseReceipts =
          timeSeriesFactorUsesCommodityWarehouseReceipts(sandbox);
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
          ? await loadCommodityCarryTimeSeriesObservations(researchSpec, sandbox)
          : usesCommodityWarehouseReceipts
            ? await loadCommodityWarehouseReceiptTimeSeriesObservations(researchSpec, sandbox)
            : await loadEtfTimeSeriesObservations(researchSpec, sandbox);
        onSystemLog(t(locale, 'factorTimeSeriesEvaluating', { count: observations.length }));
        const report = new TimeSeriesEvaluator().evaluate(researchSpec, observations);
        return complete(report);
      } finally {
        sandbox.close();
      }
    }
    case 'panel': {
      if (source.kind !== 'panel' && source.kind !== 'panel_composite') {
        throw new Error('Panel evaluator requires a panel Factor V2 source.');
      }
      if (source.kind === 'panel') {
        const sandbox = await FactorSandbox.start({
          language: source.language ?? 'typescript',
          analysisKind: 'panel',
          code: source.code,
          onUserLog: onUserLog,
        });
        try {
          onSystemLog(t(locale, 'factorPanelLoading', { count: researchSpec.assets.length }));
          const observations = panelFactorUsesCommodityCarry(sandbox)
            ? await loadCommodityCarryPanelObservations(researchSpec, sandbox)
            : await loadPanelEtfObservations(researchSpec, sandbox);
          onSystemLog(t(locale, 'factorPanelEvaluating', { count: observations.length }));
          const report = new PanelEvaluator().evaluate(researchSpec, observations);
          return complete(report);
        } finally {
          sandbox.close();
        }
      }

      const componentSandboxes: Array<PanelFactorSandbox> = [];
      try {
        for (const component of source.components) {
          componentSandboxes.push(
            await FactorSandbox.start({
              language: component.language ?? 'typescript',
              analysisKind: 'panel',
              code: component.code,
              onUserLog: onUserLog,
            }),
          );
        }
        onSystemLog(t(locale, 'factorPanelLoading', { count: researchSpec.assets.length }));
        const componentObservations = await Promise.all(
          componentSandboxes.map((sandbox, index) =>
            (panelFactorUsesCommodityCarry(sandbox)
              ? loadCommodityCarryPanelObservations(researchSpec, sandbox)
              : loadPanelEtfObservations(researchSpec, sandbox)
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
        return complete(report);
      } finally {
        componentSandboxes.forEach((sandbox) => sandbox.close());
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
