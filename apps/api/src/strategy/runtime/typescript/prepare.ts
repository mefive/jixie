import { DEFAULT_LOCALE } from '@jixie/shared';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import { toCommonJs } from '#infra/runtime/typescript/compile.js';
import type { StrategyStartOptions, StrategyRuntimePreparation } from '../contract.js';
import { buildStrategySandboxBundle } from './sandbox-bundle.js';

let bundlePromise: Promise<string> | undefined;

/** Prepare source and transport settings without acquiring a sandbox resource. */
export async function prepareTypeScriptStrategyRuntime({
  code,
  onUserLog,
  paramOverrides,
  locale = DEFAULT_LOCALE,
}: StrategyStartOptions) {
  const userJs = await toCommonJs(code, 'strategy code');
  bundlePromise ??= buildStrategySandboxBundle().then((bundle) => bundle.outputFiles[0].text);
  const bundle = await bundlePromise;
  const deadline = Date.now() + 3_600_000;

  return {
    createResource: () =>
      TypeScriptTransport.connect({
        bundle,
        description: 'strategy code',
        memoryMb: 1024,
        allowHostAccess: true,
        commandTimeoutMs: (frame) =>
          frame.type === 'start' ? 5_000 : Math.max(1, deadline - Date.now()),
      }),
    bridgeOptions: {
      startupCommand: {
        type: 'start',
        userJs,
        paramOverrides,
        locale,
        captureUserLogs: onUserLog != null,
      },
      historyUpdates: true,
      diagnostics: { language: 'TypeScript', callback: 'onBar' },
      onUserLog,
      locale,
    },
  } satisfies StrategyRuntimePreparation;
}
