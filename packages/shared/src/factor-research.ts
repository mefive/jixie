import type { FactorAnalysisKind, FactorAnalysisSpec, FactorReport } from './factor.js';
import type { FactorSignalHorizonUnit } from './factor-release.js';

export type FactorObservationFrequency = 'daily' | 'weekly' | 'monthly';

export interface FactorForwardReturnTargetV1 {
  kind: 'forward_total_return';
  horizon: number;
  horizonUnit: FactorSignalHorizonUnit;
}

export interface FactorPointInTimePolicyV1 {
  pointInTime: true;
  revisionPolicy: 'as_available';
  dataCutoff: string | null;
}

/** Compatibility branch for the production equity evaluator. The nested protocol remains immutable
 * so V1–V5 reports retain byte-for-byte research identity while gaining a typed analysis envelope. */
export interface CrossSectionalFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'cross_sectional';
  protocol: FactorAnalysisSpec;
}

export interface TimeSeriesFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'time_series';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  assets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  inference: {
    standardError: 'newey_west';
    lag: 'automatic' | number;
  };
}

export interface PanelFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'panel';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  assets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  rankingScope: 'cross_asset';
  volatilityScaling: 'none' | 'inverse_volatility';
}

export interface MacroRegimeFactorResearchSpecV1 {
  version: 1;
  analysisKind: 'macro_regime';
  start: string;
  end: string;
  observationFrequency: FactorObservationFrequency;
  targetAssets: string[];
  target: FactorForwardReturnTargetV1;
  dataPolicy: FactorPointInTimePolicyV1;
  stateModel: { kind: 'threshold' | 'quantile'; states: number };
}

export type FactorResearchSpecV1 =
  | CrossSectionalFactorResearchSpecV1
  | TimeSeriesFactorResearchSpecV1
  | PanelFactorResearchSpecV1
  | MacroRegimeFactorResearchSpecV1;

export interface FactorTimeSeriesReportV1 {
  assets: string[];
  periods: number;
  correlation: number;
  regressionSlope: number;
  directionHitRate: number;
  neweyWestTStat: number;
}

export interface FactorPanelReportV1 {
  assets: string[];
  periods: number;
  rankIcMean: number;
  rankIcirAnnual: number;
  longShortAnnualized: number;
}

export interface FactorMacroRegimeReportV1 {
  targetAssets: string[];
  periods: number;
  states: Array<{ key: string; observations: number; meanForwardReturn: number }>;
}

export type FactorResearchReportPayloadV1 =
  | { version: 1; analysisKind: 'cross_sectional'; report: FactorReport }
  | { version: 1; analysisKind: 'time_series'; report: FactorTimeSeriesReportV1 }
  | { version: 1; analysisKind: 'panel'; report: FactorPanelReportV1 }
  | { version: 1; analysisKind: 'macro_regime'; report: FactorMacroRegimeReportV1 };

export function researchAnalysisKind(spec: FactorResearchSpecV1): FactorAnalysisKind {
  return spec.analysisKind;
}
