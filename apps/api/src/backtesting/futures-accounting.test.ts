import { describe, expect, it } from 'vitest';
import { applyFutureFill, settleFuturePosition } from './futures-accounting.js';

const position = {
  code: 'IF.CFX',
  actualCode: 'IF2406.CFX',
  contracts: -3,
  referencePrice: 4000,
  multiplier: 300,
  margin: 432000,
};
const fill = {
  code: position.code,
  actualCode: position.actualCode,
  multiplier: 300,
  marginRate: 0.12,
  fee: 10,
};

describe('shared futures accounting', () => {
  it('realizes only closed contracts, preserves remaining basis and deducts fees once', () => {
    const reduced = applyFutureFill({ ...fill, position, delta: 1, price: 3900 });
    expect(reduced.equityChange).toBe(29990);
    expect(reduced.position).toMatchObject({ contracts: -2, referencePrice: 4000 });
    const settled = settleFuturePosition(reduced.position!, 3950, 0.12);
    expect(settled.equityChange).toBe(30000);
    expect(settleFuturePosition(settled.position, 3950, 0.12).equityChange).toBeCloseTo(0, 10);
  });

  it('weights additions and resets the basis after a reversal', () => {
    const added = applyFutureFill({ ...fill, position, delta: -1, price: 4200 });
    expect(added.position?.referencePrice).toBe(4050);
    const reversed = applyFutureFill({ ...fill, position, delta: 5, price: 3900 });
    expect(reversed.equityChange).toBe(89990);
    expect(reversed.position).toMatchObject({ contracts: 2, referencePrice: 3900 });
  });
});
