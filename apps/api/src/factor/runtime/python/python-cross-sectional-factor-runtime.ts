import { exchangeSandboxCommand } from '#infra/runtime/exchange.js';
import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { FactorBar } from '@jixie/shared';
import type { UserLogSink } from '#infra/runtime/console.js';
import { factorExecutionFrameSchema, factorStartupFrameSchema } from '../protocol.js';
import { PythonSession } from '#infra/runtime/python/session.js';
import type {
  CrossSectionalFactorInput,
  CrossSectionalFactorMetadata,
  FactorValues,
  FactorStartOptions,
  FactorBatchItem,
} from '../contract.js';

export class PythonCrossSectionalFactorRuntime extends SandboxRuntime<
  CrossSectionalFactorInput,
  FactorValues,
  CrossSectionalFactorMetadata
> {
  private reportedComputeError = false;
  private constructor(
    private readonly session: PythonSession,
    metadata: CrossSectionalFactorMetadata,
    private readonly onUserLog?: UserLogSink,
  ) {
    super(session, metadata);
  }

  static start({
    code,
    onUserLog,
  }: FactorStartOptions<'cross_sectional'>): Promise<PythonCrossSectionalFactorRuntime> {
    return startSandboxRuntime({
      createResource: () => PythonSession.connect(),
      initialize: async (session) => {
        const metadata = await exchangeSandboxCommand(session, {
          command: {
            type: 'factor_start',
            runtime_version: 'py-v1',
            analysis_kind: 'cross_sectional',
            code,
          },
          schema: factorStartupFrameSchema,
          operation: 'starting a cross-sectional Python Factor',
          onLog: (frame) =>
            onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
          result: (frame) => {
            if (frame.metadata.analysis_kind !== 'cross_sectional') {
              throw new Error(
                `Python Factor runtime returned ${frame.metadata.analysis_kind} metadata for a cross-sectional Factor`,
              );
            }
            return frame.metadata;
          },
        });
        return new PythonCrossSectionalFactorRuntime(
          session,
          {
            analysisKind: 'cross_sectional',
            name: metadata.name,
            window: metadata.window ?? undefined,
            minCoverage: metadata.min_coverage ?? undefined,
          },
          onUserLog,
        );
      },
    });
  }

  protected async executeInSandbox({
    items,
  }: CrossSectionalFactorInput): Promise<Array<number | null>> {
    return exchangeSandboxCommand(this.session, {
      command: { type: 'factor_compute_batch', items: items.map(pythonFactorBatchItem) },
      schema: factorExecutionFrameSchema,
      operation: 'computing a cross-sectional Python Factor',
      onLog: (frame) =>
        this.onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
      result: (frame) => {
        const firstError = frame.first_error;
        if (!this.reportedComputeError && typeof firstError === 'string' && firstError) {
          this.reportedComputeError = true;
          this.onUserLog?.('error', `[factor-error] ${firstError}`);
        }
        if (frame.values.length !== items.length) {
          const error = new Error(
            `invalid Python Factor result length: expected ${items.length}, received ${frame.values.length}`,
          );
          this.abort(error);
          throw error;
        }
        return frame.values;
      },
    });
  }
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
