import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const execute = promisify(execFile);

it.skipIf(process.env.JIXIE_TEST_RUNTIME_BENCHMARK !== '1').each(['watch', 'dynamic'])(
  'compares pinned runtimes in separate processes (%s)',
  { timeout: 180_000 },
  async (scenario) => {
    const results = [];
    const variants =
      scenario === 'dynamic'
        ? ['baseline', 'before', 'previous', 'shared']
        : ['baseline', 'previous', 'shared'];
    for (const variant of variants) {
      const { stdout } = await execute(
        process.execPath,
        [
          '--conditions=development',
          fileURLToPath(new URL('./runtime-benchmark.test-worker.mjs', import.meta.url)),
          variant,
          scenario,
        ],
        { timeout: 80_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, NODE_OPTIONS: '' } },
      );
      results.push(JSON.parse(stdout.trim()));
    }
    const hashes = results.flatMap((result) =>
      result.samples.map((sample: { resultHash: string }) => sample.resultHash),
    );
    expect(new Set(hashes).size).toBe(1);
    if (scenario === 'dynamic') {
      const before = results.find((result) => result.variant === 'before');
      const shared = results.find((result) => result.variant === 'shared');
      // Payload size is deterministic; wall-clock timing remains diagnostic, not a flaky threshold.
      for (const [index, sample] of shared.samples.entries()) {
        expect(sample.metrics.transferredBytes).toBeLessThan(
          before.samples[index].metrics.transferredBytes / 2,
        );
      }
    }
    console.log('Runtime benchmark:', JSON.stringify(results));
  },
);
