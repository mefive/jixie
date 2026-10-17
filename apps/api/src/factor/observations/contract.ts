import type { MultiAssetClass } from '@jixie/shared';

export const DEFAULT_CROSS_SECTIONAL_MINIMUM_WINDOW_COVERAGE = 0;

/**
 * 绑定单资产信号与前瞻收益和日期，供时间序列评估。
 *
 * Associate dated single-asset signals and forward returns for evaluation.
 */
export interface TimeSeriesEvaluationObservation {
  assetId: string;
  asOfDate: string;
  featureAvailableDate: string;
  targetDate: string;
  score: number;
  forwardReturn: number;
}

/**
 * 绑定 Panel 资产、因子值、收益与分类，供横截面排序评估。
 *
 * Supply dated panel assets, factor values, returns and classifications for ranking.
 */
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

/**
 * 冻结股票风格控制暴露，供截面辅助回归而非主指标替换。
 *
 * Supply frozen equity-style controls for auxiliary cross-sectional regression.
 */
export interface EquityStyleControlExposureV1 {
  size: number;
  value: number;
  momentum: number;
  quality: number;
}
