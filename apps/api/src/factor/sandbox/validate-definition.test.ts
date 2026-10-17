import { describe, expect, it } from 'vitest';
import { validateFactorDefinition } from './validate-definition.js';

const CROSS_SECTIONAL = `export default defineFactor({
  name: 'EP',
  compute: (bar) => bar.peTtm && bar.peTtm > 0 ? 1 / bar.peTtm : null,
});`;

const TIME_SERIES = `export default defineFactorV2({
  version: 2,
  name: 'ETF trend',
  analysisKind: 'time_series',
  outputScope: 'asset',
  frequency: 'daily',
  inputs: ['etf.adjustedClose'],
  targetAssetClasses: ['equity', 'fixed_income', 'commodity'],
  window: 21,
  compute(ctx) {
    const current = ctx.value('etf.adjustedClose');
    const previous = ctx.lag('etf.adjustedClose', 20);
    return current != null && previous != null && previous > 0 ? current / previous - 1 : null;
  },
});`;
const PANEL = TIME_SERIES.replace("analysisKind: 'time_series'", "analysisKind: 'panel'");
const COMMODITY_CARRY_PANEL = PANEL.replaceAll(
  'etf.adjustedClose',
  'commodity.futures.annualizedLogCarry',
).replace(
  "targetAssetClasses: ['equity', 'fixed_income', 'commodity']",
  "targetAssetClasses: ['commodity']",
);
const COMMODITY_CARRY_TIME_SERIES = TIME_SERIES.replaceAll(
  'etf.adjustedClose',
  'commodity.futures.annualizedLogCarry',
).replace(
  "targetAssetClasses: ['equity', 'fixed_income', 'commodity']",
  "targetAssetClasses: ['commodity']",
);
const COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES = TIME_SERIES.replaceAll(
  'etf.adjustedClose',
  'commodity.warehouseReceipt.volume',
).replace(
  "targetAssetClasses: ['equity', 'fixed_income', 'commodity']",
  "targetAssetClasses: ['commodity']",
);

describe('validateFactorDefinition', () => {
  it('accepts definitions under their declared protocol', async () => {
    await expect(
      validateFactorDefinition(CROSS_SECTIONAL, 'cross_sectional'),
    ).resolves.toBeUndefined();
    await expect(validateFactorDefinition(TIME_SERIES, 'time_series')).resolves.toBeUndefined();
    await expect(validateFactorDefinition(PANEL, 'panel')).resolves.toBeUndefined();
  });

  it.each([
    ['cross_sectional', 'time_series', CROSS_SECTIONAL, /defineFactor is not defined/],
    ['cross_sectional', 'panel', CROSS_SECTIONAL, /defineFactor is not defined/],
    ['time_series', 'cross_sectional', TIME_SERIES, /defineFactorV2 is not defined/],
    ['panel', 'cross_sectional', PANEL, /defineFactorV2 is not defined/],
    ['time_series', 'panel', TIME_SERIES, /analysisKind=panel/],
    ['panel', 'time_series', PANEL, /analysisKind=time_series/],
  ] as const)(
    'rejects %s source under %s instead of guessing from its syntax',
    async (_sourceKind, targetKind, source, expectedError) => {
      await expect(validateFactorDefinition(source, targetKind)).rejects.toThrow(expectedError);
    },
  );

  it('keeps commodity carry confined to the controlled research template', async () => {
    await expect(validateFactorDefinition(COMMODITY_CARRY_PANEL, 'panel')).rejects.toThrow(
      /controlled template/,
    );
    await expect(
      validateFactorDefinition(COMMODITY_CARRY_TIME_SERIES, 'time_series'),
    ).rejects.toThrow(/controlled template/);
    await expect(
      validateFactorDefinition(COMMODITY_WAREHOUSE_RECEIPT_TIME_SERIES, 'time_series'),
    ).rejects.toThrow(/controlled template/);
  });
});
