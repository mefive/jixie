export type FactorWeatherDirection = 'positive' | 'negative';
export type FactorWeatherPinStatus = 'pending' | 'running' | 'ready' | 'error';

/**
 * 记录单月因子气象值及样本，供固定项历史展示。
 * Describe monthly factor-weather values and samples.
 */
export interface FactorWeatherPoint {
  formationDate: string;
  periodEndDate: string;
  rankIc: number;
  topReturn: number;
  bottomReturn: number;
  longShortGrossReturn: number;
  longShortNetReturn: number;
  topTurnover: number | null;
  sampleSize: number;
  sampleCoverage: number;
}

/**
 * 保存固定因子、方向、配置及刷新状态。
 * Describe a pinned factor, direction, settings and refresh state.
 */
export interface FactorWeatherPin {
  id: string;
  factorId: string;
  factorName: string;
  builtin: boolean;
  direction: FactorWeatherDirection;
  status: FactorWeatherPinStatus;
  error?: string;
  computedThrough?: string;
  codeHash: string;
  points: FactorWeatherPoint[];
  createdAt: string;
}

/**
 * 返回气象固定项与共同日期信息。
 * Return weather pins and common date metadata.
 */
export interface FactorWeatherResponse {
  methodology: {
    frequency: 'month';
    neutral: 'size_industry';
    weighting: 'equal';
    groups: 10;
    partialMonth: false;
  };
  pins: FactorWeatherPin[];
}
