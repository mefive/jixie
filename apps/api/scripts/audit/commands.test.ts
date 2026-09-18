import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditCommands, parseAuditArguments } from './commands.js';

describe('audit task selection', () => {
  it('shows family and task help without selecting any execution', () => {
    for (const args of [[], ['--help'], ['--list']]) {
      expect(parseAuditArguments(args)).toEqual({ action: 'help' });
    }
    for (const command of auditCommands) {
      expect(parseAuditArguments([command.name, '--help'])).toEqual({ action: 'help', command });
    }
  });

  it.each([
    ['data'],
    ['data', '--strict', '20240101', '20241231', '--window=60', '--points=5', '--json'],
    ['etf', '20200101', '20251231', '--strict'],
  ])('preserves audit argument order: %s', (...args) => {
    expect(parseAuditArguments(args)).toMatchObject({ action: 'run', args: args.slice(1) });
  });

  it.each([
    ['missing'],
    ['data', '--write'],
    ['data', '--window=19'],
    ['data', '--points=13'],
    ['data', '--points=5=6'],
    ['data', '--json=yes'],
    ['data', '--json', '--json'],
    ['data', '20250101', '20240101'],
    ['data', '20250101', '20251231', 'extra'],
    ['etf', '--window=60'],
    ['etf', '20250230'],
  ])('rejects invalid audit arguments: %s', (...args) => {
    expect(() => parseAuditArguments(args)).toThrow();
  });

  it('registers every audit implementation once', async () => {
    const files = (await readdir(new URL('./', import.meta.url)))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !['index.ts', 'commands.ts'].includes(file),
      )
      .map((file) => `scripts/audit/${file.replace(/\.ts$/, '.js')}`);
    expect(auditCommands.map((command) => command.entry).sort()).toEqual(files.sort());
  });
});
