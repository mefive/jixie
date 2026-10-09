import { expect, it } from 'vitest';
import { FactorAdapter } from './adapter.js';
import { AssetFactorContext, CrossSectionalFactorContext } from '../../sdk/typescript.js';

it('keeps point inputs bound when the same Factor adapter is reused', () => {
  const adapter = new FactorAdapter();
  const fields = { 'etf.adjustedClose': [10, 12, 15] };
  const declaredInputs = new Set(['etf.adjustedClose']);
  const first = new AssetFactorContext(
    adapter.bind({ kind: 'asset', fields, index: 1, declaredInputs }),
  );
  const second = new AssetFactorContext(
    adapter.bind({ kind: 'asset', fields, index: 2, declaredInputs }),
  );

  expect(first.value('etf.adjustedClose')).toBe(12);
  expect(second.value('etf.adjustedClose')).toBe(15);
  expect(first.lag('etf.adjustedClose', 1)).toBe(10);
  expect(() => second.value('rates.cgb.yield.2y')).toThrow('undeclared input');
});

it('binds cross-sectional history independently from asset inputs', () => {
  const adapter = new FactorAdapter();
  const context = new CrossSectionalFactorContext(
    adapter.bind({
      kind: 'cross_sectional',
      history: { closes: [10, 12], dates: ['20260105', '20260106'] },
    }),
  );
  const { history } = context;
  expect(history(1)).toEqual([12]);
  expect(history(2, 'date')).toEqual(['20260105', '20260106']);
});
