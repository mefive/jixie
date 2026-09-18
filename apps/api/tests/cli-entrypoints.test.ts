import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { syncCommands } from '../scripts/sync/commands.js';

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
    expect(rootScripts.sync).toBe('pnpm --filter api sync');
    expect(rootScripts['data:audit']).toBe('pnpm --filter api data:audit');
    expect(rootScripts.probe).toBe('pnpm --filter api probe');
    expect(scripts['data:audit']).toBe(
      'node --conditions=development --import tsx scripts/audit/index.ts',
    );
    expect(scripts.probe).toBe(
      'node --conditions=development --import tsx scripts/probes/index.ts',
    );
    expect(scripts.sync).toBe('node --conditions=development --import tsx scripts/sync/index.ts');
    expect(Object.keys(scripts).some((name) => name.startsWith('sync:'))).toBe(false);
    expect(rootScripts).not.toHaveProperty('peek');
    expect(scripts).not.toHaveProperty('peek');
    const registeredEntries = [
      ...Object.values(scripts).map((command) => command.split(' ').at(-1)),
      ...syncCommands.map((command) => command.entry.replace(/\.js$/, '.ts')),
    ];

    for (const module of ['market', 'maintenance', 'signals', 'auth']) {
      for (const entry of await readdir(join(apiDirectory, 'src', module, 'cli'))) {
        if (!entry.endsWith('.ts')) {
          continue;
        }
        const target = `src/${module}/cli/${entry}`;
        expect(registeredEntries.filter((entry) => entry === target)).toHaveLength(1);
      }
    }
    const importer = await readFile(
      join(repositoryDirectory, 'scripts/maintenance/import-market-data.sh'),
      'utf8',
    );
    expect(importer).toContain('pnpm --filter api sync stock-prices "$slice_start" "$slice_end"');
    expect(importer).toContain('stock-bars-$year');
    expect(Object.values(scripts).some((command) => /scripts\/maintenance\//.test(command))).toBe(
      false,
    );
  });

  it('keeps deployed and imported sync tasks registered', async () => {
    for (const path of ['scripts/bootstrap.sh', 'scripts/maintenance/import-market-data.sh']) {
      const source = await readFile(
        fileURLToPath(new URL(`../../../${path}`, import.meta.url)),
        'utf8',
      );
      expect(source).not.toMatch(/pnpm --filter api sync:/);
      for (const match of source.matchAll(/pnpm --filter api sync ([a-z-]+)/g)) {
        expect(syncCommands.some((command) => command.name === match[1])).toBe(true);
      }
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

  it('uses the same maintenance entry in development and both production services', async () => {
    const scripts = await packageScripts(apiDirectory);
    expect(scripts.maintenance).toBe(
      'tsx --conditions=development --env-file=.env src/maintenance/cli/run-maintenance.ts',
    );
    for (const [file, command] of [
      ['jixie-maintenance.service', 'daily'],
      ['jixie-maintenance-weekly.service', 'weekly'],
    ]) {
      const service = await readFile(join(repositoryDirectory, 'deploy', file), 'utf8');
      expect(service).toContain(
        ` /opt/jixie/apps/api/dist/src/maintenance/cli/run-maintenance.js ${command}`,
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
      'src/maintenance/cli/run-maintenance.ts',
      ['baseline', 'invalid'],
      'Baseline date must use YYYYMMDD',
    ],
    [
      'src/market/cli/sync-fina.ts',
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
