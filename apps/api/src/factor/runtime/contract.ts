import type { FactorLanguage, FactorBar } from '@jixie/shared';
import type { AssetFactorV2, CustomFactor } from '@jixie/shared/sdk/factor/contract';
import type { UserLogSink } from '#infra/runtime/console.js';
import type { SandboxRuntime, SandboxResource } from '#infra/runtime/sandbox-runtime.js';
import type { FactorBridgeOptions, FactorTransport } from './bridge.js';
import type { FactorV2FieldKey } from '../definitions/fields.js';

export type ExecutableFactorKind = 'cross_sectional' | 'time_series' | 'panel';
export type AssetFactorKind = Exclude<ExecutableFactorKind, 'cross_sectional'>;

export interface FactorStartOptions<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  language: FactorLanguage;
  analysisKind: Kind;
  code: string;
  onUserLog?: UserLogSink;
}

export interface FactorHistory {
  closes?: number[]; // tail window ending at the evaluation day (windowed factors only)
  dates?: string[]; // aligned trade dates for the window
  amounts?: (number | null)[]; // aligned daily turnover amounts (thousand yuan)
  turnoverRatesF?: (number | null)[]; // aligned free-float turnover rates for the window
  roes?: (number | null)[]; // aligned point-in-time ROE values (as-of announcement date)
  grossProfitMargins?: (number | null)[]; // aligned point-in-time gross margins
  marketCloses?: (number | null)[]; // aligned exact-date CSI All Share closes
}

export interface FactorBatchItem extends FactorHistory {
  bar: FactorBar;
}

export interface CrossSectionalFactorExecutionInput {
  items: FactorBatchItem[];
}

export interface AssetFactorExecutionInput {
  fields: Partial<Record<FactorV2FieldKey, number[]>>;
  indexes: number[];
}

export type FactorExecutionInput<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends 'cross_sectional' ? CrossSectionalFactorExecutionInput : AssetFactorExecutionInput;

export interface CrossSectionalFactorRuntimeMetadata extends Omit<CustomFactor, 'compute'> {
  analysisKind: 'cross_sectional';
}

export interface AssetFactorRuntimeMetadata<
  Kind extends AssetFactorKind = AssetFactorKind,
> extends Omit<AssetFactorV2, 'analysisKind' | 'inputs' | 'compute'> {
  analysisKind: Kind;
  // Controlled research templates support fields outside the editable TS SDK surface.
  inputs: FactorV2FieldKey[];
}

export type FactorRuntimeMetadata<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends 'cross_sectional'
    ? CrossSectionalFactorRuntimeMetadata
    : AssetFactorRuntimeMetadata<Kind & AssetFactorKind>;

export type FactorValues = (number | null)[];
export type FactorRuntimeInstance<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends ExecutableFactorKind
    ? Pick<
        SandboxRuntime<FactorExecutionInput<Kind>, FactorValues, FactorRuntimeMetadata<Kind>>,
        'metadata' | 'execute' | 'close'
      >
    : never;
export type CrossSectionalFactorRuntime = FactorRuntimeInstance<'cross_sectional'>;
export type AssetFactorRuntime<Kind extends AssetFactorKind = AssetFactorKind> =
  FactorRuntimeInstance<Kind>;
export type TimeSeriesFactorRuntime = FactorRuntimeInstance<'time_series'>;
export type PanelFactorRuntime = FactorRuntimeInstance<'panel'>;

/** Language-specific startup inputs; the shared runtime owns acquisition and initialization. */
export interface FactorRuntimePreparation<
  Kind extends ExecutableFactorKind = ExecutableFactorKind,
> {
  createResource(): Promise<FactorTransport & SandboxResource>;
  bridgeOptions: FactorBridgeOptions<Kind>;
}
