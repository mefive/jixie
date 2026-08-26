import { describe, expect, it } from 'vitest';
import { DEFAULT_COST } from '../engine/types.js';
import { replayAccountDay } from './accounting.js';

const cost = { ...DEFAULT_COST, slippageBps: 20, impactCoef: 0 };

function order(
  overrides: Partial<{
    id: string;
    code: string;
    name: string;
    assetType: 'stock' | 'etf';
    action: 'buy' | 'sell';
    requestedShares: number;
    actualStatus: string;
    actualShares: number | null;
    actualPrice: number | null;
    actualFee: number | null;
  }> = {},
) {
  return {
    id: 'execution-1',
    code: '000001.SZ',
    name: 'Ping An Bank',
    assetType: 'stock' as const,
    action: 'buy' as const,
    requestedShares: 100,
    actualStatus: 'pending',
    actualShares: null,
    actualPrice: null,
    actualFee: null,
    ...overrides,
  };
}

function quote(
  overrides: Partial<{
    open: number | null;
    close: number | null;
    amount: number | null;
    upLimit: number | null;
    downLimit: number | null;
  }> = {},
) {
  return {
    open: 10,
    close: 10.5,
    amount: null,
    upLimit: 11,
    downLimit: 9,
    ...overrides,
  };
}

describe('strategy execution accounting replay', () => {
  it('simulates next-open fills with slippage, fees, and end-of-day marking', () => {
    const result = replayAccountDay(
      { cash: 100_000, positions: [] },
      [order()],
      new Map([['000001.SZ', quote()]]),
      '20240102',
      '20240103',
      cost,
      'simulation',
    );

    const fill = result.simulationUpdates[0];
    const position = result.state.positions[0];
    expect(fill).toMatchObject({ status: 'filled', shares: 100 });
    expect(fill.price).toBeCloseTo(10.02, 10);
    expect(fill.slippage).toBeCloseTo(2, 10);
    expect(fill.fee).toBeCloseTo(5.01002, 8);
    expect(position).toMatchObject({
      code: '000001.SZ',
      shares: 100,
      markPrice: 10.5,
      sellableFrom: '20240103',
    });
    expect(result.state.cash).toBeCloseTo(100_000 - 1002 - 5.01002, 8);
  });

  it('blocks suspension and sealed price-limit orders without carrying them forward', () => {
    const suspended = replayAccountDay(
      { cash: 100_000, positions: [] },
      [order()],
      new Map(),
      '20240102',
      '20240103',
      cost,
      'simulation',
    );
    const upperLimit = replayAccountDay(
      { cash: 100_000, positions: [] },
      [order()],
      new Map([['000001.SZ', quote({ open: 11, close: 11 })]]),
      '20240102',
      '20240103',
      cost,
      'simulation',
    );

    expect(suspended.simulationUpdates[0]).toMatchObject({
      status: 'blocked',
      reason: 'suspended',
    });
    expect(upperLimit.simulationUpdates[0]).toMatchObject({
      status: 'blocked',
      reason: 'up_limit',
    });
    expect(suspended.state.positions).toHaveLength(0);
    expect(upperLimit.state.positions).toHaveLength(0);
  });

  it('enforces T+1 on simulated sells', () => {
    const result = replayAccountDay(
      {
        cash: 90_000,
        positions: [
          {
            code: '000001.SZ',
            name: 'Ping An Bank',
            assetType: 'stock',
            shares: 100,
            avgCost: 10,
            markPrice: 10,
            sellableFrom: '20240103',
          },
        ],
      },
      [order({ action: 'sell' })],
      new Map([['000001.SZ', quote()]]),
      '20240102',
      '20240103',
      cost,
      'simulation',
    );

    expect(result.simulationUpdates[0]).toMatchObject({
      status: 'blocked',
      reason: 'position_unavailable',
    });
    expect(result.state.positions[0].shares).toBe(100);
  });

  it('allows the older T+1 layer to sell while retaining newly frozen shares', () => {
    const result = replayAccountDay(
      {
        cash: 97_000,
        positions: [
          {
            code: '000001.SZ',
            name: 'Ping An Bank',
            assetType: 'stock',
            shares: 300,
            avgCost: 10,
            markPrice: 10,
            sellableFrom: '20240103',
            frozenShares: 100,
          },
        ],
      },
      [order({ action: 'sell', requestedShares: 300 })],
      new Map([['000001.SZ', quote()]]),
      '20240102',
      '20240103',
      cost,
      'simulation',
    );

    expect(result.simulationUpdates[0]).toMatchObject({
      status: 'filled',
      shares: 200,
      reason: 'partial',
    });
    expect(result.state.positions[0]).toMatchObject({ shares: 100, frozenShares: 100 });
  });

  it('includes minimum commission before accepting a whole-lot simulated buy', () => {
    const result = replayAccountDay(
      { cash: 1_004, positions: [] },
      [order()],
      new Map([['000001.SZ', quote({ close: 10 })]]),
      '20240102',
      '20240103',
      { ...cost, slippageBps: 0 },
      'simulation',
    );

    expect(result.simulationUpdates[0]).toMatchObject({
      status: 'blocked',
      reason: 'insufficient_cash',
    });
    expect(result.state.cash).toBe(1_004);
    expect(result.state.positions).toHaveLength(0);
  });

  it('replays only user-confirmed actual fills at the entered price and fee', () => {
    const result = replayAccountDay(
      { cash: 100_000, positions: [] },
      [
        order({
          actualStatus: 'filled',
          actualShares: 100,
          actualPrice: 10.08,
          actualFee: 6,
        }),
        order({
          id: 'execution-2',
          code: '510300.SH',
          assetType: 'etf',
          actualStatus: 'skipped',
        }),
      ],
      new Map([
        ['000001.SZ', quote()],
        ['510300.SH', quote({ open: 4, close: 4.1 })],
      ]),
      '20240102',
      '20240103',
      cost,
      'actual',
    );

    expect(result.state.cash).toBe(100_000 - 1008 - 6);
    expect(result.state.positions).toHaveLength(1);
    expect(result.state.positions[0]).toMatchObject({
      code: '000001.SZ',
      shares: 100,
      markPrice: 10.5,
    });
    expect(result.simulationUpdates).toHaveLength(0);
  });
});
