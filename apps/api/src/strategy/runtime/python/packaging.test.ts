import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('runs the Python strategy SDK with only modules shipped in the container', async () => {
  const repositoryDirectory = new URL('../../../../../../', import.meta.url);
  const dockerfile = await readFile(
    new URL('apps/sandboxd/Dockerfile.python', repositoryDirectory),
    'utf8',
  );
  const ignoreRules = (await readFile(new URL('.dockerignore', repositoryDirectory), 'utf8'))
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  expect(ignoreRules[0]).toBe('**');
  for (const match of dockerfile.matchAll(/^COPY (\S+) /gm)) {
    expect(ignoreRules, `missing build-context input: ${match[1]}`).toContain(`!${match[1]}`);
    let parent = dirname(match[1]);
    while (parent !== '.') {
      expect(ignoreRules, `excluded build-context directory: ${parent}`).toContain(`!${parent}/`);
      parent = dirname(parent);
    }
  }
  const directory = await mkdtemp(join(tmpdir(), 'jixie-strategy-package-'));
  try {
    for (const match of dockerfile.matchAll(/^COPY (apps\/\S+\.py) \/opt\/jixie\/(\S+\.py)$/gm)) {
      const destination = join(directory, match[2]);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(new URL(match[1], repositoryDirectory), destination);
    }
    const code = `
from jixie import Strategy, Context, Universe

strategy = Strategy(name="packaged-sdk", params={"weight": 0.5})

@strategy.on_bar
def handle_bar(ctx: Context):
    candidates: Universe = ctx.universe()
    for code in candidates.rank_by(lambda bar, code: bar.pe_ttm).top(1):
        ctx.order_target_percent(code, ctx.params.weight)
`;
    const frames = [
      { type: 'start', runtime_version: 'py-v1', code },
      {
        type: 'bar',
        snapshot: {
          date: '20240102',
          cash: 100_000,
          value: 100_000,
          available_cash: 100_000,
          positions: [],
        },
      },
      {
        type: 'response',
        id: 1,
        result: {
          codes: ['AAA', 'BBB'],
          rows: [
            { code: 'AAA', pe_ttm: 10 },
            { code: 'BBB', pe_ttm: 20 },
          ],
        },
      },
      { type: 'close' },
    ];
    const input = Buffer.concat(
      frames.map((frame) => {
        const payload = Buffer.from(JSON.stringify(frame));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(payload.length);
        return Buffer.concat([header, payload]);
      }),
    );
    const result = spawnSync(
      process.env.JIXIE_PYTHON_EXECUTABLE ?? 'python3',
      ['-I', '-u', join(directory, 'apps/sandboxd/python/jixie_runner.py')],
      { input, timeout: 10_000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr?.toString()).toBe(0);
    const output: Array<Record<string, unknown>> = [];
    for (let offset = 0; offset < result.stdout.length; ) {
      const size = result.stdout.readUInt32BE(offset);
      output.push(JSON.parse(result.stdout.subarray(offset + 4, offset + 4 + size).toString()));
      offset += 4 + size;
    }
    expect(output.map((frame) => frame.type)).toEqual(['ready', 'request', 'done']);
    expect(output[2].commands).toEqual([
      { operation: 'order_target_percent', arguments: { code: 'BBB', weight: 0.5 } },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
