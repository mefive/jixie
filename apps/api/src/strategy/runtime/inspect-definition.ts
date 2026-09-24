import type { StrategySignalMetadata } from '@jixie/shared';
import { StrategyRuntime } from './strategy-runtime.js';

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
