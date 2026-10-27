import { StrategySandbox } from './strategy-sandbox.js';

export async function inspectStrategyMetadata(
  code: string,
  language: 'typescript' | 'python' = 'typescript',
) {
  const sandbox = await StrategySandbox.start({ language, code });
  try {
    return {
      watch: sandbox.metadata.watch ?? [],
      factors: sandbox.metadata.factors ?? [],
    };
  } finally {
    sandbox.close();
  }
}
