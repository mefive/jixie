import type { FactorMeta } from '@jixie/shared';

export const TIME_SERIES_ASSET_OPTIONS = [
  { code: '510050.SH', assetClass: 'equity' },
  { code: '510300.SH', assetClass: 'equity' },
  { code: '563360.SH', assetClass: 'equity' },
  { code: '510500.SH', assetClass: 'equity' },
  { code: '512100.SH', assetClass: 'equity' },
  { code: '563300.SH', assetClass: 'equity' },
  { code: '159915.SZ', assetClass: 'equity' },
  { code: '588000.SH', assetClass: 'equity' },
  { code: '510880.SH', assetClass: 'equity' },
  { code: '159920.SZ', assetClass: 'equity' },
  { code: '513500.SH', assetClass: 'equity' },
  { code: '513100.SH', assetClass: 'equity' },
  { code: '511010.SH', assetClass: 'fixed_income' },
  { code: '511260.SH', assetClass: 'fixed_income' },
  { code: '511090.SH', assetClass: 'fixed_income' },
  { code: '518880.SH', assetClass: 'commodity' },
  { code: '159985.SZ', assetClass: 'commodity' },
  { code: '159980.SZ', assetClass: 'commodity' },
  { code: '159981.SZ', assetClass: 'commodity' },
] as const;

export const TIME_SERIES_ASSETS = TIME_SERIES_ASSET_OPTIONS.map((asset) => asset.code);
export type TimeSeriesAsset = (typeof TIME_SERIES_ASSETS)[number];

export function allowedTimeSeriesAssetsFor(
  factor?: Pick<FactorMeta, 'allowedAssets' | 'targetAssetClasses'>,
): TimeSeriesAsset[] {
  const configured = factor?.allowedAssets?.filter(isTimeSeriesAsset);
  if (configured?.length) {
    return [...new Set(configured)];
  }

  const allowedClasses = new Set(
    factor?.targetAssetClasses ?? ['equity', 'fixed_income', 'commodity'],
  );
  return TIME_SERIES_ASSET_OPTIONS.filter((asset) => allowedClasses.has(asset.assetClass)).map(
    (asset) => asset.code,
  );
}

export function defaultTimeSeriesAssetsFor(
  factor?: Pick<FactorMeta, 'allowedAssets' | 'defaultAssets' | 'targetAssetClasses'>,
): TimeSeriesAsset[] {
  const allowed = allowedTimeSeriesAssetsFor(factor);
  const allowedSet = new Set(allowed);
  const configured = factor?.defaultAssets?.filter(
    (asset): asset is TimeSeriesAsset => isTimeSeriesAsset(asset) && allowedSet.has(asset),
  );
  return configured?.length ? [...new Set(configured)] : allowed;
}

export function isTimeSeriesAsset(value: string): value is TimeSeriesAsset {
  return TIME_SERIES_ASSETS.includes(value as TimeSeriesAsset);
}
