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
        parentPort.postMessage(Object.keys(date).sort());
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
          const worker = new Worker(${JSON.stringify(workerCode)}, {
            eval: true,
            execArgv: ['--conditions=development'],
          });
          worker.once('error', error => { throw error; });
          worker.once('message', exports => {
            console.log(JSON.stringify({ main: Object.keys(date).sort(), worker: exports }));
          });
        `,
      ],
      { cwd: apiDirectory, timeout: 15_000 },
    );
    const result = JSON.parse(stdout);
    expect(result.main.length).toBeGreaterThan(0);
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
        ]));`,
      ],
      { cwd: apiDirectory, env: { ...process.env, NODE_OPTIONS: '' }, timeout: 15_000 },
    );
    expect(JSON.parse(stdout)).toEqual([
      new URL('../dist/src/date.js', import.meta.url).href,
      new URL('../dist/src/infra/jobs/records.js', import.meta.url).href,
    ]);
  });
});
