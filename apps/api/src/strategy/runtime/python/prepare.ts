import { PythonSession } from '#infra/runtime/python/session.js';
import type { StrategyStartOptions, StrategyRuntimePreparation } from '../contract.js';

/** Prepare session and protocol settings without acquiring a sandbox resource. */
export function preparePythonStrategyRuntime({
  code,
  onUserLog,
  paramOverrides,
  locale,
}: StrategyStartOptions) {
  return {
    createResource: () => PythonSession.connect(),
    bridgeOptions: {
      startupCommand: {
        type: 'start',
        runtime_version: 'py-v1',
        code,
        param_overrides: paramOverrides ?? {},
      },
      diagnostics: { language: 'Python', callback: 'on_bar' },
      onUserLog,
      locale,
    },
  } satisfies StrategyRuntimePreparation;
}
