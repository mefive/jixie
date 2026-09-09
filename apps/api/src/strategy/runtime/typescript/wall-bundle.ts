import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Bundle the pure engine for an isolate without replacing forbidden host imports. */
export async function buildWallBundle() {
  const entry = new URL(
    import.meta.url.endsWith('.ts') ? './wall-entry.ts' : './wall-entry.js',
    import.meta.url,
  );
  return build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'neutral',
    target: 'es2022',
    mainFields: ['module', 'main'],
    metafile: true,
  });
}
