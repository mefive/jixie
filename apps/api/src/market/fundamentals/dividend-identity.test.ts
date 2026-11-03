import { expect, it } from 'vitest';
import {
  DIVIDEND_SOURCE_FIELDS,
  dividendDistributionKind,
  dividendIdentityResolver,
  dividendReceiptHasCompleteFields,
} from './dividend-identity.js';

const identity = {
  tsCode: '002326.SZ',
  endDate: '20181231',
  annDate: '20190720',
  exDate: null,
  divProc: '预案',
};

it('uses distribution shape, never monetary amounts or share ratios, in source identities', () => {
  const resolve = dividendIdentityResolver([], []);
  const cash = { ...identity, distributionKind: 'cash', cashDivTax: 0.15 };
  const first = resolve(cash);
  expect(resolve({ ...cash, cashDivTax: 0.16 }).id).toBe(first.id);
  expect(resolve({ ...cash, baseShare: 1 }).id).toBe(first.id);
  const shares = { ...identity, distributionKind: 'shares', stockDividend: 0.12 };
  expect(resolve(shares).id).not.toBe(first.id);
  expect(resolve({ ...shares, stockDividend: 0.13 }).id).toBe(resolve(shares).id);
  expect(resolve({ ...cash, distributionKind: 'mixed', stockDividend: 0.12 }).id).not.toBe(
    first.id,
  );
});

it('classifies total shares and their components without adding them or filling missing cash', () => {
  expect(dividendDistributionKind({ cashDivTax: 0.15, stockDividend: 0 })).toBe('cash');
  expect(dividendDistributionKind({ cashDivTax: null, stockCapitalizationRate: 0.12 })).toBe(
    'shares',
  );
  expect(dividendDistributionKind({ cashDivTax: 0.15, stockDividend: 0.12 })).toBe('mixed');
  expect(dividendDistributionKind({ cashDivTax: 0, stockDividend: 0 })).toBe('none');
  expect(dividendDistributionKind({ cashDivTax: null, stockDividend: null })).toBe('unspecified');
});

it('binds an old five-part ID only to the uniquely compatible distribution', () => {
  const cash = { ...identity, distributionKind: 'cash', cashDivTax: 0.15, baseShare: 82009.3827 };
  const shares = { ...identity, distributionKind: 'shares', cashDivTax: 0, baseShare: 51277.8827 };
  const resolve = dividendIdentityResolver(
    [{ ...identity, id: 'old', cashDivTax: 0.15 }],
    [cash, shares],
  );
  expect(resolve(cash).id).toBe('old');
  expect(resolve(shares).id).not.toBe('old');
  const ambiguous = dividendIdentityResolver([{ ...identity, id: 'unknown' }], [cash, shares]);
  expect(() => ambiguous(cash)).toThrow('Ambiguous legacy');
});

it('keeps a unique legacy ID through revisions and protects a known shape from missing values', () => {
  const row = { ...identity, distributionKind: 'cash', cashDivTax: 0.15 };
  const legacy = dividendIdentityResolver([{ ...identity, id: 'old', cashDivTax: 0.14 }], [row]);
  expect(legacy(row).id).toBe('old');
  const known = dividendIdentityResolver([{ ...row, id: 'known' }], []);
  expect(known({ ...identity, distributionKind: 'unspecified' })).toMatchObject({
    id: 'known',
    distributionKind: 'cash',
  });
});

it('reuses only receipts containing the actual full dividend field request for all source aliases', () => {
  const request = {
    api: 'dividend',
    params: { ts_code: '002326.SZ' },
    fields: DIVIDEND_SOURCE_FIELDS,
  };
  expect(dividendReceiptHasCompleteFields([request])).toBe(true);
  expect(
    dividendReceiptHasCompleteFields([{ ...request, fields: 'ts_code,end_date,cash_div_tax' }]),
  ).toBe(false);
  expect(dividendReceiptHasCompleteFields([request, { ...request, fields: 'ts_code' }])).toBe(
    false,
  );
  for (const value of [null, {}, [], 'bad', [{ api: 'daily', fields: DIVIDEND_SOURCE_FIELDS }]]) {
    expect(dividendReceiptHasCompleteFields(value)).toBe(false);
  }
});

it('does not create another identity to bypass base precedence when amounts become zero or missing', () => {
  const cash = { ...identity, id: 'known-cash', distributionKind: 'cash', cashDivTax: 0.15 };
  const resolve = dividendIdentityResolver([cash], []);
  expect(resolve({ ...identity, distributionKind: 'none', cashDivTax: 0 }).id).toBe('known-cash');
  const unknown = dividendIdentityResolver(
    [cash, { ...cash, id: 'shares', distributionKind: 'shares' }],
    [],
  );
  expect(() => unknown({ ...identity, distributionKind: 'unspecified' })).toThrow('Ambiguous');
  const filled = { ...identity, distributionKind: 'cash', cashDivTax: 0.15 };
  expect(
    dividendIdentityResolver(
      [{ ...identity, id: 'zero', distributionKind: 'none' }],
      [filled],
    )(filled).id,
  ).toBe('zero');
});
