import { describe, expect, it } from 'vitest';
import {
  factorExecutionFrameSchema,
  researchExecutionFrameSchema,
  strategyExecutionFrameSchema,
  strategyStartupFrameSchema,
} from './protocol.js';

describe('Python host protocol schemas', () => {
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

  it('requires finite, nullable Factor values without extra payload fields', () => {
    expect(
      factorExecutionFrameSchema.parse({
        type: 'factor_values',
        values: [1.2, null],
        first_error: null,
      }),
    ).toMatchObject({ type: 'factor_values' });
    expect(() =>
      factorExecutionFrameSchema.parse({
        type: 'factor_values',
        values: [Number.POSITIVE_INFINITY],
        first_error: null,
      }),
    ).toThrow();
  });

  it('rejects unrecognized Research output fields and request methods', () => {
    expect(() =>
      researchExecutionFrameSchema.parse({
        type: 'research_executed',
        outputs: [{ type: 'text', text: 'result', executable: true }],
        definitions: [],
        references: [],
      }),
    ).toThrow();
    expect(() =>
      researchExecutionFrameSchema.parse({
        type: 'request',
        id: 1,
        method: 'read_file',
        arguments: { path: '/etc/passwd' },
      }),
    ).toThrow();
  });
});
