import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));

describe('unified data executable boundary', () => {
  it('registers only the date-targeted writer', async () => {
    for (const location of ['../package.json', '../../../package.json']) {
      const { scripts } = JSON.parse(await readFile(new URL(location, import.meta.url), 'utf8'));
      expect(scripts.data).toBeDefined();
      for (const retired of ['maintenance', 'import:data', 'sync', 'canonicalize:stock-codes']) {
        expect(scripts[retired]).toBeUndefined();
      }
    }
  });

  it.each([
    ['sync', '--to', '20260230'],
    ['daily'],
    ['sync', '--mode', 'repair'],
    ['sync', '20260101'],
  ])('rejects invalid arguments before configuration: %j', async (...args) => {
    await expect(
      executeFile(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', 'src/maintenance/cli/data.ts', ...args],
        {
          cwd: apiDirectory,
          timeout: 10_000,
          env: { ...process.env, DATABASE_URL: 'invalid', TUSHARE_TOKEN: '', NODE_OPTIONS: '' },
        },
      ),
    ).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('Usage: pnpm data') });
  });

  it.each([[], ['--help'], ['sync', '--help']])(
    'shows help without configuration: %j',
    async (...args) => {
      const result = await executeFile(
        process.execPath,
        ['--conditions=development', '--import', 'tsx', 'src/maintenance/cli/data.ts', ...args],
        {
          cwd: apiDirectory,
          timeout: 10_000,
          env: { ...process.env, DATABASE_URL: 'invalid', TUSHARE_TOKEN: '', NODE_OPTIONS: '' },
        },
      );
      expect(result.stdout).toContain('Usage: pnpm data');
    },
  );
});
