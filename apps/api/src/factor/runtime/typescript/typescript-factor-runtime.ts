import { UserCodeError } from '#infra/errors.js';
import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import { TypeScriptTransport } from '#infra/runtime/typescript/transport.js';
import { toCommonJs } from '#infra/runtime/typescript/isolate-run.js';
import { exchangeSandboxCommand } from '#infra/runtime/exchange.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { buildFactorSandboxBundle } from './sandbox-bundle.js';
import {
  typeScriptAssetStartupFrameSchema,
  typeScriptCrossSectionalStartupFrameSchema,
  typeScriptFactorExecutionFrameSchema,
} from '../protocol.js';
import {
  FACTOR_V2_FIELDS,
  isFactorV2FieldKey,
  type FactorV2FieldKey,
} from '../../definitions/fields.js';
import type {
  AssetFactorKind,
  AssetFactorInput,
  AssetFactorMetadata,
  CrossSectionalFactorInput,
  CrossSectionalFactorMetadata,
  FactorStartOptions,
  FactorValues,
} from '../contract.js';

let bundlePromise: Promise<string> | undefined;
async function createTransport(): Promise<TypeScriptTransport> {
  bundlePromise ??= buildFactorSandboxBundle().then((bundle) => bundle.outputFiles[0].text);
  return TypeScriptTransport.connect({
    bundle: await bundlePromise,
    description: 'factor code',
    memoryMb: 256,
    maxFrameBytes: 256 * 1024 * 1024,
    maxQueuedFrames: Number.MAX_SAFE_INTEGER,
    commandTimeoutMs: (frame) => (frame.type === 'factor_start' ? 5_000 : 30_000),
  });
}

export class TypeScriptCrossSectionalFactorRuntime extends SandboxRuntime<
  CrossSectionalFactorInput,
  FactorValues,
  CrossSectionalFactorMetadata
> {
  private reportedComputeError = false;
  private constructor(
    private readonly transport: TypeScriptTransport,
    metadata: CrossSectionalFactorMetadata,
    private readonly onUserLog?: UserLogSink,
  ) {
    super(transport, metadata);
  }

  static async start({
    code,
    analysisKind,
    onUserLog,
  }: FactorStartOptions<'cross_sectional'>): Promise<TypeScriptCrossSectionalFactorRuntime> {
    const userJs = await toCommonJs(code, 'factor code');
    return startSandboxRuntime({
      createResource: createTransport,
      initialize: async (transport) => {
        const frameMetadata = await exchangeSandboxCommand(transport, {
          command: { type: 'factor_start', analysis_kind: analysisKind, userJs },
          schema: typeScriptCrossSectionalStartupFrameSchema,
          operation: 'starting a TypeScript Factor',
          onLog: (frame) =>
            onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
          result: (frame) => frame.metadata,
        });
        const metadata = {
          ...frameMetadata,
          window: frameMetadata.window ?? undefined,
          minCoverage: frameMetadata.minCoverage ?? undefined,
        };
        return new TypeScriptCrossSectionalFactorRuntime(transport, metadata, onUserLog);
      },
    });
  }

  protected executeInSandbox({ items }: CrossSectionalFactorInput): Promise<FactorValues> {
    return exchangeSandboxCommand(this.transport, {
      command: { type: 'factor_compute_batch', items },
      schema: typeScriptFactorExecutionFrameSchema,
      operation: 'computing a TypeScript Factor',
      onLog: (frame) =>
        this.onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
      result: (frame) => {
        if (frame.values.length !== items.length) {
          const error = new Error('Factor returned an unexpected score count');
          this.abort(error);
          throw error;
        }
        if (!this.reportedComputeError && frame.first_error) {
          this.reportedComputeError = true;
          this.onUserLog?.('error', `[factor-error] ${frame.first_error}`);
        }
        return frame.values;
      },
    });
  }
}

export class TypeScriptAssetFactorRuntime<Kind extends AssetFactorKind> extends SandboxRuntime<
  AssetFactorInput,
  FactorValues,
  AssetFactorMetadata<Kind>
> {
  private reportedComputeError = false;
  private constructor(
    private readonly transport: TypeScriptTransport,
    metadata: AssetFactorMetadata<Kind>,
    private readonly onUserLog?: UserLogSink,
  ) {
    super(transport, metadata);
  }

  static async start<Kind extends AssetFactorKind>({
    code,
    analysisKind,
    onUserLog,
  }: FactorStartOptions<Kind>): Promise<TypeScriptAssetFactorRuntime<Kind>> {
    const userJs = await toCommonJs(code, 'factor code');
    return startSandboxRuntime({
      createResource: createTransport,
      initialize: async (transport) => {
        const frameMetadata = await exchangeSandboxCommand(transport, {
          command: { type: 'factor_start', analysis_kind: analysisKind, userJs },
          schema: typeScriptAssetStartupFrameSchema,
          operation: 'starting a TypeScript Factor',
          onLog: (frame) =>
            onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
          result: (frame) => frame.metadata,
        });
        if (frameMetadata.analysisKind !== analysisKind) {
          throw new Error('Factor analysis kind mismatch');
        }
        const metadata = {
          ...frameMetadata,
          analysisKind,
          inputs: frameMetadata.inputs as FactorV2FieldKey[],
        };
        validateMeta(metadata);
        return new TypeScriptAssetFactorRuntime(transport, metadata, onUserLog);
      },
    });
  }

  protected executeInSandbox({ fields, indexes }: AssetFactorInput): Promise<FactorValues> {
    return exchangeSandboxCommand(this.transport, {
      command: { type: 'factor_compute_series', fields, indexes },
      schema: typeScriptFactorExecutionFrameSchema,
      operation: 'computing a TypeScript Factor',
      onLog: (frame) =>
        this.onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
      result: (frame) => {
        if (frame.values.length !== indexes.length) {
          const error = new Error('Factor returned an unexpected score count');
          this.abort(error);
          throw error;
        }
        if (!this.reportedComputeError && frame.first_error) {
          this.reportedComputeError = true;
          this.onUserLog?.('error', `[factor-error] ${frame.first_error}`);
        }
        return frame.values;
      },
    });
  }
}

function validateMeta(meta: AssetFactorMetadata): void {
  if (!meta.name?.trim()) {
    throw new UserCodeError('Factor V2 requires a name.');
  }
  if (!Array.isArray(meta.inputs) || meta.inputs.some((input) => !isFactorV2FieldKey(input))) {
    throw new UserCodeError('Factor V2 references an unknown input field.');
  }
  if (new Set(meta.inputs).size !== meta.inputs.length) {
    throw new UserCodeError('Factor V2 input fields must be unique.');
  }
  const allowedAssetClasses = new Set(['equity', 'fixed_income', 'commodity']);
  if (
    !Array.isArray(meta.targetAssetClasses) ||
    meta.targetAssetClasses.length === 0 ||
    meta.targetAssetClasses.some((assetClass) => !allowedAssetClasses.has(assetClass))
  ) {
    throw new UserCodeError('Factor V2 target asset classes are invalid.');
  }
  if (
    meta.inputs.some((input) =>
      meta.targetAssetClasses.some(
        (assetClass) => !FACTOR_V2_FIELDS[input].targetAssetClasses.includes(assetClass),
      ),
    )
  ) {
    throw new UserCodeError(
      'Factor V2 target asset classes are incompatible with its declared inputs.',
    );
  }
}
