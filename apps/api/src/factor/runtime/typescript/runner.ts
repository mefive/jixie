import { FactorAdapter } from './adapter.js';
import {
  defineFactor,
  defineFactorV2,
  CrossSectionalFactorContext,
  AssetFactorContext,
} from '../../sdk/typescript.js';
import type { CustomFactor, AssetFactorV2 } from '@jixie/shared/sdk/factor/contract';
import type {
  FactorBatchItem,
  AssetFactorExecutionInput,
  ExecutableFactorKind,
} from '../contract.js';

export interface FactorRunnerHost {
  receive(handler: FactorRunnerCommandHandler): void;
}

interface FactorRunnerStartup {
  userJs: string;
  analysis_kind: ExecutableFactorKind;
}

export type FactorRunnerCommand =
  | ({ type: 'factor_start' } & FactorRunnerStartup)
  | { type: 'factor_compute_batch'; items: FactorBatchItem[] }
  | ({ type: 'factor_compute_series' } & AssetFactorExecutionInput);

export type FactorRunnerCommandHandler = (frame: FactorRunnerCommand) => string;

/** One instance owns one sandbox session and all state shared across its callbacks. */
class FactorRunner {
  private readonly adapter = new FactorAdapter();
  private factor!: CustomFactor | AssetFactorV2;
  private analysisKind!: ExecutableFactorKind;
  private declaredInputs!: Set<AssetFactorV2['inputs'][number]>;

  handle(frame: FactorRunnerCommand): string {
    switch (frame.type) {
      case 'factor_start':
        return this.start(frame);
      case 'factor_compute_batch':
      case 'factor_compute_series':
        return this.execute(frame);
      default:
        throw new Error('Unsupported Factor command');
    }
  }

  start(config: FactorRunnerStartup): string {
    this.analysisKind = config.analysis_kind;
    this.factor = this.loadFactor(config.userJs);

    return JSON.stringify({ type: 'factor_ready', metadata: this.metadata() });
  }

  private execute(frame: Exclude<FactorRunnerCommand, { type: 'factor_start' }>): string {
    if (frame.type === 'factor_compute_batch') {
      if (this.analysisKind !== 'cross_sectional') {
        throw new Error('Factor requires asset-series input');
      }
      const factor = this.factor as CustomFactor;

      return JSON.stringify(
        this.computeValues(frame.items.length, (index) => {
          const item = frame.items[index];

          return factor.compute(
            item.bar,
            new CrossSectionalFactorContext(
              this.adapter.bind({ kind: 'cross_sectional', history: item }),
            ),
          );
        }),
      );
    }

    if (this.analysisKind === 'cross_sectional') {
      throw new Error('Factor requires cross-sectional input');
    }
    const factor = this.factor as AssetFactorV2;

    return JSON.stringify(
      this.computeValues(frame.indexes.length, (position) =>
        factor.compute(
          new AssetFactorContext(
            this.adapter.bind({
              kind: 'asset',
              fields: frame.fields,
              index: frame.indexes[position],
              declaredInputs: this.declaredInputs,
            }),
          ),
        ),
      ),
    );
  }

  private loadFactor(userJs: string): CustomFactor | AssetFactorV2 {
    const crossSectional = this.analysisKind === 'cross_sectional';
    const factoryName = crossSectional ? 'defineFactor' : 'defineFactorV2';
    const factory = crossSectional ? defineFactor : defineFactorV2;

    const module = { exports: {} as Record<string, unknown> };
    const evaluate = new Function('module', 'exports', factoryName, 'require', userJs);

    evaluate(module, module.exports, factory, (id: string) => {
      throw new Error(`cannot import external module (${id})`);
    });

    const factor = (module.exports.default ?? module.exports) as unknown as
      | CustomFactor
      | AssetFactorV2;
    if (!factor || typeof factor.compute !== 'function') {
      throw new Error('Factor requires an exported definition with a compute callback');
    }

    return factor;
  }

  private metadata() {
    if (this.analysisKind === 'cross_sectional') {
      const factor = this.factor as CustomFactor;
      factor.name ||= '未命名因子';

      return {
        analysisKind: this.analysisKind,
        name: factor.name,
        window: factor.window ?? null,
        minCoverage:
          factor.minCoverage != null && factor.minCoverage >= 0.1 && factor.minCoverage <= 1
            ? factor.minCoverage
            : null,
      };
    }

    const factor = this.factor as AssetFactorV2;
    if (
      factor.version !== 2 ||
      factor.analysisKind !== this.analysisKind ||
      factor.outputScope !== 'asset'
    ) {
      throw new Error(
        `Factor V2 ${this.analysisKind} definitions require version=2, analysisKind=${this.analysisKind}, outputScope=asset`,
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
    this.declaredInputs = new Set(factor.inputs);

    return {
      version: factor.version,
      name: factor.name,
      analysisKind: this.analysisKind,
      outputScope: factor.outputScope,
      frequency: factor.frequency,
      inputs: factor.inputs,
      targetAssetClasses: factor.targetAssetClasses,
      window: factor.window,
    };
  }

  private computeValues(count: number, callback: (index: number) => number | null) {
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
}

/** Start one factor session and attach its message handler to the injected transport. */
export function runFactor(start: FactorRunnerStartup, host: FactorRunnerHost): string {
  const runner = new FactorRunner();
  const ready = runner.start(start);

  host.receive((frame) => runner.handle(frame));

  return ready;
}
