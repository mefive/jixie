import {
  exchangeSandboxCommand,
  type SandboxFrame,
  type SandboxTransport,
} from '#infra/runtime/exchange.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { FactorBar } from '@jixie/shared';
import type { FactorV2FieldKey } from '../definitions/fields.js';
import type {
  ExecutableFactorKind,
  FactorExecutionInput,
  FactorRuntimeMetadata,
  FactorValues,
  FactorBatchItem,
} from './contract.js';
import { validateTypeScriptFactorMetadata, validatePythonFactorMetadata } from './metadata.js';
import {
  factorStartupFrameSchema,
  factorExecutionFrameSchema,
  typeScriptCrossSectionalStartupFrameSchema,
  typeScriptAssetStartupFrameSchema,
  typeScriptFactorExecutionFrameSchema,
} from './protocol.js';

export type FactorTransport = SandboxTransport;

interface FactorBridgeDiagnostics {
  language: 'TypeScript' | 'Python';
}

export interface FactorBridgeOptions<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  startupCommand: SandboxFrame;
  analysisKind: Kind;
  diagnostics: FactorBridgeDiagnostics;
  onUserLog?: UserLogSink;
}

export interface FactorBridge<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  metadata: FactorRuntimeMetadata<Kind>;
  execute(input: FactorExecutionInput<Kind>, abort: (error: Error) => void): Promise<FactorValues>;
}

/** Share protocol state across batches; the runtime owns resource shutdown. */
export async function createFactorBridge<Kind extends ExecutableFactorKind>(
  session: FactorTransport,
  options: FactorBridgeOptions<Kind>,
): Promise<FactorBridge<Kind>> {
  const { diagnostics, analysisKind, onUserLog } = options;
  const onLog = (frame: { level: 'info' | 'warning' | 'error'; text: string }) =>
    onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text);
  const metadata = await initializeFactor(session, options, onLog);
  let reportedComputeError = false;

  return {
    // Initialization validates the returned kind before it reaches this generic boundary.
    metadata: metadata as FactorRuntimeMetadata<Kind>,
    execute(input, abort) {
      const crossSectional = 'items' in input;
      const expectedCount = crossSectional ? input.items.length : input.indexes.length;
      const command = crossSectional
        ? {
            type: 'factor_compute_batch',
            items:
              diagnostics.language === 'Python'
                ? input.items.map(pythonFactorBatchItem)
                : input.items,
          }
        : { type: 'factor_compute_series', fields: input.fields, indexes: input.indexes };
      const reportComputeError = (firstError: string | null) => {
        if (!reportedComputeError && firstError) {
          reportedComputeError = true;
          onUserLog?.('error', `[factor-error] ${firstError}`);
        }
      };

      return exchangeSandboxCommand(session, {
        command,
        schema:
          diagnostics.language === 'Python'
            ? factorExecutionFrameSchema
            : typeScriptFactorExecutionFrameSchema,
        operation:
          diagnostics.language === 'Python'
            ? `computing a ${analysisKind === 'cross_sectional' ? 'cross-sectional' : analysisKind} Python Factor`
            : 'computing a TypeScript Factor',
        onLog,
        result: (frame) => {
          // Python reports point failures before rejecting a malformed result; TS reports them after.
          if (diagnostics.language === 'Python') {
            reportComputeError(frame.first_error);
          }

          if (frame.values.length !== expectedCount) {
            const error = new Error(
              diagnostics.language === 'Python'
                ? `invalid Python Factor result length: expected ${expectedCount}, received ${frame.values.length}`
                : 'Factor returned an unexpected score count',
            );
            abort(error);
            throw error;
          }

          if (diagnostics.language === 'TypeScript') {
            reportComputeError(frame.first_error);
          }

          return frame.values;
        },
      });
    },
  };
}

async function initializeFactor(
  session: FactorTransport,
  options: FactorBridgeOptions,
  onLog: (frame: { level: 'info' | 'warning' | 'error'; text: string }) => void,
): Promise<FactorRuntimeMetadata> {
  const { analysisKind, startupCommand, diagnostics } = options;

  if (diagnostics.language === 'Python') {
    const metadata = await exchangeSandboxCommand(session, {
      command: startupCommand,
      schema: factorStartupFrameSchema,
      operation:
        analysisKind === 'cross_sectional'
          ? 'starting a cross-sectional Python Factor'
          : 'starting an asset Python Factor',
      onLog,
      result: (frame) => frame.metadata,
    });

    if (analysisKind === 'cross_sectional') {
      if (metadata.analysis_kind !== 'cross_sectional') {
        throw new Error(
          `Python Factor runtime returned ${metadata.analysis_kind} metadata for a cross-sectional Factor`,
        );
      }

      return {
        analysisKind: 'cross_sectional',
        name: metadata.name,
        window: metadata.window ?? undefined,
        minCoverage: metadata.min_coverage ?? undefined,
      };
    }

    if (metadata.analysis_kind === 'cross_sectional') {
      throw new Error(
        'Python Factor runtime returned cross-sectional metadata for an asset Factor',
      );
    }
    const normalized = {
      version: 2 as const,
      name: metadata.name,
      analysisKind: metadata.analysis_kind,
      outputScope: 'asset' as const,
      frequency: 'daily' as const,
      inputs: metadata.inputs as FactorV2FieldKey[],
      targetAssetClasses: metadata.target_asset_classes,
      window: metadata.window,
    };
    validatePythonFactorMetadata(normalized, analysisKind);

    return normalized;
  }

  if (analysisKind === 'cross_sectional') {
    const metadata = await exchangeSandboxCommand(session, {
      command: startupCommand,
      schema: typeScriptCrossSectionalStartupFrameSchema,
      operation: 'starting a TypeScript Factor',
      onLog,
      result: (frame) => frame.metadata,
    });

    return {
      ...metadata,
      window: metadata.window ?? undefined,
      minCoverage: metadata.minCoverage ?? undefined,
    };
  }

  const metadata = await exchangeSandboxCommand(session, {
    command: startupCommand,
    schema: typeScriptAssetStartupFrameSchema,
    operation: 'starting a TypeScript Factor',
    onLog,
    result: (frame) => frame.metadata,
  });
  if (metadata.analysisKind !== analysisKind) {
    throw new Error('Factor analysis kind mismatch');
  }
  const normalized = { ...metadata, analysisKind, inputs: metadata.inputs as FactorV2FieldKey[] };
  validateTypeScriptFactorMetadata(normalized);

  return normalized;
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
