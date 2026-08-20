import type { FactorBar } from '@jixie/shared';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { PythonSession, type PythonFrame } from '../strategy/python/session.js';
import type { CompiledFactor, FactorBatchItem } from './compile-factor.js';

interface PythonFactorMetadata {
  name: string;
  window: number | null;
  min_coverage: number | null;
}

/** Compile one py-v1 cross-sectional Factor in the sandboxd Python process. */
export async function compilePythonCrossSectionalFactor(
  code: string,
  onUserLog?: UserLogSink,
): Promise<CompiledFactor> {
  const session = await PythonSession.connect();
  let reportedComputeError = false;
  try {
    await session.send({
      type: 'factor_start',
      runtime_version: 'py-v1',
      analysis_kind: 'cross_sectional',
      code,
    });
    const metadata = await waitForMetadata(session, onUserLog);
    return {
      name: metadata.name,
      window: metadata.window ?? undefined,
      minCoverage: metadata.min_coverage ?? undefined,
      async computeBatch(items) {
        await session.send({
          type: 'factor_compute_batch',
          items: items.map(pythonFactorBatchItem),
        });
        while (true) {
          const frame = await session.read();
          if (forwardLog(frame, onUserLog)) {
            continue;
          }
          if (frame.type === 'factor_values') {
            const firstError = frame.first_error;
            if (!reportedComputeError && typeof firstError === 'string' && firstError) {
              reportedComputeError = true;
              onUserLog?.('error', `[factor-error] ${firstError}`);
            }
            return frame.values as (number | null)[];
          }
          if (frame.type === 'fatal' || frame.type === 'error') {
            throw new Error(String(frame.message ?? 'Python Factor execution failed'));
          }
          throw new Error(`unexpected Python Factor frame during compute: ${frame.type}`);
        }
      },
      dispose() {
        session.close();
      },
    };
  } catch (error) {
    session.close();
    throw error;
  }
}

async function waitForMetadata(
  session: PythonSession,
  onUserLog?: UserLogSink,
): Promise<PythonFactorMetadata> {
  while (true) {
    const frame = await session.read();
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'factor_ready') {
      return frame.metadata as PythonFactorMetadata;
    }
    if (frame.type === 'fatal' || frame.type === 'error') {
      throw new Error(String(frame.message ?? 'Python Factor initialization failed'));
    }
    throw new Error(`unexpected Python Factor frame while starting: ${frame.type}`);
  }
}

function forwardLog(frame: PythonFrame, onUserLog?: UserLogSink): boolean {
  if (frame.type !== 'log') {
    return false;
  }
  const level = frame.level === 'warning' ? 'warn' : frame.level === 'error' ? 'error' : 'info';
  onUserLog?.(level, String(frame.text ?? ''));
  return true;
}

function pythonFactorBatchItem(item: FactorBatchItem): Record<string, unknown> {
  const history = item.closes
    ? {
        close: item.closes,
        date: item.dates ?? [],
        amount: item.amounts ?? [],
        turnover_rate_f: item.turnoverRatesF ?? [],
        roe: item.roes ?? [],
        grossprofit_margin: item.grossProfitMargins ?? [],
        market_close: item.marketCloses ?? [],
      }
    : undefined;
  return { bar: pythonFactorBar(item.bar), history };
}

function pythonFactorBar(bar: FactorBar): Record<string, unknown> {
  return {
    code: bar.code,
    pe: bar.pe,
    pe_ttm: bar.peTtm,
    pb: bar.pb,
    ps: bar.ps,
    ps_ttm: bar.psTtm,
    dv_ratio: bar.dvRatio,
    dv_ttm: bar.dvTtm,
    total_mv: bar.totalMv,
    circ_mv: bar.circMv,
    turnover_rate: bar.turnoverRate,
    net_main: bar.netMain,
    net_total: bar.netTotal,
    roe: bar.roe,
    roa: bar.roa,
    grossprofit_margin: bar.grossprofitMargin,
    debt_to_assets: bar.debtToAssets,
  };
}
