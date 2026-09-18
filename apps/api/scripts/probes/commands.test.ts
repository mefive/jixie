import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { probeCommands, parseProbeArguments } from './commands.js';

describe('probe task selection', () => {
  it('shows family and task help without selecting any execution', () => {
    for (const args of [[], ['--help'], ['--list']]) {
      expect(parseProbeArguments(args)).toEqual({ action: 'help' });
    }
    for (const command of probeCommands) {
      expect(parseProbeArguments([command.name, '--help'])).toEqual({ action: 'help', command });
    }
  });

  it.each([
    ['tushare'],
    ['asset-allocation'],
    ['asset-allocation', '--date', '20250901', '--json', '--persist'],
    ['asset-allocation', '--persist-if-stale', '--max-age-days', '14'],
    ['asset-allocation', '--', '--persist-if-stale', '--max-age-days', '14'],
  ])('preserves probe persistence flags without enabling them implicitly: %s', (...args) => {
    expect(parseProbeArguments(args)).toMatchObject({ action: 'run', args: args.slice(1) });
  });

  it.each([
    ['missing'],
    ['tushare', '--persist'],
    ['asset-allocation', '--date'],
    ['asset-allocation', '--date', '20250230'],
    ['asset-allocation', '--max-age-days'],
    ['asset-allocation', '--max-age-days', '0'],
    ['asset-allocation', '--max-age-days', '366'],
    ['asset-allocation', '--max-age-days', '1.5'],
    ['asset-allocation', '--persistt'],
    ['asset-allocation', '--date', '20250101', '--date', '20250102'],
  ])('rejects invalid probe arguments before external requests: %s', (...args) => {
    expect(() => parseProbeArguments(args)).toThrow();
  });

  it('registers every probe implementation once', async () => {
    const files = (await readdir(new URL('./', import.meta.url)))
      .filter(
        (file) =>
          file.endsWith('.ts') &&
          !file.endsWith('.test.ts') &&
          !['index.ts', 'commands.ts'].includes(file),
      )
      .map((file) => `scripts/probes/${file.replace(/\.ts$/, '.js')}`);
    expect(probeCommands.map((command) => command.entry).sort()).toEqual(files.sort());
  });
});
