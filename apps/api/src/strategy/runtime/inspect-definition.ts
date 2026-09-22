import type { StrategyParamValue, StrategySignalMetadata } from '@jixie/shared';
import { StrategyRuntime } from './strategy-runtime.js';

export async function inspectStrategyParameters(
  code: string,
): Promise<Record<string, StrategyParamValue>> {
  const runtime = await StrategyRuntime.start({ language: 'typescript', code });
  try {
    return runtime.metadata.params ?? {};
  } finally {
    runtime.close();
  }
}

export async function inspectStrategyMetadata(code: string): Promise<StrategySignalMetadata> {
  const runtime = await StrategyRuntime.start({ language: 'typescript', code });
  try {
    return {
      watch: runtime.metadata.watch ?? [],
      futures: runtime.metadata.futures ?? [],
      factors: runtime.metadata.factors ?? [],
    };
  } finally {
    runtime.close();
  }
}
