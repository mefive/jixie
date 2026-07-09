import type { Locale } from '@jixie/shared';
import { runStrategy } from '../../engine/run.js';
import type { CustomFactorModule } from '../../engine/custom-factor.js';
import type { BacktestResult, CostModel } from '../../engine/types.js';
import type { UserLogSink } from '../../lib/sandbox-console.js';
import { compileStrategy } from './compile.js';

export interface CodeBacktestConfig {
  start: string; // YYYYMMDD
  end: string;
  initialCash: number;
  code: string; // user-authored TypeScript strategy module
  cost?: Partial<CostModel>;
  /** Host-prepared custom factor modules (prepare-custom-factors.ts) — the product path prepares
   * them in the worker; repo scripts that reference none may omit this. */
  customFactors?: CustomFactorModule[];
}

/** Compile a code strategy and run it through the engine. The code-first counterpart of runBacktestConfig
 * (which compiled an IR); same engine, same A-share rules — only the authoring substrate changed. */
export async function runCodeBacktest(
  cfg: CodeBacktestConfig,
  onLog?: (line: string) => void,
  onUserLog?: UserLogSink,
  locale?: Locale,
): Promise<BacktestResult> {
  const strategy = await compileStrategy(cfg.code, onUserLog, locale);
  return runStrategy({
    start: cfg.start,
    end: cfg.end,
    initialCash: cfg.initialCash,
    cost: cfg.cost,
    strategy,
    customFactors: cfg.customFactors,
    onLog,
    locale,
  });
}
