import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle only the factor SDK and transport entry; the engine remains on the host. */
export async function buildFactorSandboxBundle() {
  const entry = new URL(
    import.meta.url.endsWith('.ts') ? './sandbox-entry.ts' : './sandbox-entry.js',
    import.meta.url,
  );
  return build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    conditions: import.meta.url.endsWith('.ts') ? ['development'] : [],
    target: 'es2022',
    mainFields: ['module', 'main'],
    metafile: true,
  });
}
