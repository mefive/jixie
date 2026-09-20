import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Only the pure SDK enters the isolate; user source never participates in this build. */
export function buildFactorSdkBundle() {
  const entry = new URL(
    import.meta.url.endsWith('.ts') ? '../../sdk/typescript.ts' : '../../sdk/typescript.js',
    import.meta.url,
  );
  return build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__factorSdk',
    platform: 'neutral',
    target: 'es2022',
    metafile: true,
  });
}

let sdkSource: Promise<string> | undefined;

/** Compile once per host process; every factor still evaluates its own SDK inside a fresh isolate. */
export function factorSdkSource(): Promise<string> {
  sdkSource ??= buildFactorSdkBundle().then((bundle) => bundle.outputFiles[0].text);
  return sdkSource;
}
