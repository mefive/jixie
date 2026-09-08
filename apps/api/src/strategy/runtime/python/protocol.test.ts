import { describe, expect, it } from 'vitest';
import { strategyStartupFrameSchema, strategyExecutionFrameSchema } from './protocol.js';

describe('strategy Python protocol', () => {
  it('accepts bounded strategy metadata from the runner', () => {
    expect(
      strategyStartupFrameSchema.parse({
        type: 'ready',
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
      strategyExecutionFrameSchema.parse({
        type: 'request',
        id: 1,
        method: 'bars',
        arguments: { codes: ['510300.SH'], unrestricted: true },
      }),
    ).toThrow();
  });

  it('rejects unknown or malformed trading commands', () => {
    expect(() =>
      strategyExecutionFrameSchema.parse({
        type: 'done',
        commands: [{ operation: 'shell', arguments: { command: 'id' } }],
      }),
    ).toThrow();
    expect(() =>
      strategyExecutionFrameSchema.parse({
        type: 'done',
        commands: [
          { operation: 'order_target_percent', arguments: { code: '510300.SH', weight: '1' } },
        ],
      }),
    ).toThrow();
  });
});
