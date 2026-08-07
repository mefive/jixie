export type FactorV2FieldKey = 'etf.adjustedClose';

export interface FactorV2FieldDefinition {
  key: FactorV2FieldKey;
  frequency: 'daily';
  valueType: 'level';
  pointInTime: true;
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
}

/** The first executable V2 field registry. Monaco and Agent documentation can consume the same
 * metadata once authoring is opened; the worker already uses it as a strict compile-time allowlist. */
export const FACTOR_V2_FIELDS: Record<FactorV2FieldKey, FactorV2FieldDefinition> = {
  'etf.adjustedClose': {
    key: 'etf.adjustedClose',
    frequency: 'daily',
    valueType: 'level',
    pointInTime: true,
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  },
};

export function isFactorV2FieldKey(value: string): value is FactorV2FieldKey {
  return Object.hasOwn(FACTOR_V2_FIELDS, value);
}
