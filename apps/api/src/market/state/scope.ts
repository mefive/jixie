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

export function dirtyMarketIndicatorScope(dirtyScopes: unknown): DerivedMarketScope {
  const dirty =
    Array.isArray(dirtyScopes) && dirtyScopes.length
      ? dirtyScopes.filter((value): value is string => typeof value === 'string')
      : ['all'];
  if (dirty.includes('all')) {
    return allMarketIndicatorScope();
  }

  return {
    market: dirty.includes('market'),
    industries: dirty.includes('industries'),
    indexCodes: dirty
      .filter((value) => value.startsWith('index:'))
      .map((value) => value.slice(6))
      .filter((code) => allMarketIndicatorScope().indexCodes.includes(code)),
  };
}
