import type { UserLogSink } from '../lib/sandbox-console.js';
import { PythonSession, type PythonFrame } from '../strategy/python/session.js';
import type {
  CompiledPanelFactor,
  CompiledTimeSeriesFactor,
} from './compile-time-series-factor.js';
import { FACTOR_V2_FIELDS, isFactorV2FieldKey, type FactorV2FieldKey } from './factor-v2-fields.js';

type AssetAnalysisKind = 'time_series' | 'panel';

interface PythonAssetMetadata {
  name: string;
  window: number;
  analysis_kind: AssetAnalysisKind;
  inputs: string[];
  target_asset_classes: string[];
}

export function compilePythonTimeSeriesFactor(
  code: string,
  onUserLog?: UserLogSink,
): Promise<CompiledTimeSeriesFactor> {
  return compilePythonAssetFactor(code, 'time_series', onUserLog);
}

export function compilePythonPanelFactor(
  code: string,
  onUserLog?: UserLogSink,
): Promise<CompiledPanelFactor> {
  return compilePythonAssetFactor(code, 'panel', onUserLog);
}

async function compilePythonAssetFactor<T extends AssetAnalysisKind>(
  code: string,
  analysisKind: T,
  onUserLog?: UserLogSink,
): Promise<T extends 'time_series' ? CompiledTimeSeriesFactor : CompiledPanelFactor> {
  const session = await PythonSession.connect();
  let reportedComputeError = false;
  try {
    await session.send({
      type: 'factor_start',
      runtime_version: 'py-v1',
      analysis_kind: analysisKind,
      code,
    });
    const metadata = await waitForMetadata(session, onUserLog);
    validateMetadata(metadata, analysisKind);
    return {
      version: 2,
      name: metadata.name,
      analysisKind,
      outputScope: 'asset',
      frequency: 'daily',
      inputs: metadata.inputs as FactorV2FieldKey[],
      targetAssetClasses: metadata.target_asset_classes as Array<
        'equity' | 'fixed_income' | 'commodity'
      >,
      window: metadata.window,
      async computeSeries(fields, indexes) {
        await session.send({ type: 'factor_compute_series', fields, indexes });
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
    } as T extends 'time_series' ? CompiledTimeSeriesFactor : CompiledPanelFactor;
  } catch (error) {
    session.close();
    throw error;
  }
}

async function waitForMetadata(
  session: PythonSession,
  onUserLog?: UserLogSink,
): Promise<PythonAssetMetadata> {
  while (true) {
    const frame = await session.read();
    if (forwardLog(frame, onUserLog)) {
      continue;
    }
    if (frame.type === 'factor_ready') {
      return frame.metadata as PythonAssetMetadata;
    }
    if (frame.type === 'fatal' || frame.type === 'error') {
      throw new Error(String(frame.message ?? 'Python Factor initialization failed'));
    }
    throw new Error(`unexpected Python Factor frame while starting: ${frame.type}`);
  }
}

function validateMetadata(metadata: PythonAssetMetadata, analysisKind: AssetAnalysisKind): void {
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

function forwardLog(frame: PythonFrame, onUserLog?: UserLogSink): boolean {
  if (frame.type !== 'log') {
    return false;
  }
  const level = frame.level === 'warning' ? 'warn' : frame.level === 'error' ? 'error' : 'info';
  onUserLog?.(level, String(frame.text ?? ''));
  return true;
}
