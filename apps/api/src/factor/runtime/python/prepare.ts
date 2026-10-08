import { PythonSession } from '#infra/runtime/python/session.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorRuntimePreparation,
} from '../contract.js';

/** Prepare source and transport settings without acquiring a sandbox resource. */
export function preparePythonFactorRuntime<Kind extends ExecutableFactorKind>({
  code,
  analysisKind,
  onUserLog,
}: FactorStartOptions<Kind>) {
  return {
    createResource: () => PythonSession.connect(),
    bridgeOptions: {
      startupCommand: {
        type: 'factor_start',
        runtime_version: 'py-v1',
        analysis_kind: analysisKind,
        code,
      },
      analysisKind,
      diagnostics: { language: 'Python' },
      onUserLog,
    },
  } satisfies FactorRuntimePreparation<Kind>;
}
