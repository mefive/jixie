import { describe, expect, it } from 'vitest';
import {
  strategyStartupFrameSchema,
  strategyDecisionFrameSchema,
  strategyCommandSchema,
} from './protocol.js';

describe('strategy sandbox protocol', () => {
  it('accepts bounded strategy metadata from the runner', () => {
    expect(
      strategyStartupFrameSchema.parse({
        type: 'ready',
        command_mode: 'synchronous',
        metadata: {
          name: 'value strategy',
          params: { lookback: 20, universe: '000300.SH' },
          factors: ['value'],
          watch: ['510300.SH'],
          futures: [],
          accounts: null,
        },
      }),
    ).toMatchObject({ type: 'ready' });
  });

  it('rejects extra fields on governed strategy requests', () => {
    expect(() =>
      strategyDecisionFrameSchema.parse({
        type: 'request',
        id: 1,
        method: 'bars',
        arguments: { codes: ['510300.SH'], unrestricted: true },
      }),
    ).toThrow();
  });

  it('rejects unknown or malformed trading commands', () => {
    expect(() =>
      strategyCommandSchema.parse({
        operation: 'shell',
        arguments: { command: 'id' },
      }),
    ).toThrow();
    expect(() =>
      strategyCommandSchema.parse({
        operation: 'stock.setTargetWeight',
        arguments: { code: '510300.SH', weight: '1' },
      }),
    ).toThrow();
  });

  it('keeps the command envelope separate from recoverable command validation', () => {
    const request = {
      type: 'request',
      id: 1,
      method: 'command',
      arguments: { operation: 'stock.setTargetWeight', arguments: { code: 'AAA', weight: 'bad' } },
    };

    expect(strategyDecisionFrameSchema.parse(request)).toEqual(request);
    expect(strategyCommandSchema.safeParse(request.arguments).success).toBe(false);

    for (const malformed of [
      { ...request, id: 0 },
      { ...request, arguments: null },
      { ...request, unrestricted: true },
      { ...request, method: 'arbitrary_access' },
    ]) {
      expect(strategyDecisionFrameSchema.safeParse(malformed).success).toBe(false);
    }
  });

  it('accepts completion without a deferred command batch and rejects the old payload', () => {
    expect(strategyDecisionFrameSchema.parse({ type: 'done' })).toEqual({ type: 'done' });
    expect(strategyDecisionFrameSchema.safeParse({ type: 'done', commands: [] }).success).toBe(
      false,
    );
  });
});
