import type { MultiAssetClass } from '@jixie/shared';

export const DEFAULT_CROSS_SECTIONAL_MINIMUM_WINDOW_COVERAGE = 0;

export interface TimeSeriesEvaluationObservation {
  assetId: string;
  asOfDate: string;
  featureAvailableDate: string;
  targetDate: string;
  score: number;
  forwardReturn: number;
}

export interface PanelEvaluationObservation {
  assetId: string;
  assetClass: MultiAssetClass;
  asOfDate: string;
  featureAvailableDate: string;
  targetDate: string;
  score: number;
  forwardReturn: number;
  volatility: number;
}

export interface EquityStyleControlExposureV1 {
  size: number;
  value: number;
  momentum: number;
  quality: number;
}
