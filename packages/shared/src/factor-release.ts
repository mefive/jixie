import type { FactorAnalysisKind, FactorResearchIntentV1 } from './factor.js';

export type FactorReleaseSourceKind = 'single' | 'composite';
export type FactorInputDomain = 'price' | 'fundamental' | 'flow' | 'rates' | 'commodity' | 'macro';
export type FactorTargetAssetClass = 'equity' | 'fixed_income' | 'commodity' | 'cash' | 'fx';
export type FactorOutputScope = 'asset' | 'global';
export type FactorReleaseMaturity = 'experimental' | 'validated' | 'production';
export type FactorReleaseLifecycle = 'active' | 'retired';
export type FactorSignalHorizonUnit = 'trade_day' | 'calendar_day' | 'month';

export interface FactorReleaseMethodologyV1 {
  version: 1;
  analysisKind: FactorAnalysisKind;
  phase: 'legacy' | 'explore' | 'holdout';
  approvedReportId: string;
  spec: unknown;
  researchIntent?: FactorResearchIntentV1;
  revealedAt?: string;
}

export interface FactorRelease {
  id: string;
  releaseKey: string;
  version: number;
  sourceKind: FactorReleaseSourceKind;
  sourceId: string;
  sourceName: string;
  inputDomains: FactorInputDomain[];
  targetAssetClasses: FactorTargetAssetClass[];
  outputScope: FactorOutputScope;
  codeHash: string;
  approvedReportId: string;
  methodology: FactorReleaseMethodologyV1;
  maturity: FactorReleaseMaturity;
  lifecycle: FactorReleaseLifecycle;
  createdAt: string;
}

export interface FactorReleaseDependency {
  releaseId: string;
  sourceId: string;
  releaseKey: string;
  version: number;
  codeHash: string;
  approvedReportId: string;
  maturity: FactorReleaseMaturity;
}

export interface PublishFactorReleaseRequest {
  sourceKind: FactorReleaseSourceKind;
  sourceId: string;
  releaseKey?: string;
  approvedReportId: string;
  /** Compatibility-only assertions. The API derives and persists canonical metadata from the
   * approved immutable report; supplied values must match that derivation exactly. */
  inputDomains?: FactorInputDomain[];
  targetAssetClasses?: FactorTargetAssetClass[];
  outputScope?: FactorOutputScope;
  maturity: FactorReleaseMaturity;
}

export interface FactorSignal {
  asOfDate: string;
  assetId: string | null;
  score: number;
  horizon: number;
  horizonUnit: FactorSignalHorizonUnit;
  expectedReturn?: number;
  upProbability?: number;
  calibrationReportId?: string;
  releaseId: string;
  dataCutoff: string;
}
