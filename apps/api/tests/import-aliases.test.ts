import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const apiDirectory = fileURLToPath(new URL('../', import.meta.url));

describe('native API imports', () => {
  it('loads source aliases in a fresh Node process and its Worker', async () => {
    const workerCode = `
      const { parentPort } = require('node:worker_threads');
      import('tsx/esm/api').then(async ({ register }) => {
        register();
        const date = await import('#date');
        const maintenance = await import('#maintenance/daily-schedule.js');
        parentPort.postMessage({ date: Object.keys(date).sort(), maintenance: Object.keys(maintenance).sort() });
      });
    `;
    const { stdout } = await executeFile(
      process.execPath,
      [
        '--conditions=development',
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
          import { Worker } from 'node:worker_threads';
          import * as date from '#date';
          import * as maintenance from '#maintenance/daily-schedule.js';
          const worker = new Worker(${JSON.stringify(workerCode)}, {
            eval: true,
            execArgv: ['--conditions=development'],
          });
          worker.once('error', error => { throw error; });
          worker.once('message', exports => {
            console.log(JSON.stringify({ main: { date: Object.keys(date).sort(), maintenance: Object.keys(maintenance).sort() }, worker: exports }));
          });
        `,
      ],
      { cwd: apiDirectory, timeout: 15_000 },
    );
    const result = JSON.parse(stdout);
    expect(result.main.date.length).toBeGreaterThan(0);
    expect(result.main.maintenance).toContain('shouldSkipScheduledClosedDay');
    expect(result.worker).toEqual(result.main);
  });

  it('resolves production aliases to compiled files without development conditions', async () => {
    const { stdout } = await executeFile(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `console.log(JSON.stringify([
          import.meta.resolve('#date'),
          import.meta.resolve('#infra/jobs/records.js'),
          import.meta.resolve('#maintenance/daily-schedule.js'),
        ]));`,
      ],
      { cwd: apiDirectory, env: { ...process.env, NODE_OPTIONS: '' }, timeout: 15_000 },
    );
    expect(JSON.parse(stdout)).toEqual([
      new URL('../dist/src/date.js', import.meta.url).href,
      new URL('../dist/src/infra/jobs/records.js', import.meta.url).href,
      new URL('../dist/src/maintenance/daily-schedule.js', import.meta.url).href,
    ]);
  });

  it.each(['default', 'development'])('removes the obsolete alias in %s mode', async (mode) => {
    await expect(
      executeFile(
        process.execPath,
        [
          ...(mode === 'development' ? ['--conditions=development'] : []),
          '--input-type=module',
          '-e',
          "import.meta.resolve('#application-maintenance/state.js')",
        ],
        { cwd: apiDirectory, env: { ...process.env, NODE_OPTIONS: '' }, timeout: 15_000 },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('ERR_PACKAGE_IMPORT_NOT_DEFINED'),
    });
  });
});
