import type { StrategySignalMetadata } from '@jixie/shared';
import { StrategyRuntime } from './strategy-runtime.js';

export async function inspectStrategyMetadata(code: string): Promise<StrategySignalMetadata> {
  const runtime = await StrategyRuntime.start({ language: 'typescript', code });
  try {
    return {
      watch: runtime.metadata.watch ?? [],
      futures: [],
      accounts: runtime.metadata.accounts,
      factors: runtime.metadata.factors ?? [],
    };
  } finally {
    runtime.close();
  }
}
