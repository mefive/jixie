import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const require = createRequire(import.meta.url);
const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));
let directory: string;
let server: Server;
let databaseUrl: string;
let providerUrl: string;
const requests: string[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'jixie-reference-worker-'));
  databaseUrl = `file:${join(directory, 'fixture.db')}`;
  await writeFile(join(directory, 'fixture.db'), '');
  await executeFile(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 60_000,
    },
  );
  server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
    }
    const input = JSON.parse(body);
    requests.push(input.params.ts_code);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ code: 0, data: { fields: [], items: [] } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Missing fixture port');
  }
  providerUrl = `http://127.0.0.1:${address.port}`;
}, 65_000);

afterAll(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function runWorker(callback: string, compiled: boolean) {
  const runner = join(directory, 'runner.mjs');
  const entry = pathToFileURL(
    join(
      apiDirectory,
      compiled ? 'dist/src' : 'src',
      'market/fundamentals/reference-worker-process.' + (compiled ? 'js' : 'ts'),
    ),
  ).href;
  await writeFile(
    runner,
    `import { runReferenceWorkerProcess } from '${entry}';
     const completed = [];
     const summary = await runReferenceWorkerProcess('dividends', ['000001.SZ', '600000.SH'], {
       onItemComplete: async item => { ${callback} }
     });
     console.log(JSON.stringify({ completed, summary }));`,
  );
  return executeFile(
    process.execPath,
    [...(compiled ? [] : ['--conditions=development', '--import', 'tsx']), runner],
    {
      cwd: apiDirectory,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl,
        TUSHARE_TOKEN: 'fixture',
        TUSHARE_BASE_URL: providerUrl,
      },
      timeout: 20_000,
    },
  );
}

describe.each(process.env.JIXIE_TEST_COMPILED === '1' ? [false, true] : [false])(
  'real reference worker IPC (compiled=%s)',
  (compiled) => {
    it('completes every item through parent acknowledgements and exits', async () => {
      requests.length = 0;
      const { stdout } = await runWorker('completed.push(item);', compiled);
      const result = JSON.parse(stdout.trim().split('\n').at(-1)!);
      expect(result.completed).toEqual(['000001.SZ', '600000.SH']);
      expect(result.summary).toMatchObject({ requested: 2, processed: 2 });
      expect(requests).toEqual(['000001.SZ', '600000.SH']);
    }, 25_000);

    it('does not fetch the next item when the parent cannot persist completion', async () => {
      requests.length = 0;
      await expect(
        runWorker("throw new Error('checkpoint write failed');", compiled),
      ).rejects.toMatchObject({
        code: 1,
        killed: false,
        stderr: expect.stringContaining('checkpoint write failed'),
      });
      expect(requests).toEqual(['000001.SZ']);
    }, 25_000);
  },
);
