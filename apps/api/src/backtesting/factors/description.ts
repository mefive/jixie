import type { MultiAssetClass } from '@jixie/shared';
import type { FactorDefinition, FactorDescription } from './execution-port.js';

/**
 * 归纳因子的证券范围、数据需求和资产类别，供模拟预载与求值准备使用。
 *
 * Summarize factor universes, input requirements and asset classes for simulation preparation.
 */
export function describeFactors(definitions: FactorDefinition[]): FactorDescription {
  const requirements = {
    turnoverRateFHistory: false,
    fundamentalHistory: false,
    governmentYieldCurve: false,
  };
  const assetClassByCode = new Map<string, MultiAssetClass>();

  for (const definition of definitions) {
    for (const asset of ('assetUniverse' in definition ? definition.assetUniverse : undefined) ??
      []) {
      const existing = assetClassByCode.get(asset.assetId);
      if (existing && existing !== asset.assetClass) {
        throw new Error(`conflicting asset classes for ${asset.assetId}`);
      }
      assetClassByCode.set(asset.assetId, asset.assetClass);
    }

    switch (definition.kind) {
      case 'cross_sectional':
        requirements.turnoverRateFHistory ||= definition.historyFields.includes('turnoverRateF');
        requirements.fundamentalHistory ||= definition.historyFields.some(
          (field) => field === 'roe' || field === 'grossprofitMargin',
        );
        break;
      case 'asset_series':
        requirements.governmentYieldCurve ||= definition.meta.inputs.some((field) =>
          field.startsWith('rates.cgb.yield.'),
        );
        break;
    }
  }

  return {
    definitions,
    dataRequirements: requirements,
    preloadCodes: [...assetClassByCode.keys()],
    assetClassByCode,
  };
}
