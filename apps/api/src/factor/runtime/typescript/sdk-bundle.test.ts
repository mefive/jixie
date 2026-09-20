import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildFactorSdkBundle } from './sdk-bundle.js';

it('bundles only the pure Factor SDK without host runtime dependencies', async () => {
  const bundle = await buildFactorSdkBundle();
  const inputs = Object.keys(bundle.metafile.inputs).map((input) => resolve(input));
  expect(inputs).toEqual([fileURLToPath(new URL('../../sdk/typescript.ts', import.meta.url))]);
  for (const output of Object.values(bundle.metafile.outputs)) {
    expect(output.imports).toEqual([]);
  }
  expect(bundle.outputFiles).toHaveLength(1);
});
