import type { FactorLanguage, FactorBar } from '@jixie/shared';
import type { AssetFactorV2, CustomFactor } from '@jixie/shared/sdk/factor/contract';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { SandboxRuntime } from '#infra/runtime/sandbox-runtime.js';
import type { FactorHistory } from '../sdk/typescript.js';
import type { FactorV2FieldKey } from '../definitions/fields.js';

export type ExecutableFactorKind = 'cross_sectional' | 'time_series' | 'panel';
export type AssetFactorKind = Exclude<ExecutableFactorKind, 'cross_sectional'>;

export interface FactorStartOptions<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  language: FactorLanguage;
  analysisKind: Kind;
  code: string;
  onUserLog?: UserLogSink;
}

export interface FactorBatchItem extends FactorHistory {
  bar: FactorBar;
}

export interface CrossSectionalFactorInput {
  items: FactorBatchItem[];
}

export interface AssetFactorInput {
  fields: Partial<Record<FactorV2FieldKey, number[]>>;
  indexes: number[];
}

export interface CrossSectionalFactorMetadata extends Omit<CustomFactor, 'compute'> {
  analysisKind: 'cross_sectional';
}

export interface AssetFactorMetadata<Kind extends AssetFactorKind = AssetFactorKind> extends Omit<
  AssetFactorV2,
  'analysisKind' | 'inputs' | 'compute'
> {
  analysisKind: Kind;
  // Controlled research templates support fields outside the editable TS SDK surface.
  inputs: FactorV2FieldKey[];
}

export type FactorValues = (number | null)[];
export type CrossSectionalFactorRuntime = Pick<
  SandboxRuntime<CrossSectionalFactorInput, FactorValues, CrossSectionalFactorMetadata>,
  'metadata' | 'execute' | 'close'
>;
export type AssetFactorRuntime<Kind extends AssetFactorKind = AssetFactorKind> = Pick<
  SandboxRuntime<AssetFactorInput, FactorValues, AssetFactorMetadata<Kind>>,
  'metadata' | 'execute' | 'close'
>;
export type TimeSeriesFactorRuntime = AssetFactorRuntime<'time_series'>;
export type PanelFactorRuntime = AssetFactorRuntime<'panel'>;
export type FactorRuntimeInstance =
  | CrossSectionalFactorRuntime
  | TimeSeriesFactorRuntime
  | PanelFactorRuntime;
