import { loadIsolatedModule, toCommonJs, type IsolatedModule } from '../lib/isolate-run.js';
import type { UserLogSink } from '../lib/sandbox-console.js';
import { FACTOR_V2_FIELDS, isFactorV2FieldKey, type FactorV2FieldKey } from './factor-v2-fields.js';

type AssetFactorAnalysisKind = 'time_series' | 'panel';

interface AssetFactorDefinitionMeta<TAnalysisKind extends AssetFactorAnalysisKind> {
  version: 2;
  name: string;
  analysisKind: TAnalysisKind;
  outputScope: 'asset';
  frequency: 'daily';
  inputs: FactorV2FieldKey[];
  targetAssetClasses: Array<'equity' | 'fixed_income' | 'commodity'>;
  window: number;
}

export type TimeSeriesFactorDefinitionMeta = AssetFactorDefinitionMeta<'time_series'>;
export type PanelFactorDefinitionMeta = AssetFactorDefinitionMeta<'panel'>;

export interface CompiledTimeSeriesFactor extends TimeSeriesFactorDefinitionMeta {
  /** Computes one score per requested index. All declared field arrays are aligned by trade date. */
  computeSeries(
    fields: Partial<Record<FactorV2FieldKey, number[]>>,
    indexes: number[],
  ): Promise<(number | null)[]>;
  dispose(): void;
}

export interface CompiledPanelFactor extends PanelFactorDefinitionMeta {
  /** Computes one score per requested index. All declared field arrays are aligned by trade date. */
  computeSeries(
    fields: Partial<Record<FactorV2FieldKey, number[]>>,
    indexes: number[],
  ): Promise<(number | null)[]>;
  dispose(): void;
}

const ASSET_FACTOR_SETUP = `
{
  const expectedAnalysisKind = globalThis.__expectedAnalysisKind;
  const factor = __module.exports.default ?? __module.exports;
  if (!factor || typeof factor.compute !== 'function') {
    throw new Error('Factor V2 requires export default defineFactorV2({ ..., compute(ctx) { ... } })');
  }
  if (factor.version !== 2 || factor.analysisKind !== expectedAnalysisKind || factor.outputScope !== 'asset') {
    throw new Error('Factor V2 ' + expectedAnalysisKind + ' definitions require version=2, analysisKind=' + expectedAnalysisKind + ', outputScope=asset');
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
  const declaredInputs = new Set(factor.inputs);
  const access = (fields, index, field, lag) => {
    if (!declaredInputs.has(field)) {
      throw new Error('Factor code accessed undeclared input ' + field);
    }
    if (!Number.isInteger(lag) || lag < 0) {
      throw new Error('ctx.lag periods must be a non-negative integer');
    }
    const values = fields[field];
    const value = values && values[index - lag];
    return Number.isFinite(value) ? value : null;
  };
  __entries.meta = () => JSON.stringify({
    version: factor.version,
    name: factor.name,
    analysisKind: factor.analysisKind,
    outputScope: factor.outputScope,
    frequency: factor.frequency,
    inputs: factor.inputs,
    targetAssetClasses: factor.targetAssetClasses,
    window: factor.window,
  });
  __entries.computeSeries = (fieldsJson, indexesJson) => {
    const fields = JSON.parse(fieldsJson);
    const indexes = JSON.parse(indexesJson);
    const values = indexes.map((index) => {
      try {
        const ctx = {
          value(field) { return access(fields, index, field, 0); },
          lag(field, periods) { return access(fields, index, field, periods); },
        };
        const value = factor.compute(ctx);
        return value == null || !Number.isFinite(value) ? null : value;
      } catch (error) {
        __logs.push('[factor-error] ' + (error && error.message ? error.message : String(error)));
        return null;
      }
    });
    return JSON.stringify(values);
  };
}
`;

export async function compileTimeSeriesFactor(
  source: string,
  onUserLog?: UserLogSink,
): Promise<CompiledTimeSeriesFactor> {
  return compileAssetFactor(source, 'time_series', onUserLog);
}

export async function compilePanelFactor(
  source: string,
  onUserLog?: UserLogSink,
): Promise<CompiledPanelFactor> {
  return compileAssetFactor(source, 'panel', onUserLog);
}

async function compileAssetFactor<TAnalysisKind extends AssetFactorAnalysisKind>(
  source: string,
  analysisKind: TAnalysisKind,
  onUserLog?: UserLogSink,
): Promise<TAnalysisKind extends 'time_series' ? CompiledTimeSeriesFactor : CompiledPanelFactor> {
  const userJs = await toCommonJs(source, 'Factor V2 code');
  const module: IsolatedModule = await loadIsolatedModule({
    userJs,
    noun: 'Factor V2 code',
    injectGlobals: `globalThis.defineFactorV2 = (factor) => factor; globalThis.__expectedAnalysisKind = ${JSON.stringify(analysisKind)};`,
    setup: ASSET_FACTOR_SETUP,
  });

  let meta: AssetFactorDefinitionMeta<TAnalysisKind>;
  try {
    meta = JSON.parse(
      await module.callJson('meta', []),
    ) as AssetFactorDefinitionMeta<TAnalysisKind>;
    validateMeta(meta);
  } catch (error) {
    module.dispose();
    throw error;
  }

  let reportedComputeError = false;
  const drainLogs = () => {
    for (const line of module.drainLogs()) {
      if (!onUserLog) {
        continue;
      }
      if (line.startsWith('[factor-error] ')) {
        if (!reportedComputeError) {
          reportedComputeError = true;
          onUserLog('error', line);
        }
      } else if (line.startsWith('[error] ')) {
        onUserLog('error', line.slice('[error] '.length));
      } else if (line.startsWith('[warn] ')) {
        onUserLog('warn', line.slice('[warn] '.length));
      } else {
        onUserLog('info', line);
      }
    }
  };

  return {
    ...meta,
    async computeSeries(fields: Partial<Record<FactorV2FieldKey, number[]>>, indexes: number[]) {
      const result = await module.callJson(
        'computeSeries',
        [JSON.stringify(fields), JSON.stringify(indexes)],
        { timeoutMs: 30_000 },
      );
      drainLogs();
      return JSON.parse(result) as (number | null)[];
    },
    dispose: () => module.dispose(),
  } as unknown as TAnalysisKind extends 'time_series'
    ? CompiledTimeSeriesFactor
    : CompiledPanelFactor;
}

function validateMeta(meta: AssetFactorDefinitionMeta<AssetFactorAnalysisKind>): void {
  if (!meta.name?.trim()) {
    throw new Error('Factor V2 requires a name.');
  }
  if (!Array.isArray(meta.inputs) || meta.inputs.some((input) => !isFactorV2FieldKey(input))) {
    throw new Error('Factor V2 references an unknown input field.');
  }
  if (new Set(meta.inputs).size !== meta.inputs.length) {
    throw new Error('Factor V2 input fields must be unique.');
  }
  const allowedAssetClasses = new Set(['equity', 'fixed_income', 'commodity']);
  if (
    !Array.isArray(meta.targetAssetClasses) ||
    meta.targetAssetClasses.length === 0 ||
    meta.targetAssetClasses.some((assetClass) => !allowedAssetClasses.has(assetClass))
  ) {
    throw new Error('Factor V2 target asset classes are invalid.');
  }
  if (
    meta.inputs.some((input) =>
      meta.targetAssetClasses.some(
        (assetClass) => !FACTOR_V2_FIELDS[input].targetAssetClasses.includes(assetClass),
      ),
    )
  ) {
    throw new Error('Factor V2 target asset classes are incompatible with its declared inputs.');
  }
}
