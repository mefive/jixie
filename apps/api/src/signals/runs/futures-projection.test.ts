import { describe, expect, it } from 'vitest';
import { EngineData } from '#backtesting/data/engine-data.js';
import { fixturePort } from '#backtesting/testing/fixture-port.js';
import { DEFAULT_COST } from '#backtesting/cost.js';
import type { SignalAccounts } from '@jixie/shared';
import { futureSignalReference } from './futures-projection.js';

const accounts: SignalAccounts = {
  version: 2,
  date: '20260618',
  cash: 0,
  positions: [],
  futures: { equity: 1000000, margin: 0, availableCash: 1000000, positions: [] },
  equity: 1000000,
  conditions: [],
  consumedConditions: [],
  risk: [],
};
async function market(mappingDate = '20260618') {
  const data = new EngineData({
    start: '20260617',
    end: '20260618',
    dataPort: fixturePort({
      dates: ['20260617', '20260618', '20260619'],
      stocks: [],
      futureContracts: [
        {
          tsCode: 'IF2607.CFX',
          productCode: 'IF',
          multiplier: 300,
          listDate: '20260101',
          delistDate: '20260717',
        },
      ],
      futureDaily: [
        {
          tsCode: 'IF2607.CFX',
          tradeDate: '20260618',
          open: 4000,
          high: 4000,
          low: 4000,
          close: 4000,
          settle: 4000,
          volume: 1,
          amount: 1,
          openInterest: 1,
        },
      ],
      futureMappings: [
        { continuousCode: 'IF.CFX', tradeDate: mappingDate, mappedTsCode: 'IF2607.CFX' },
      ],
    }),
  });
  await data.load();

  return data;
}

describe('futures reference projection', () => {
  it('supports direct delivery codes without a continuous mapping and preserves zero hedges', async () => {
    const data = await market();
    const reference = futureSignalReference({
      code: 'IF2607.CFX',
      intent: { kind: 'hedge', value: 1 },
      accounts,
      data,
      decisionDate: '20260618',
      execDate: '20260619',
      cost: DEFAULT_COST,
    });
    expect(reference.intent).toEqual({ kind: 'hedge', value: 1 });
    expect(reference.referenceTargetContracts).toBe(0);
    expect(reference.referenceLegs).toEqual([]);
  });

  it('rejects stale continuous mappings instead of silently using their previous value', async () => {
    const data = await market('20260617');
    expect(() =>
      futureSignalReference({
        code: 'IF.CFX',
        intent: { kind: 'notional', value: 2400000 },
        accounts,
        data,
        decisionDate: '20260618',
        execDate: '20260619',
        cost: DEFAULT_COST,
      }),
    ).toThrow();
  });
});
