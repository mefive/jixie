import { describe, expect, it, vi } from 'vitest';
import { SandboxLogBuffer, MAX_LOG_BATCH_BYTES, MAX_LOG_BATCH_ENTRIES } from './log-buffer.js';

describe('sandbox-side log buffering', () => {
  it('emits a full batch followed by the remaining tail, preserving levels and order', () => {
    const emit = vi.fn();
    const buffer = new SandboxLogBuffer(emit);
    for (let index = 0; index < MAX_LOG_BATCH_ENTRIES; index++) {
      buffer.append('info', String(index));
    }
    expect(emit).toHaveBeenCalledOnce();
    buffer.append('warning', 'tail');
    expect(emit).toHaveBeenCalledOnce();
    buffer.flush();
    buffer.flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls.map(([json]) => JSON.parse(json))).toEqual([
      {
        type: 'log_batch',
        entries: Array.from({ length: MAX_LOG_BATCH_ENTRIES }, (_, index) => ({
          level: 'info',
          text: String(index),
        })),
      },
      { type: 'log_batch', entries: [{ level: 'warning', text: 'tail' }] },
    ]);
  });

  it('bounds serialized UTF-8 bytes, including multibyte text, JSON escapes and envelopes', () => {
    const packets: string[] = [];
    const buffer = new SandboxLogBuffer((json) => packets.push(json));
    const text = '量😀\\\n"\ud800'.repeat(120);
    for (let index = 0; index < 100; index++) {
      buffer.append('info', text);
    }
    buffer.flush();
    expect(packets.length).toBeGreaterThan(1);
    expect(packets.every((json) => Buffer.byteLength(json) <= MAX_LOG_BATCH_BYTES)).toBe(true);
    expect(packets.flatMap((json) => JSON.parse(json).entries)).toEqual(
      Array.from({ length: 100 }, () => ({ level: 'info', text })),
    );
  });

  it('sends an oversized line separately without truncating it or reordering adjacent batches', () => {
    const packets: string[] = [];
    const buffer = new SandboxLogBuffer((json) => packets.push(json));
    const large = 'x'.repeat(MAX_LOG_BATCH_BYTES);
    buffer.append('info', 'before');
    buffer.append('error', large);
    buffer.append('warning', 'after');
    buffer.flush();
    expect(packets.map((json) => JSON.parse(json))).toEqual([
      { type: 'log_batch', entries: [{ level: 'info', text: 'before' }] },
      { type: 'log', level: 'error', text: large },
      { type: 'log_batch', entries: [{ level: 'warning', text: 'after' }] },
    ]);
  });

  it('does not resend a failed batch while unwinding the command', () => {
    const failure = new Error('transport unavailable');
    const emit = vi.fn(() => {
      throw failure;
    });
    const buffer = new SandboxLogBuffer(emit);
    buffer.append('info', 'pending');
    expect(() => buffer.flush()).toThrow(failure);
    buffer.flush();
    expect(emit).toHaveBeenCalledOnce();
  });
});
