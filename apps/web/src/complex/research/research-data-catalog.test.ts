import assert from 'node:assert/strict';
import test from 'node:test';
import { researchSeriesSnippet, researchSeriesVariableName } from './research-data-catalog';

const instrument = {
  kind: 'instrument' as const,
  assetType: 'index' as const,
  identifier: '000300.SH',
  nameZh: '沪深300',
  tags: ['规模指数'],
  compatibleMeasureIds: ['market.adjusted_close'],
};

test('creates a valid and stable Python variable name', () => {
  assert.equal(researchSeriesVariableName(instrument), 'index_000300_sh');
});

test('inserts the platform SDK call with explicit research semantics', () => {
  assert.equal(
    researchSeriesSnippet({
      instrument,
      measure: 'market.adjusted_close',
      start: '20200101',
      end: '20251231',
      frequency: 'monthly',
      transform: 'simple_return',
    }),
    `index_000300_sh = data.series(
    "index",
    "000300.SH",
    start="20200101",
    end="20251231",
    measure="market.adjusted_close",
    frequency="monthly",
    transform="simple_return",
)`,
  );
});
