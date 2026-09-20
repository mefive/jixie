import { describe, expect, it } from 'vitest';
import { buildStrategySandboxBundle } from './sandbox-bundle.js';

describe('strategy sandbox bundle boundary', () => {
  it('bundles only the SDK without the engine or host adapters', async () => {
    const bundle = await buildStrategySandboxBundle();
    const inputs = Object.keys(bundle.metafile!.inputs);

    expect(inputs.some((input) => input.endsWith('/engine/simulation/run.ts'))).toBe(false);
    expect(inputs.some((input) => input.endsWith('/engine/data/engine-data.ts'))).toBe(false);
    expect(
      inputs.filter((input) =>
        /(?:@prisma|prisma-port|engine\/adapters|infra\/database|stub-prisma)/.test(input),
      ),
    ).toEqual([]);
    expect(Object.values(bundle.metafile!.outputs).flatMap((output) => output.imports)).toEqual([]);
    expect(bundle.outputFiles[0].text).toContain('__runStrategyBar');
  });
});
