import { exchangeSandboxCommand } from '#infra/runtime/exchange.js';
import { SandboxRuntime, startSandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { UserLogSink } from '#infra/runtime/console.js';
import { factorExecutionFrameSchema, factorStartupFrameSchema } from '../protocol.js';
import { PythonSession } from '#infra/runtime/python/session.js';
import type {
  AssetFactorKind,
  AssetFactorInput,
  AssetFactorMetadata,
  FactorValues,
  FactorStartOptions,
} from '../contract.js';
import {
  FACTOR_V2_FIELDS,
  isFactorV2FieldKey,
  type FactorV2FieldKey,
} from '../../definitions/fields.js';

interface PythonAssetMetadata {
  name: string;
  window: number;
  analysis_kind: AssetFactorKind;
  inputs: string[];
  target_asset_classes: string[];
}

export class PythonAssetFactorRuntime<Kind extends AssetFactorKind> extends SandboxRuntime<
  AssetFactorInput,
  FactorValues,
  AssetFactorMetadata<Kind>
> {
  private reportedComputeError = false;
  private constructor(
    private readonly session: PythonSession,
    metadata: AssetFactorMetadata<Kind>,
    private readonly onUserLog?: UserLogSink,
  ) {
    super(session, metadata);
  }

  static start<Kind extends AssetFactorKind>({
    code,
    analysisKind,
    onUserLog,
  }: FactorStartOptions<Kind>): Promise<PythonAssetFactorRuntime<Kind>> {
    return startSandboxRuntime({
      createResource: () => PythonSession.connect(),
      initialize: async (session) => {
        const metadata = await exchangeSandboxCommand(session, {
          command: {
            type: 'factor_start',
            runtime_version: 'py-v1',
            analysis_kind: analysisKind,
            code,
          },
          schema: factorStartupFrameSchema,
          operation: 'starting an asset Python Factor',
          onLog: (frame) =>
            onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
          result: (frame) => {
            if (frame.metadata.analysis_kind === 'cross_sectional') {
              throw new Error(
                'Python Factor runtime returned cross-sectional metadata for an asset Factor',
              );
            }
            return frame.metadata;
          },
        });
        validateMetadata(metadata, analysisKind);
        return new PythonAssetFactorRuntime(
          session,
          {
            version: 2,
            name: metadata.name,
            analysisKind,
            outputScope: 'asset',
            frequency: 'daily',
            inputs: metadata.inputs as FactorV2FieldKey[],
            targetAssetClasses: metadata.target_asset_classes,
            window: metadata.window,
          },
          onUserLog,
        );
      },
    });
  }

  protected async executeInSandbox({
    fields,
    indexes,
  }: AssetFactorInput): Promise<Array<number | null>> {
    return exchangeSandboxCommand(this.session, {
      command: { type: 'factor_compute_series', fields, indexes },
      schema: factorExecutionFrameSchema,
      operation: `computing a ${this.metadata.analysisKind} Python Factor`,
      onLog: (frame) =>
        this.onUserLog?.(frame.level === 'warning' ? 'warn' : frame.level, frame.text),
      result: (frame) => {
        const firstError = frame.first_error;
        if (!this.reportedComputeError && typeof firstError === 'string' && firstError) {
          this.reportedComputeError = true;
          this.onUserLog?.('error', `[factor-error] ${firstError}`);
        }
        if (frame.values.length !== indexes.length) {
          const error = new Error(
            `invalid Python Factor result length: expected ${indexes.length}, received ${frame.values.length}`,
          );
          this.abort(error);
          throw error;
        }
        return frame.values;
      },
    });
  }
}

function validateMetadata(metadata: PythonAssetMetadata, analysisKind: AssetFactorKind): void {
  if (metadata.analysis_kind !== analysisKind || !metadata.name?.trim()) {
    throw new Error(`Python ${analysisKind} Factor metadata is invalid.`);
  }
  if (
    !Array.isArray(metadata.inputs) ||
    metadata.inputs.length === 0 ||
    metadata.inputs.some((input) => !isFactorV2FieldKey(input)) ||
    new Set(metadata.inputs).size !== metadata.inputs.length
  ) {
    throw new Error('Python Factor references invalid or duplicate input fields.');
  }
  const targetAssetClasses = metadata.target_asset_classes;
  const allowed = new Set(['equity', 'fixed_income', 'commodity']);
  if (
    !Array.isArray(targetAssetClasses) ||
    targetAssetClasses.length === 0 ||
    targetAssetClasses.some((assetClass) => !allowed.has(assetClass))
  ) {
    throw new Error('Python Factor target asset classes are invalid.');
  }
  for (const input of metadata.inputs) {
    if (
      targetAssetClasses.some(
        (assetClass) =>
          !FACTOR_V2_FIELDS[input as FactorV2FieldKey].targetAssetClasses.includes(
            assetClass as 'equity' | 'fixed_income' | 'commodity',
          ),
      )
    ) {
      throw new Error('Python Factor target asset classes are incompatible with its inputs.');
    }
  }
}
