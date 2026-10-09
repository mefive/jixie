import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import { toCommonJs } from '#infra/runtime/typescript/compile.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorRuntimePreparation,
} from '../contract.js';
import { buildFactorSandboxBundle } from './sandbox-bundle.js';

let bundlePromise: Promise<string> | undefined;

/** Prepare source and transport settings without acquiring a sandbox resource. */
export async function prepareTypeScriptFactorRuntime<Kind extends ExecutableFactorKind>({
  code,
  analysisKind,
  onUserLog,
}: FactorStartOptions<Kind>) {
  const userJs = await toCommonJs(code, 'factor code');
  bundlePromise ??= buildFactorSandboxBundle().then((bundle) => bundle.outputFiles[0].text);

  const bundle = await bundlePromise;

  return {
    createResource: () =>
      TypeScriptTransport.connect({
        bundle,
        description: 'factor code',
        memoryMb: 256,
        maxFrameBytes: 256 * 1024 * 1024,
        maxQueuedFrames: Number.MAX_SAFE_INTEGER,
        commandTimeoutMs: (frame) => (frame.type === 'factor_start' ? 5_000 : 30_000),
      }),
    bridgeOptions: {
      startupCommand: { type: 'factor_start', analysis_kind: analysisKind, userJs },
      analysisKind,
      diagnostics: { language: 'TypeScript' },
      onUserLog,
    },
  } satisfies FactorRuntimePreparation<Kind>;
}
