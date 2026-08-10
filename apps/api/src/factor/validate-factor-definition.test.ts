import { describe, expect, it } from 'vitest';
import { validateFactorDefinition } from './validate-factor-definition.js';

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

describe('validateFactorDefinition', () => {
  it('accepts definitions under their declared protocol', async () => {
    await expect(
      validateFactorDefinition(CROSS_SECTIONAL, 'cross_sectional'),
    ).resolves.toBeUndefined();
    await expect(validateFactorDefinition(TIME_SERIES, 'time_series')).resolves.toBeUndefined();
    await expect(validateFactorDefinition(PANEL, 'panel')).resolves.toBeUndefined();
  });

  it('rejects cross-protocol source instead of guessing from its syntax', async () => {
    await expect(validateFactorDefinition(CROSS_SECTIONAL, 'time_series')).rejects.toThrow(
      /defineFactor is not defined/,
    );
    await expect(validateFactorDefinition(TIME_SERIES, 'cross_sectional')).rejects.toThrow(
      /defineFactorV2 is not defined/,
    );
    await expect(validateFactorDefinition(TIME_SERIES, 'panel')).rejects.toThrow(
      /analysisKind=panel/,
    );
  });

  it('keeps commodity carry confined to the controlled research template', async () => {
    await expect(validateFactorDefinition(COMMODITY_CARRY_PANEL, 'panel')).rejects.toThrow(
      /controlled template/,
    );
    await expect(
      validateFactorDefinition(COMMODITY_CARRY_TIME_SERIES, 'time_series'),
    ).rejects.toThrow(/controlled template/);
  });
});
