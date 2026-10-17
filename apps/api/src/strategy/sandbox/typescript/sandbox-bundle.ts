import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/**
 * 只打包策略 SDK 与通信入口，撮合引擎继续留在宿主。
 * Bundle only the strategy SDK and transport entry; the engine remains on the host.
 */
export async function buildStrategySandboxBundle() {
  const entry = new URL(
    import.meta.url.endsWith('.ts') ? './entry.ts' : './entry.js',
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
