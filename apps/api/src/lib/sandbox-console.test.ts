import { describe, expect, it } from 'vitest';
import type { LogLevel } from '@jixie/shared';
import { makeSandboxConsole } from './sandbox-console.js';

// Collect what the shim forwards, so we can assert level mapping, formatting, and the line cap.
function sink() {
  const lines: { level: LogLevel; text: string }[] = [];
  return { lines, fn: (level: LogLevel, text: string) => lines.push({ level, text }) };
}

describe('makeSandboxConsole', () => {
  it('maps console methods to levels and formats args', () => {
    const { lines, fn } = sink();
    const console = makeSandboxConsole(fn);
    console.log('bar', 42, { a: 1 });
    console.info('note');
    console.warn('careful');
    console.error('boom');

    expect(lines).toEqual([
      { level: 'info', text: 'bar 42 {"a":1}' },
      { level: 'info', text: 'note' },
      { level: 'warn', text: 'careful' },
      { level: 'error', text: 'boom' },
    ]);
  });

  it('caps output and emits a single truncation notice', () => {
    const { lines, fn } = sink();
    const console = makeSandboxConsole(fn, 3);
    for (let i = 0; i < 100; i++) {
      console.log('line', i);
    }

    // 3 real lines + exactly one truncation warning, then silence.
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).map((line) => line.text)).toEqual(['line 0', 'line 1', 'line 2']);
    expect(lines[3].level).toBe('warn');
    expect(lines[3].text).toContain('省略');
  });
});
