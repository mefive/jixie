import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it.skipIf(process.env.JIXIE_TEST_RUNTIME_BENCHMARK !== '1')(
  'compares the pinned old Engine bundle with the shared host runtime in separate processes',
  { timeout: 180_000 },
  async () => {
    const results = [];
    for (const variant of ['baseline', 'shared']) {
      const { stdout } = await execute(
        process.execPath,
        [
          '--conditions=development',
          fileURLToPath(new URL('./runtime-benchmark.test-worker.mjs', import.meta.url)),
          variant,
        ],
        { timeout: 80_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '' } },
      );
      results.push(JSON.parse(stdout.trim()));
    }
    const hashes = results.flatMap((result) =>
      result.samples.map((sample: { resultHash: string }) => sample.resultHash),
    );
    expect(new Set(hashes).size).toBe(1);
    console.log('Runtime benchmark:', JSON.stringify(results));
  },
);
