import type { FactorAnalysisKind } from './factor.js';

export type FactorStatus = 'draft' | 'published' | 'archived';
export type FactorInputDomain = 'price' | 'fundamental' | 'flow' | 'rates' | 'commodity' | 'macro';
export type FactorTargetAssetClass = 'equity' | 'fixed_income' | 'commodity' | 'cash' | 'fx';
export type FactorSignalHorizonUnit = 'trade_day' | 'calendar_day' | 'month';

/** Immutable published factor identity frozen into a backtest, deployment, or signal run. */
export interface FactorDependency {
  factorId: string;
  key: string;
  name: string;
  analysisKind: FactorAnalysisKind;
  codeHash: string;
  approvedReportId?: string | null;
  /** Point-in-time data fields consumed by an executable Definition V2 factor. */
  inputs?: string[];
}

export interface PublishFactorRequest {
  approvedReportId: string;
}

export interface PublishedFactor {
  id: string;
  key: string;
  name: string;
  analysisKind: FactorAnalysisKind;
  status: Extract<FactorStatus, 'published' | 'archived'>;
  codeHash: string;
  approvedReportId?: string | null;
  publishedAt: string;
  archivedAt?: string | null;
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
  factorId: string;
  dataCutoff: string;
}

export interface FactorInputObservation {
  assetId: string;
  value: number | null;
}

/** Compact audit summary of the values consumed from one published factor. */
export interface FactorInputSummary {
  factorId: string;
  key: string;
  asOfDate: string;
  observedAssets: number;
  validAssets: number;
  minValue: number | null;
  maxValue: number | null;
  meanValue: number | null;
  decisionObservations: FactorInputObservation[];
}
