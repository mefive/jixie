import {
  defineFactor,
  defineFactorV2,
  CrossSectionalFactorContext,
  AssetFactorContext,
} from '../../sdk/typescript.js';
import type { CustomFactor, AssetFactorV2 } from '@jixie/shared/sdk/factor/contract';
import type { FactorBatchItem, AssetFactorInput, ExecutableFactorKind } from '../contract.js';
import { SandboxLogBuffer } from '#infra/runtime/log-buffer.js';

declare const __hostEmit: { applySync(receiver: undefined, args: string[]): string };
const logs = new SandboxLogBuffer((json) => {
  __hostEmit.applySync(undefined, [json]);
});
let definition: CustomFactor | AssetFactorV2;
let analysisKind: ExecutableFactorKind;
let declaredInputs: Set<AssetFactorV2['inputs'][number]>;

const format = (args: unknown[]) =>
  args.map((value) => (typeof value === 'string' ? value : JSON.stringify(value))).join(' ');
const log = (level: 'info' | 'warning' | 'error', args: unknown[]) => {
  logs.append(level, format(args));
};
globalThis.console = {
  log: (...args: unknown[]) => log('info', args),
  info: (...args: unknown[]) => log('info', args),
  warn: (...args: unknown[]) => log('warning', args),
  error: (...args: unknown[]) => log('error', args),
} as Console;

function start(command: { userJs: string; analysis_kind: ExecutableFactorKind }) {
  analysisKind = command.analysis_kind;
  Object.assign(
    globalThis,
    analysisKind === 'cross_sectional' ? { defineFactor } : { defineFactorV2 },
  );
  const module = { exports: {} as Record<string, unknown> };
  const evaluate = new Function('module', 'exports', 'require', command.userJs);
  evaluate(module, module.exports, (id: string) => {
    throw new Error(`cannot import external module (${id})`);
  });
  definition = (module.exports.default ?? module.exports) as unknown as typeof definition;
  if (!definition || typeof definition.compute !== 'function') {
    throw new Error('Factor requires an exported definition with a compute callback');
  }
  if (analysisKind === 'cross_sectional') {
    const factor = definition as CustomFactor;
    factor.name ||= '未命名因子';
    return {
      type: 'factor_ready',
      metadata: {
        analysisKind,
        name: factor.name,
        window: factor.window ?? null,
        minCoverage:
          factor.minCoverage != null && factor.minCoverage >= 0.1 && factor.minCoverage <= 1
            ? factor.minCoverage
            : null,
      },
    };
  }
  const factor = definition as AssetFactorV2;
  if (
    factor.version !== 2 ||
    factor.analysisKind !== analysisKind ||
    factor.outputScope !== 'asset'
  ) {
    throw new Error(
      `Factor V2 ${analysisKind} definitions require version=2, analysisKind=${analysisKind}, outputScope=asset`,
    );
  }
  if (factor.frequency !== 'daily') {
    throw new Error('Factor V2 currently supports daily time-series definitions only');
  }
  if (!Array.isArray(factor.inputs) || factor.inputs.length === 0) {
    throw new Error('Factor V2 requires at least one declared input');
  }
  if (!Number.isInteger(factor.window) || factor.window < 2 || factor.window > 505) {
    throw new Error('Factor V2 window must be an integer between 2 and 505');
  }
  declaredInputs = new Set(factor.inputs);
  return {
    type: 'factor_ready',
    metadata: {
      version: factor.version,
      name: factor.name,
      analysisKind,
      outputScope: factor.outputScope,
      frequency: factor.frequency,
      inputs: factor.inputs,
      targetAssetClasses: factor.targetAssetClasses,
      window: factor.window,
    },
  };
}

function compute(count: number, callback: (index: number) => number | null) {
  let firstError: string | null = null;
  const values = Array.from({ length: count }, (_, index) => {
    try {
      const value = callback(index);
      return value == null || !Number.isFinite(value) ? null : value;
    } catch (error) {
      firstError ??=
        error && typeof error === 'object' && 'message' in error && error.message
          ? String(error.message)
          : String(error);
      return null;
    }
  });
  return { type: 'factor_values', values, first_error: firstError };
}

type FactorCommand =
  | { type: 'factor_start'; userJs: string; analysis_kind: ExecutableFactorKind }
  | { type: 'factor_compute_batch'; items: FactorBatchItem[] }
  | ({ type: 'factor_compute_series' } & AssetFactorInput);

function executeCommand(command: FactorCommand) {
  switch (command.type) {
    case 'factor_start':
      return JSON.stringify(start(command));
    case 'factor_compute_batch': {
      if (analysisKind !== 'cross_sectional') {
        throw new Error('Factor requires asset-series input');
      }
      const factor = definition as CustomFactor;
      return JSON.stringify(
        compute(command.items.length, (index) => {
          const item = command.items[index];
          return factor.compute(item.bar, new CrossSectionalFactorContext(item));
        }),
      );
    }
    case 'factor_compute_series': {
      if (analysisKind === 'cross_sectional') {
        throw new Error('Factor requires cross-sectional input');
      }
      const factor = definition as AssetFactorV2;
      return JSON.stringify(
        compute(command.indexes.length, (position) =>
          factor.compute(
            new AssetFactorContext(command.fields, command.indexes[position], declaredInputs),
          ),
        ),
      );
    }
    default:
      throw new Error('Unsupported Factor command');
  }
}

(globalThis as Record<string, unknown>).__receiveCommand = (json: string) => {
  let result: string;
  try {
    result = executeCommand(JSON.parse(json) as FactorCommand);
  } catch (error) {
    try {
      logs.flush();
    } catch {
      // Best-effort log delivery must not replace the original execution failure.
    }
    throw error;
  }
  logs.flush();
  return result;
};
