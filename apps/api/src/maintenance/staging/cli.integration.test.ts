import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));
let directory: string;
let server: Server;
let providerUrl: string;
const requests: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'jixie-maintenance-cli-'));
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    requests.push(input.api_name);
    const data =
      input.api_name === 'trade_cal'
        ? {
            fields: ['exchange', 'cal_date', 'is_open', 'pretrade_date'],
            items: [['SSE', '20261019', 1, '20261016']],
          }
        : {
            fields: ['ts_code', 'trade_date', 'pe', 'turnover_rate_f'],
            items: [['000001.SZ', '20261019', 10, 2]],
          };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code: 0, data }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port');
  }
  providerUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe.each(process.env.JIXIE_TEST_COMPILED === '1' ? [false, true] : [false])(
  'real maintenance CLI publication (compiled=%s)',
  (compiled) => {
    it('prepares through callable sync operations and publishes only the resulting changes', async () => {
      requests.length = 0;
      const filename = resolve(directory, compiled ? 'compiled.db' : 'source.db');
      await writeFile(filename, '');
      const environment = {
        ...process.env,
        NODE_OPTIONS: '',
        DATABASE_URL: `file:${filename}`,
        TUSHARE_TOKEN: 'fixture',
        TUSHARE_BASE_URL: providerUrl,
        TUSHARE_MIN_INTERVAL_MS: '1',
      };
      await executeFile(
        process.execPath,
        ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
        {
          cwd: apiDirectory,
          env: environment,
          timeout: 30_000,
        },
      );
      await executeFile(
        process.execPath,
        [
          ...(compiled ? [] : ['--conditions=development', '--import', 'tsx']),
          compiled ? 'dist/scripts/sync/index.js' : 'scripts/sync/index.ts',
          'basic',
          '20261019',
          '20261019',
        ],
        { cwd: apiDirectory, env: environment, timeout: 30_000 },
      );

      const database = new DatabaseSync(filename, { readOnly: true });
      try {
        expect(database.prepare('SELECT pe, turnoverRateF FROM DailyBasic').all()).toEqual([
          { pe: 10, turnoverRateF: 2 },
        ]);
        expect(
          database.prepare('SELECT dataRevision FROM MaintenanceState').get()?.dataRevision,
        ).toBe(1);
        const run = database.prepare('SELECT status, summary FROM MaintenanceRun').get();
        expect(run?.status).toBe('done');
        expect(JSON.parse(String(run?.summary))).toMatchObject({
          phase: 'done',
          publishedRevision: 1,
        });
        expect(database.prepare('SELECT count(*) AS count FROM User').get()?.count).toBe(0);
        expect(requests).toEqual(['trade_cal', 'daily_basic']);
      } finally {
        database.close();
      }

      const serverEntry = pathToFileURL(
        resolve(apiDirectory, compiled ? 'dist/src/server.js' : 'src/server.ts'),
      ).href;
      const prismaEntry = pathToFileURL(
        resolve(
          apiDirectory,
          compiled ? 'dist/src/infra/database/prisma.js' : 'src/infra/database/prisma.ts',
        ),
      ).href;
      await executeFile(
        process.execPath,
        [
          ...(compiled ? [] : ['--conditions=development', '--import', 'tsx']),
          '--input-type=module',
          '--eval',
          `import assert from 'node:assert/strict';
         import { buildApp } from ${JSON.stringify(serverEntry)};
         import { prisma } from ${JSON.stringify(prismaEntry)};
         try {
           const app = buildApp();
           assert.deepEqual(await (await app.request('/api/health')).json(), { ok: true });
           const response = await app.request('/api/maintenance/status');
           assert.equal(response.status, 200);
           assert.equal((await response.json()).phase, 'uninitialized');
         } finally { await prisma.$disconnect(); }`,
        ],
        { cwd: apiDirectory, env: environment, timeout: 30_000 },
      );
    }, 65_000);
  },
);
