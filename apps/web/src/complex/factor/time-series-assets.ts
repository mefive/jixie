import type { FactorMeta } from '@jixie/shared';

export const TIME_SERIES_ASSET_OPTIONS = [
  { code: '511010.SH', assetClass: 'fixed_income' },
  { code: '511260.SH', assetClass: 'fixed_income' },
  { code: '511090.SH', assetClass: 'fixed_income' },
  { code: '518880.SH', assetClass: 'commodity' },
  { code: '159985.SZ', assetClass: 'commodity' },
  { code: '159980.SZ', assetClass: 'commodity' },
  { code: '159981.SZ', assetClass: 'commodity' },
  { code: '510300.SH', assetClass: 'equity' },
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
