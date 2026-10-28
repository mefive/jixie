/**
 * 限定资产因子可声明输入字段，供契约与元数据校验。
 *
 * Restrict asset-factor input fields accepted by contract validation.
 */
export type FactorV2FieldKey = 'etf.adjustedClose';

/**
 * 描述因子字段的来源、单位和历史语义，供作者输入说明。
 *
 * Describe a factor field's source, units and history semantics.
 */
export interface FactorV2FieldDefinition {
  key: FactorV2FieldKey;
  inputDomain: 'price';
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
    inputDomain: 'price',
    frequency: 'daily',
    valueType: 'level',
    pointInTime: true,
    targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  },
};

export function isFactorV2FieldKey(value: string): value is FactorV2FieldKey {
  return Object.hasOwn(FACTOR_V2_FIELDS, value);
}
