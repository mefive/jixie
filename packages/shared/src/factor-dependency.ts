import type { PublishFactorRequest as PublishFactorRequestBody } from './api/factor.js';
import type { FactorAnalysisKind, FactorLanguage, FactorRuntimeVersion } from './factor.js';

export type FactorStatus = 'draft' | 'published' | 'archived';
export type FactorInputDomain = 'price' | 'fundamental' | 'flow' | 'rates' | 'commodity' | 'macro';
export type FactorTargetAssetClass = 'equity' | 'fixed_income' | 'commodity' | 'cash' | 'fx';
export type FactorSignalHorizonUnit = 'trade_day' | 'calendar_day' | 'month';

/**
 * 冻结回测所引用的已发布因子身份。
 *
 * Immutable published factor identity frozen into a backtest.
 */
export interface FactorDependency {
  factorId: string;
  key: string;
  name: string;
  analysisKind: FactorAnalysisKind;
  /** Absent on frozen dependencies created before Python Factor support. */
  language?: FactorLanguage;
  /** Absent on frozen dependencies created before Python Factor support. */
  runtimeVersion?: FactorRuntimeVersion;
  codeHash: string;
  approvedReportId?: string | null;
  /** Point-in-time data fields consumed by an executable Definition V2 factor. */
  inputs?: string[];
}

export type PublishFactorRequest = PublishFactorRequestBody;

/**
 * 公开已发布因子定义及其可执行协议元数据。
 *
 * Describe a published factor and executable protocol metadata.
 */
export interface PublishedFactor {
  id: string;
  key: string;
  name: string;
  analysisKind: FactorAnalysisKind;
  language: FactorLanguage;
  runtimeVersion: FactorRuntimeVersion;
  status: Extract<FactorStatus, 'published' | 'archived'>;
  codeHash: string;
  approvedReportId?: string | null;
  publishedAt: string;
  archivedAt?: string | null;
}

/**
 * 记录单因子在指定资产日期的信号，供运行输出。
 *
 * Describe a dated asset signal from one factor.
 */
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

/**
 * 保存某因子实际消费的输入观测，供运行审计。
 *
 * Retain observations actually consumed by a factor for auditing.
 */
export interface FactorInputObservation {
  assetId: string;
  value: number | null;
}

/**
 * 紧凑汇总已发布因子消费的输入值。
 *
 * Compact audit summary of the values consumed from one published factor.
 */
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
