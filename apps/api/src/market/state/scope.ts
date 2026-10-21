import { MARKET_WEATHER_INDICATOR_INDEX_CODES } from '../registry/index-presets.js';

/**
 * 仅区分既有三类输出；成分修订不能重写无关指数或市场指标。
 *
 * Select the existing output families so membership revisions do not rewrite unrelated outputs.
 */
export interface DerivedMarketScope {
  market: boolean;
  industries: boolean;
  indexCodes: string[];
}

export function allMarketIndicatorScope(): DerivedMarketScope {
  return { market: true, industries: true, indexCodes: [...MARKET_WEATHER_INDICATOR_INDEX_CODES] };
}
