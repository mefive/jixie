import type { z } from 'zod';
import { SandboxBridgeBase } from '#infra/sandbox/sandbox-bridge-base.js';
import { TypeScriptTransport } from '#infra/sandbox/typescript/typescript-transport.js';
import { PythonSession } from '#infra/sandbox/python/python-session.js';
import { toCommonJs } from '#infra/sandbox/typescript/compile.js';
import type { SandboxFrame, SandboxTransport } from '#infra/sandbox/transport.js';
import type { RuntimeLogFrame } from '#infra/sandbox/protocol.js';
import type { SandboxBridgeInitializationOptions } from '#infra/sandbox/sandbox-bridge.js';
import type { UserLogSink } from '#infra/sandbox/console.js';
import type { FactorBar } from '@jixie/shared';
import type { FactorV2FieldKey } from '../definitions/fields.js';
import type {
  ExecutableFactorKind,
  FactorStartOptions,
  FactorComputeInput,
  FactorSandboxMetadata,
  FactorValues,
  FactorBatchItem,
} from './contract.js';
import { validateTypeScriptFactorMetadata, validatePythonFactorMetadata } from './metadata.js';
import { buildFactorSandboxBundle } from './typescript/sandbox-bundle.js';
import {
  factorStartupFrameSchema,
  factorComputeFrameSchema,
  typeScriptCrossSectionalStartupFrameSchema,
  typeScriptAssetStartupFrameSchema,
  typeScriptFactorComputeFrameSchema,
} from './protocol.js';

export type FactorTransport = SandboxTransport;

type FactorResultFrame = Extract<
  z.infer<typeof factorComputeFrameSchema>,
  { type: 'factor_values' }
>;

/**
 * 收集因子 Bridge 的通信与执行诊断。
 *
 * Collect factor bridge transport and execution diagnostics.
 */
interface FactorBridgeDiagnostics {
  language: 'TypeScript' | 'Python';
}

/**
 * 装配因子 Bridge 的传输、启动输入与宿主能力。
 *
 * Configure factor bridge transport, startup input and host capabilities.
 */
export interface FactorBridgeOptions<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  startupCommand: SandboxFrame;
  analysisKind: Kind;
  diagnostics: FactorBridgeDiagnostics;
  onUserLog?: UserLogSink;
}

/**
 * 定义因子 Bridge 可访问的稳定宿主能力。
 *
 * Define stable host capabilities available to the factor bridge.
 */
export interface FactorBridgeHost {
  abort(error: Error): void;
}

/** Owns the factor protocol connection and state across batches. */
export class FactorBridge<
  Kind extends ExecutableFactorKind = ExecutableFactorKind,
> extends SandboxBridgeBase<FactorComputeInput<Kind>, FactorValues, FactorSandboxMetadata<Kind>> {
  private static bundlePromise?: Promise<string>;

  private reportedComputeError = false;

  constructor(
    transport: FactorTransport,
    private readonly options: FactorBridgeOptions<Kind>,
    private readonly host: FactorBridgeHost,
  ) {
    super(transport);
  }

  static create<Kind extends ExecutableFactorKind>(
    options: FactorStartOptions<Kind>,
    host: FactorBridgeHost,
  ): Promise<FactorBridge<Kind>> {
    switch (options.language) {
      case 'python':
        return this.createPython(options, host);
      case 'typescript':
        return this.createTypeScript(options, host);
    }
  }

  /**
   * 准备 Python 因子启动参数并取得传输，失败时清理资源。
   *
   * Prepare Python factor startup and acquire its transport with failure cleanup.
   */
  private static async createPython<Kind extends ExecutableFactorKind>(
    { code, analysisKind, onUserLog }: FactorStartOptions<Kind>,
    host: FactorBridgeHost,
  ): Promise<FactorBridge<Kind>> {
    const transport = await PythonSession.connect();

    try {
      return new this(
        transport,
        {
          startupCommand: {
            type: 'factor_start',
            runtime_version: 'py-v1',
            analysis_kind: analysisKind,
            code,
          },
          analysisKind,
          diagnostics: { language: 'Python' },
          onUserLog,
        },
        host,
      );
    } catch (error) {
      try {
        transport.close();
      } catch {
        // Cleanup must preserve the bridge construction failure.
      }
      throw error;
    }
  }

  /**
   * 打包 TypeScript 因子 SDK 与运行入口并建立 isolate 传输。
   *
   * Bundle the TypeScript factor SDK and entry and create its isolate transport.
   */
  private static async createTypeScript<Kind extends ExecutableFactorKind>(
    { code, analysisKind, onUserLog }: FactorStartOptions<Kind>,
    host: FactorBridgeHost,
  ): Promise<FactorBridge<Kind>> {
    const userJs = await toCommonJs(code, 'factor code');
    FactorBridge.bundlePromise ??= buildFactorSandboxBundle().then(
      (bundle) => bundle.outputFiles[0].text,
    );

    const bundle = await FactorBridge.bundlePromise;
    const transport = await TypeScriptTransport.connect({
      bundle,
      description: 'factor code',
      memoryMb: 256,
      maxFrameBytes: 256 * 1024 * 1024,
      maxQueuedFrames: Number.MAX_SAFE_INTEGER,
      commandTimeoutMs: (frame) => (frame.type === 'factor_start' ? 5_000 : 30_000),
    });

    try {
      return new this(
        transport,
        {
          startupCommand: { type: 'factor_start', analysis_kind: analysisKind, userJs },
          analysisKind,
          diagnostics: { language: 'TypeScript' },
          onUserLog,
        },
        host,
      );
    } catch (error) {
      try {
        transport.close();
      } catch {
        // Cleanup must preserve the bridge construction failure.
      }
      throw error;
    }
  }

  async initialize({ signal }: SandboxBridgeInitializationOptions = {}): Promise<
    FactorSandboxMetadata<Kind>
  > {
    const metadata = await this.initializeMetadata(signal);

    // Initialization validates the returned kind before it reaches this generic boundary.
    return metadata as FactorSandboxMetadata<Kind>;
  }

  /**
   * 通过协议执行一次因子批次，收集日志并校验返回值形状。
   *
   * Execute one factor batch through the protocol, collecting logs and validating returned values.
   */
  execute(input: FactorComputeInput<Kind>): Promise<FactorValues> {
    const { diagnostics, analysisKind } = this.options;
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

    return this.exchange({
      command,
      schema:
        diagnostics.language === 'Python'
          ? factorComputeFrameSchema
          : typeScriptFactorComputeFrameSchema,
      operation:
        diagnostics.language === 'Python'
          ? `computing a ${analysisKind === 'cross_sectional' ? 'cross-sectional' : analysisKind} Python Factor`
          : 'computing a TypeScript Factor',
      onLog: (frame) => this.forwardLog(frame),
      result: (frame) => this.readComputeResult(frame, expectedCount),
    });
  }

  /**
   * 校验握手元数据与因子协议，成功后发布只读运行定义。
   *
   * Validate handshake metadata against the factor protocol before exposing the runtime definition.
   */
  private async initializeMetadata(signal?: AbortSignal): Promise<FactorSandboxMetadata> {
    const { analysisKind, startupCommand, diagnostics }: FactorBridgeOptions = this.options;

    if (diagnostics.language === 'Python') {
      const metadata = await this.exchange({
        command: startupCommand,
        schema: factorStartupFrameSchema,
        signal,
        operation:
          analysisKind === 'cross_sectional'
            ? 'starting a cross-sectional Python Factor'
            : 'starting an asset Python Factor',
        onLog: (frame) => this.forwardLog(frame),
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
      const metadata = await this.exchange({
        command: startupCommand,
        schema: typeScriptCrossSectionalStartupFrameSchema,
        signal,
        operation: 'starting a TypeScript Factor',
        onLog: (frame) => this.forwardLog(frame),
        result: (frame) => frame.metadata,
      });

      return {
        ...metadata,
        window: metadata.window ?? undefined,
        minCoverage: metadata.minCoverage ?? undefined,
      };
    }

    const metadata = await this.exchange({
      command: startupCommand,
      schema: typeScriptAssetStartupFrameSchema,
      signal,
      operation: 'starting a TypeScript Factor',
      onLog: (frame) => this.forwardLog(frame),
      result: (frame) => frame.metadata,
    });
    if (metadata.analysisKind !== analysisKind) {
      throw new Error('Factor analysis kind mismatch');
    }

    const normalized = { ...metadata, analysisKind, inputs: metadata.inputs as FactorV2FieldKey[] };
    validateTypeScriptFactorMetadata(normalized);

    return normalized;
  }

  /**
   * 按因子类型校验计算返回值的证券、日期与数值范围。
   *
   * Validate factor results against their kind-specific identities and numeric constraints.
   */
  private readComputeResult(frame: FactorResultFrame, expectedCount: number): FactorValues {
    const { diagnostics } = this.options;

    // Python reports point failures before rejecting a malformed result; TS reports them after.
    if (diagnostics.language === 'Python') {
      this.reportComputeError(frame.first_error);
    }

    if (frame.values.length !== expectedCount) {
      const error = new Error(
        diagnostics.language === 'Python'
          ? `invalid Python Factor result length: expected ${expectedCount}, received ${frame.values.length}`
          : 'Factor returned an unexpected score count',
      );
      this.host.abort(error);
      throw error;
    }

    if (diagnostics.language === 'TypeScript') {
      this.reportComputeError(frame.first_error);
    }

    return frame.values;
  }

  private forwardLog(frame: RuntimeLogFrame): void {
    this.options.onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text);
  }

  private reportComputeError(firstError: string | null): void {
    if (!this.reportedComputeError && firstError) {
      this.reportedComputeError = true;
      this.options.onUserLog?.('error', `[factor-error] ${firstError}`);
    }
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
