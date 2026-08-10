export type FactorV2FieldKey =
  | 'etf.adjustedClose'
  | 'rates.cgb.yield.2y'
  | 'rates.cgb.yield.5y'
  | 'rates.cgb.yield.10y'
  | 'rates.cgb.yield.30y'
  | 'commodity.futures.annualizedLogCarry';

export const COMMODITY_CARRY_PANEL_FIELD = 'commodity.futures.annualizedLogCarry' as const;

export interface FactorV2FieldDefinition {
  key: FactorV2FieldKey;
  inputDomain: 'price' | 'fundamental' | 'flow' | 'rates' | 'commodity' | 'macro';
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
  'rates.cgb.yield.2y': rateField('rates.cgb.yield.2y'),
  'rates.cgb.yield.5y': rateField('rates.cgb.yield.5y'),
  'rates.cgb.yield.10y': rateField('rates.cgb.yield.10y'),
  'rates.cgb.yield.30y': rateField('rates.cgb.yield.30y'),
  'commodity.futures.annualizedLogCarry': {
    key: 'commodity.futures.annualizedLogCarry',
    inputDomain: 'commodity',
    frequency: 'daily',
    valueType: 'level',
    pointInTime: true,
    targetAssetClasses: ['commodity'],
  },
};

function rateField(key: FactorV2FieldKey): FactorV2FieldDefinition {
  return {
    key,
    inputDomain: 'rates',
    frequency: 'daily',
    valueType: 'level',
    pointInTime: true,
    targetAssetClasses: ['fixed_income'],
  };
}

export function factorV2YieldTerm(field: FactorV2FieldKey): number | null {
  const match = field.match(/^rates\.cgb\.yield\.(2|5|10|30)y$/);
  return match ? Number(match[1]) : null;
}

export function isFactorV2FieldKey(value: string): value is FactorV2FieldKey {
  return Object.hasOwn(FACTOR_V2_FIELDS, value);
}
