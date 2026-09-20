import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it.each(['cross_sectional', 'time_series', 'panel'] as const)(
  'runs the packaged Python %s SDK through the common sandbox entry',
  async (analysisKind) => {
    const repositoryDirectory = new URL('../../../../../../', import.meta.url);
    const dockerfile = await readFile(
      new URL('apps/sandboxd/Dockerfile.python', repositoryDirectory),
      'utf8',
    );
    const ignoreRules = (await readFile(new URL('.dockerignore', repositoryDirectory), 'utf8'))
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));
    expect(ignoreRules[0]).toBe('**');
    const directory = await mkdtemp(join(tmpdir(), 'jixie-factor-package-'));
    try {
      for (const match of dockerfile.matchAll(/^COPY (apps\/\S+\.py) \/opt\/jixie\/(\S+\.py)$/gm)) {
        expect(ignoreRules, `excluded build input: ${match[1]}`).toContain(`!${match[1]}`);
        let parent = dirname(match[1]);
        while (parent !== '.') {
          expect(ignoreRules, `excluded build directory: ${parent}`).toContain(`!${parent}/`);
          parent = dirname(parent);
        }
        const destination = join(directory, match[2]);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(new URL(match[1], repositoryDirectory), destination);
      }
      const code =
        analysisKind === 'cross_sectional'
          ? `
from jixie import Factor, FactorBar, CrossSectionalFactorContext
factor = Factor.cross_sectional(name="packaged-factor", window=2, min_coverage=0.8)
@factor.compute
def compute(bar: FactorBar, ctx: CrossSectionalFactorContext):
    if bar.pe_ttm is None:
        raise ValueError("missing earnings fixture")
    closes = ctx.history(2)
    return closes[-1] / closes[0] - 1 if len(closes) == 2 else None
`
          : `
from jixie import Factor, AssetFactorContext
factor = Factor.${analysisKind}(name="packaged-factor", inputs=["etf.adjustedClose"], target_asset_classes=["equity"], window=2)
@factor.compute
def compute(ctx: AssetFactorContext):
    current = ctx.value("etf.adjustedClose")
    prior = ctx.lag("etf.adjustedClose", 1)
    return None if current is None or prior is None else current / prior - 1
`;
      const request =
        analysisKind === 'cross_sectional'
          ? {
              type: 'factor_compute_batch',
              items: [
                { bar: { code: 'AAA', pe_ttm: 10 }, history: { close: [10, 15] } },
                { bar: { code: 'BBB', pe_ttm: null }, history: { close: [10, 15] } },
              ],
            }
          : {
              type: 'factor_compute_series',
              fields: { 'etf.adjustedClose': [10, 15] },
              indexes: [0, 1],
            };
      const frames = [
        { type: 'factor_start', runtime_version: 'py-v1', analysis_kind: analysisKind, code },
        request,
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
      expect(output.map((frame) => frame.type)).toEqual(['factor_ready', 'factor_values']);
      expect(output[0].metadata).toMatchObject({
        name: 'packaged-factor',
        analysis_kind: analysisKind,
        window: 2,
      });
      expect(output[1].values).toEqual(
        analysisKind === 'cross_sectional' ? [0.5, null] : [null, 0.5],
      );
      if (analysisKind === 'cross_sectional') {
        expect(output[1].first_error).toContain('missing earnings fixture');
      } else {
        expect(output[1].first_error).toBeNull();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
