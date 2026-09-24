import type {
  InstrumentSeriesRequestQuery,
  InstrumentAssetTypeRequestParam,
  MarketWeatherRequestQuery,
  InstrumentNamesRequestQuery,
} from '@jixie/shared/api/market';
import type {
  IndexValuationCatalog,
  IndexValuationSeries,
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherSeries,
  StockSeries,
} from '@jixie/shared';
import { serializeQuery, request } from './client';

// A verified object's chartable daily series.
export function fetchInstrumentSeries(
  assetType: InstrumentAssetTypeRequestParam,
  id: string,
  start?: string,
  end?: string,
): Promise<StockSeries> {
  const query = serializeQuery({
    ...(start ? { start } : {}),
    ...(end ? { end } : {}),
  } satisfies InstrumentSeriesRequestQuery);
  const suffix = query ? `?${query}` : '';

  return request(
    `/api/app/market/instruments/${assetType}/${encodeURIComponent(id)}/series${suffix}`,
  );
}

// tsCode → name (bulk) — e.g. instrument labels in execution detail.
export function fetchInstrumentNames(codes: string[]): Promise<Record<string, string>> {
  const query = serializeQuery({ codes: codes.join(',') } satisfies InstrumentNamesRequestQuery);
  return request(`/api/app/market/instruments/names?${query}`);
}

// Index daily close (e.g. 000300.SH) over a range — benchmark curves in backtest results.
export function fetchIndexSeries(
  code: string,
  start: string,
  end: string,
): Promise<{ points: { date: string; close: number }[] }> {
  const query = serializeQuery({ start, end } satisfies InstrumentSeriesRequestQuery);
  return request(`/api/app/market/indices/${code}/series?${query}`);
}

export function fetchIndexValuationCatalog(signal?: AbortSignal): Promise<IndexValuationCatalog> {
  return request('/api/app/market/index-valuations', { signal });
}

export function fetchIndexValuationSeries(
  code: string,
  signal?: AbortSignal,
): Promise<IndexValuationSeries> {
  return request(`/api/app/market/index-valuations/${encodeURIComponent(code)}`, { signal });
}

export function fetchMarketWeather(
  dimension: MarketWeatherDimension,
  frequency: MarketWeatherFrequency,
  signal?: AbortSignal,
): Promise<MarketWeatherSeries> {
  const query = serializeQuery({ dimension, frequency } satisfies MarketWeatherRequestQuery);
  return request(`/api/app/market/weather?${query}`, { signal });
}
