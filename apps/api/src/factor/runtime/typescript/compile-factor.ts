import type { FactorBar } from '@jixie/shared';
import type { CustomFactor } from '@jixie/shared/sdk/factor/contract';
import type { FactorHistory } from '../../sdk/typescript.js';
import { factorSdkSource } from './sdk-bundle.js';
import {
  loadIsolatedModule,
  toCommonJs,
  type IsolatedModule,
} from '#infra/runtime/typescript/isolate-run.js';
import type { UserLogSink } from '#infra/runtime/console.js';

/**
 * Compile a factor (defineFactor TS source) into an isolated-vm-backed handle — the hard sandbox
 * boundary for factor code. SDK functions and user callbacks both execute inside the isolate.
 * Execution is BATCHED: one wall-crossing computes a whole array of items (per rebalance date on
 * the fast path, per stock on the windowed path) — 650k per-stock wall crossings would be crushed by
 * serialization overhead; batching cuts the crossing count down to the order of days/stocks. Each item carries its bar and, for windowed factors, the hfq close/
 * date window ENDING at the evaluation day; ctx.history slices tails of that window in-wall.
 */
export interface FactorBatchItem extends FactorHistory {
  bar: FactorBar;
}

export interface CompiledFactor extends Omit<CustomFactor, 'compute'> {
  /** One wall-crossing: per-item factor value (null = dropped: returned null / NaN / threw). */
  computeBatch(items: FactorBatchItem[]): Promise<(number | null)[]>;
  dispose(): void;
}

const FACTOR_SETUP = `
{
  const factor = __module.exports.default ?? __module.exports;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error('因子需 \`export default defineFactor({ name, compute(bar) { … } })\`');
  }
  if (!factor.name) {
    factor.name = '未命名因子';
  }
  __entries.meta = () => JSON.stringify({
    name: factor.name,
    window: factor.window ?? null,
    minCoverage: factor.minCoverage ?? null,
  });
  __entries.computeBatch = (itemsJson) => {
    const items = JSON.parse(itemsJson);
    const values = items.map((item) => {
      try {
        const ctx = new __factorSdk.CrossSectionalFactorContext(item);
        const value = factor.compute(item.bar, ctx);
        return value == null || !Number.isFinite(value) ? null : value;
      } catch (e) {
        __logs.push('[factor-error] ' + (e && e.message ? e.message : String(e)));
        return null;
      }
    });
    return JSON.stringify(values);
  };
}
`;

export async function compileFactor(
  source: string,
  onUserLog?: UserLogSink,
): Promise<CompiledFactor> {
  const userJs = await toCommonJs(source, 'factor code');
  const module: IsolatedModule = await loadIsolatedModule({
    userJs,
    noun: 'factor code',
    injectGlobals: `${await factorSdkSource()}\nglobalThis.defineFactor = __factorSdk.defineFactor;`,
    setup: FACTOR_SETUP,
  });
  let reportedComputeError = false;

  // Console lines (and caught compute errors) drain to the run-log sink after every crossing.
  const drainTo = (sink?: UserLogSink) => {
    if (!sink) {
      module.drainLogs();
      return;
    }
    for (const line of module.drainLogs()) {
      if (line.startsWith('[error] ')) {
        sink('error', line.slice('[error] '.length));
      } else if (line.startsWith('[warn] ')) {
        sink('warn', line.slice('[warn] '.length));
      } else if (line.startsWith('[factor-error] ')) {
        if (!reportedComputeError) {
          reportedComputeError = true;
          sink('error', line); // keep the prefix — analysis.ts uses it to surface the first error
        }
      } else {
        sink('info', line);
      }
    }
  };

  let meta: { name: string; window: number | null; minCoverage: number | null };
  try {
    meta = JSON.parse(await module.callJson('meta', [])) as typeof meta;
  } catch (e) {
    module.dispose();
    throw e;
  }

  return {
    name: meta.name,
    window: meta.window ?? undefined,
    minCoverage:
      meta.minCoverage != null && meta.minCoverage >= 0.1 && meta.minCoverage <= 1
        ? meta.minCoverage
        : undefined,
    async computeBatch(items) {
      const json = await module.callJson('computeBatch', [JSON.stringify(items)], {
        timeoutMs: 30_000, // a whole date's cross-section / a stock's full history per crossing
      });
      drainTo(onUserLog);
      return JSON.parse(json) as (number | null)[];
    },
    dispose: () => module.dispose(),
  };
}
