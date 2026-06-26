import { describe, expect, it } from 'vitest';
import type { Condition, IndExpr } from '@jixie/shared';
import type { OhlcBar } from '../../engine/types.js';
import { evalCondition, evalIndExpr, maxWindow } from './ind-expr.js';

const bar = (o: number, h: number, l: number, c: number): OhlcBar => ({
  date: '',
  adjOpen: o,
  adjHigh: h,
  adjLow: l,
  adjClose: c,
});

// 4 ascending bars; the last is "today".
const bars: OhlcBar[] = [
  bar(10, 11, 9, 10),
  bar(11, 13, 11, 12),
  bar(10, 12, 10, 11),
  bar(13, 15, 13, 14), // today
];
const scope = { bars };

describe('evalIndExpr', () => {
  it('price = today adjusted close', () => {
    expect(evalIndExpr({ kind: 'price' }, scope)).toBe(14);
  });

  it('highest/lowest scan the n bars BEFORE today (Donchian)', () => {
    expect(evalIndExpr({ kind: 'indicator', name: 'highest', field: 'high', window: 3 }, scope)).toBe(13);
    expect(evalIndExpr({ kind: 'indicator', name: 'lowest', field: 'low', window: 3 }, scope)).toBe(9);
  });

  it('sma over the last n bars (incl today)', () => {
    expect(evalIndExpr({ kind: 'indicator', name: 'sma', field: 'close', window: 4 }, scope)).toBeCloseTo(11.75);
  });

  it('atr = average true range over last n', () => {
    // TR(day2,3,4) = 3,2,4 → mean 3
    expect(evalIndExpr({ kind: 'indicator', name: 'atr', window: 3 }, scope)).toBeCloseTo(3);
  });

  it('not-enough-bars → NaN', () => {
    expect(evalIndExpr({ kind: 'indicator', name: 'highest', field: 'high', window: 10 }, scope)).toBeNaN();
  });

  it('binary arithmetic over indicators', () => {
    const e: IndExpr = {
      kind: 'binary',
      op: '-',
      left: { kind: 'price' },
      right: { kind: 'indicator', name: 'sma', field: 'close', window: 4 },
    };
    expect(evalIndExpr(e, scope)).toBeCloseTo(2.25);
  });
});

describe('evalCondition', () => {
  const breakout: Condition = {
    kind: 'compare',
    op: '>',
    left: { kind: 'price' },
    right: { kind: 'indicator', name: 'highest', field: 'high', window: 3 },
  };

  it('compare: 14 > 13 → true (a breakout)', () => {
    expect(evalCondition(breakout, scope)).toBe(true);
  });

  it('a comparison with a missing (NaN) side is false (warming up)', () => {
    const cold: Condition = {
      kind: 'compare',
      op: '>',
      left: { kind: 'price' },
      right: { kind: 'indicator', name: 'highest', field: 'high', window: 10 },
    };
    expect(evalCondition(cold, scope)).toBe(false);
  });

  it('and / or / not', () => {
    const big: Condition = { kind: 'compare', op: '>', left: { kind: 'price' }, right: { kind: 'const', value: 100 } };
    expect(evalCondition({ kind: 'and', args: [breakout, big] }, scope)).toBe(false);
    expect(evalCondition({ kind: 'or', args: [breakout, big] }, scope)).toBe(true);
    expect(evalCondition({ kind: 'not', arg: breakout }, scope)).toBe(false);
  });
});

describe('maxWindow', () => {
  it('finds the largest indicator window across the given conditions', () => {
    const entry: Condition = { kind: 'compare', op: '>', left: { kind: 'price' }, right: { kind: 'indicator', name: 'highest', field: 'high', window: 20 } };
    const exit: Condition = { kind: 'compare', op: '<', left: { kind: 'price' }, right: { kind: 'indicator', name: 'lowest', field: 'low', window: 55 } };
    expect(maxWindow(entry, exit)).toBe(55);
  });
});
