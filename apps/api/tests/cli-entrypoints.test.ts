import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));

async function packageScripts(directory: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).scripts;
}

describe('application CLI entry contracts', () => {
  it('registers every module CLI and preserves the stock price wrapper arguments', async () => {
    const scripts = await packageScripts(apiDirectory);
    const rootScripts = await packageScripts(repositoryDirectory);
    expect(rootScripts['sync:stock-prices']).toBe('pnpm --filter api sync:stock-prices');
    expect(scripts['sync:stock-prices']).toBe(
      'tsx --conditions=development --env-file=.env src/market/cli/sync-stock-prices.ts',
    );
    expect(rootScripts).not.toHaveProperty('sync');
    expect(scripts).not.toHaveProperty('sync');

    for (const module of ['market', 'application-maintenance', 'signals', 'auth']) {
      for (const entry of await readdir(join(apiDirectory, 'src', module, 'cli'))) {
        if (!entry.endsWith('.ts')) {
          continue;
        }
        const target = `src/${module}/cli/${entry}`;
        expect(
          Object.values(scripts).filter((command) => command.endsWith(` ${target}`)),
        ).toHaveLength(1);
      }
    }
    const importer = await readFile(
      join(repositoryDirectory, 'scripts/maintenance/import-market-data.sh'),
      'utf8',
    );
    expect(importer).toContain('pnpm --filter api sync:stock-prices "$slice_start" "$slice_end"');
    expect(importer).toContain('stock-bars-$year');
    expect(
      Object.values(scripts).some((command) => /scripts\/(sync|maintenance)\//.test(command)),
    ).toBe(false);
  });

  it('uses the same maintenance entry in development and both production services', async () => {
    const scripts = await packageScripts(apiDirectory);
    expect(scripts.maintenance).toBe(
      'tsx --conditions=development --env-file=.env src/application-maintenance/cli/run-maintenance.ts',
    );
    for (const [file, command] of [
      ['jixie-maintenance.service', 'daily'],
      ['jixie-maintenance-weekly.service', 'weekly'],
    ]) {
      const service = await readFile(join(repositoryDirectory, 'deploy', file), 'utf8');
      expect(service).toContain(
        ` /opt/jixie/apps/api/dist/src/application-maintenance/cli/run-maintenance.js ${command}`,
      );
      expect(service).toContain('/usr/bin/flock -n -E 75 /var/lib/jixie/maintenance.lock');
    }
    expect(scripts.backup).toBe('node scripts/backup-db.mjs');
    const backupService = await readFile(
      join(repositoryDirectory, 'deploy/jixie-backup.service'),
      'utf8',
    );
    expect(backupService).toContain(
      'ExecStart=/usr/bin/node /opt/jixie/apps/api/scripts/backup-db.mjs',
    );
  });

  it.each([
    [
      'src/application-maintenance/cli/run-maintenance.ts',
      ['baseline', 'invalid'],
      'Baseline date must use YYYYMMDD',
    ],
    [
      'src/application-maintenance/cli/sync-fina.ts',
      ['--repair-code', 'invalid'],
      '--repair-code must be an A-share ts_code',
    ],
  ])(
    'exits on invalid input and releases the process for %s',
    async (entry, args, message) => {
      const directory = await mkdtemp(join(tmpdir(), 'jixie-cli-invalid-'));
      try {
        await expect(
          executeFile(
            process.execPath,
            ['--conditions=development', '--import', 'tsx', entry, ...args],
            {
              cwd: apiDirectory,
              env: {
                ...process.env,
                NODE_OPTIONS: '',
                NODE_ENV: 'test',
                DATABASE_URL: `file:${join(directory, 'fixture.db')}`,
                TUSHARE_TOKEN: 'fixture',
                TUSHARE_BASE_URL: 'http://127.0.0.1:1',
              },
              timeout: 30_000,
            },
          ),
        ).rejects.toMatchObject({
          code: 1,
          killed: false,
          stderr: expect.stringContaining(message),
        });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    35_000,
  );
});
