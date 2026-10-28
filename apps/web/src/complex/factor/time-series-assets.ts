import type { FactorMeta } from '@jixie/shared';

export const TIME_SERIES_ASSET_OPTIONS = [
  { code: '510050.SH' },
  { code: '510300.SH' },
  { code: '563360.SH' },
  { code: '510500.SH' },
  { code: '512100.SH' },
  { code: '563300.SH' },
  { code: '159915.SZ' },
  { code: '588000.SH' },
  { code: '510880.SH' },
  { code: '159920.SZ' },
  { code: '513500.SH' },
  { code: '513100.SH' },
  { code: '511010.SH' },
  { code: '511260.SH' },
  { code: '511090.SH' },
  { code: '518880.SH' },
  { code: '159985.SZ' },
  { code: '159980.SZ' },
  { code: '159981.SZ' },
] as const;

export const TIME_SERIES_ASSETS = TIME_SERIES_ASSET_OPTIONS.map((asset) => asset.code);
export type TimeSeriesAsset = string;

export function defaultTimeSeriesAssetsFor(factor?: Pick<FactorMeta, 'defaultAssets'>): string[] {
  const configured = factor?.defaultAssets?.filter(isTimeSeriesAsset);

  return configured?.length ? [...new Set(configured)] : [...TIME_SERIES_ASSETS];
}

export function isTimeSeriesAsset(value: string): boolean {
  return /^\d{6}\.(SH|SZ)$/.test(value);
}
