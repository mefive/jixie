import { PythonStrategyRuntime } from './python/python-strategy-runtime.js';
import { TypeScriptStrategyRuntime } from './typescript/typescript-strategy-runtime.js';
import type { StrategyStartOptions, StrategyRuntimeInstance } from './contract.js';

export class StrategyRuntime {
  static start(options: StrategyStartOptions): Promise<StrategyRuntimeInstance> {
    return options.language === 'python'
      ? PythonStrategyRuntime.start(options)
      : TypeScriptStrategyRuntime.start(options);
  }
}
