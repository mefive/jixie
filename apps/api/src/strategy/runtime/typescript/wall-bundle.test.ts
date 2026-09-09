import { describe, expect, it } from 'vitest';
import { buildWallBundle } from './wall-bundle.js';

describe('strategy wall bundle boundary', () => {
  it('bundles the real engine without host adapters, Node builtins or Prisma substitutes', async () => {
    const bundle = await buildWallBundle();
    const inputs = Object.keys(bundle.metafile!.inputs);

    expect(inputs.some((input) => input.endsWith('/engine/simulation/run.ts'))).toBe(true);
    expect(inputs.some((input) => input.endsWith('/engine/data/engine-data.ts'))).toBe(true);
    expect(
      inputs.filter((input) =>
        /(?:@prisma|prisma-port|engine\/adapters|infra\/database|stub-prisma)/.test(input),
      ),
    ).toEqual([]);
    expect(Object.values(bundle.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
    expect(bundle.outputFiles[0].text).toContain('__runBacktest');
  });
});
