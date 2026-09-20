import { DEFAULT_LOCALE, type Locale, type StrategyParamValue } from '@jixie/shared';
import type { EngineStrategy } from '#engine/types.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { PythonSession } from '#infra/runtime/python/session.js';
import { createStrategyBridge } from '../bridge.js';

export interface PythonStrategyRuntime {
  strategy: EngineStrategy;
  close(): Promise<void>;
}

export async function createPythonStrategyRuntime(
  code: string,
  onUserLog?: UserLogSink,
  paramOverrides?: Record<string, StrategyParamValue>,
  locale: Locale = DEFAULT_LOCALE,
): Promise<PythonStrategyRuntime> {
  const session = await PythonSession.connect();
  try {
    await session.send({
      type: 'start',
      runtime_version: 'py-v1',
      code,
      param_overrides: paramOverrides ?? {},
    });
    const strategy = await createStrategyBridge(session, {
      diagnostics: { language: 'Python', callback: 'on_bar' },
      onUserLog,
      locale,
    });
    return {
      strategy,
      async close() {
        await session.send({ type: 'close' }).catch(() => {});
        session.close();
      },
    };
  } catch (error) {
    session.close();
    throw error;
  }
}
