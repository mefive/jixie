import { describe, expect, it } from 'vitest';
import { parseSyncArguments } from './sync-arguments.js';
import { syncCommands } from './sync-commands.js';

describe('sync task selection', () => {
  it.each([[], ['--help'], ['-h'], ['--list'], ['--', '--list']])(
    'shows help without selecting a write for %j',
    (...args) => {
      expect(parseSyncArguments(args)).toEqual({ action: 'help' });
    },
  );

  it('lists help for every task and preserves omitted defaults', () => {
    expect(syncCommands).toHaveLength(24);
    expect(new Set(syncCommands.map((command) => command.name)).size).toBe(24);
    for (const command of syncCommands) {
      expect(parseSyncArguments([command.name, '--help'])).toEqual({ action: 'help', command });
      expect(parseSyncArguments([command.name])).toEqual({ action: 'run', command, args: [] });
    }
  });

  it.each([
    ['stock-prices', '20250101', '20251231'],
    ['index', 'market-state', '20240101', '20241231'],
    ['index-daily', '20240101', '20241231', '000300.SH,000905.SH'],
    ['index-daily', '20240101', '20241231', '000985.CSI,H00300.CSI'],
    ['etf', '20240101', '20241231', 'major', 'refresh'],
    ['etf', '20240101', '20241231', ' 510300.sh,510500.SH '],
    ['macro', '202401', '202412'],
    ['fina', '--repair-code', '600519.SH', '--start', '20240101', '--end', '20241231'],
  ])('forwards the exact original argument order for %s', (...input) => {
    const result = parseSyncArguments(input);
    expect(result).toMatchObject({ action: 'run', args: input.slice(1) });
  });

  it.each([
    ['unknown'],
    ['--list', 'extra'],
    ['stock-prices', '--force'],
    ['stock-prices', '20240101', '20241231', 'extra'],
    ['stock-prices', '20250230'],
    ['stock-prices', '20251301'],
    ['stock-prices', '20250102', '20250101'],
    ['sw-industry', '20250101'],
    ['macro', '202413'],
    ['macro', '20240101'],
    ['index', 'unknown'],
    ['index-daily', '20240101', '20241231', 'typo'],
    ['etf', '20240101', '20241231', 'registry', 'refersh'],
    ['fina', '--repair-code'],
    ['fina', '--repair-code', 'invalid', '--start', '20240101'],
    ['fina', '--repair-code', '600519.SH'],
    ['fina', '--start', '20240101'],
    ['fina', '--repair-code', '600519.SH', '--start', '20240101', '--force', 'yes'],
    ['fina', '--repair-code', '600519.SH', '--start', '20240101', '--start', '20250101'],
  ])('rejects invalid input before dispatch: %j', (...input) => {
    expect(() => parseSyncArguments(input)).toThrow();
  });
});
