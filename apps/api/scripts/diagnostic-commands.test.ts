import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { auditCommands, parseAuditArguments } from './audit-commands.js';
import { probeCommands, parseProbeArguments } from './probe-commands.js';

describe('audit and probe task selection', () => {
  it('shows family and task help without selecting any execution', () => {
    for (const [commands, parse] of [
      [auditCommands, parseAuditArguments],
      [probeCommands, parseProbeArguments],
    ] as const) {
      for (const args of [[], ['--help'], ['--list']]) {
        expect(parse(args)).toEqual({ action: 'help' });
      }
      for (const command of commands) {
        expect(parse([command.name, '--help'])).toEqual({ action: 'help', command });
      }
    }
  });

  it.each([
    ['data'],
    ['data', '--strict', '20240101', '20241231', '--window=60', '--points=5', '--json'],
    ['etf', '20200101', '20251231', '--strict'],
    ['financial-selected', '20250901', '600519.SH', '000001.SZ'],
    ['financial-selected', '20250901', 'excluded-identifier'],
    ['valuation-samples', '20250901', './output with spaces.json'],
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
    ['financial-selected'],
    ['financial-selected', '20250101', '--typo'],
    ['valuation-samples', '20250101'],
    ['valuation-samples', '20250101', 'output.json', 'extra'],
  ])('rejects invalid audit arguments: %s', (...args) => {
    expect(() => parseAuditArguments(args)).toThrow();
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

  it('registers every audit and probe implementation once', async () => {
    for (const [directory, commands] of [
      ['audit', auditCommands],
      ['probes', probeCommands],
    ] as const) {
      const files = (await readdir(new URL(`./${directory}/`, import.meta.url)))
        .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
        .map((file) => `scripts/${directory}/${file.replace(/\.ts$/, '.js')}`);
      expect(commands.map((command) => command.entry).sort()).toEqual(files.sort());
    }
  });

  it('keeps importer and deployment diagnostics on the unified entry points', async () => {
    const importer = await readFile(
      new URL('../../../scripts/maintenance/import-market-data.sh', import.meta.url),
      'utf8',
    );
    const bootstrap = await readFile(
      new URL('../../../scripts/bootstrap.sh', import.meta.url),
      'utf8',
    );
    expect(importer).toContain('pnpm data:audit data "$START_DATE" "$END_DATE" --strict');
    expect(importer).toContain('pnpm --filter api probe tushare');
    expect(bootstrap).toContain('pnpm --filter api probe asset-allocation');
    expect(bootstrap).toContain('--persist-if-stale');
    const scripts = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ).scripts;
    expect(
      Object.keys(scripts).some((name) => name.startsWith('audit:') || name.startsWith('probe:')),
    ).toBe(false);
    expect(scripts.smoke).toBeUndefined();
    expect(scripts.audit).toBeUndefined();
  });
});
