import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { buildFactorSandboxBundle } from './sandbox-bundle.js';

it('bundles only the pure Factor SDK without host runtime dependencies', async () => {
  const bundle = await buildFactorSandboxBundle();
  const inputs = Object.keys(bundle.metafile.inputs).map((input) => resolve(input));
  expect(inputs.sort()).toEqual(
    [
      fileURLToPath(new URL('../../sdk/typescript.ts', import.meta.url)),
      fileURLToPath(new URL('./sandbox-entry.ts', import.meta.url)),
      fileURLToPath(new URL('../../../infra/runtime/log-buffer.ts', import.meta.url)),
    ].sort(),
  );
  for (const output of Object.values(bundle.metafile.outputs)) {
    expect(output.imports).toEqual([]);
  }
  expect(bundle.outputFiles).toHaveLength(1);
});
