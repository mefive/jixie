import type { FactorBar, MultiAssetClass } from '@jixie/shared';
import type { FactorV2FieldKey } from '#factor/definitions/fields.js';

export type FactorHistoryField = 'turnoverRateF' | 'roe' | 'grossprofitMargin' | 'marketClose';

export interface FactorInputRequirements {
  window: number;
  inputs: FactorV2FieldKey[];
}

/** Computation and data requirements supplied by the factor host; no source or host references. */
export type FactorDefinition =
  | {
      id: string;
      kind: 'cross_sectional';
      window?: number;
      historyFields: FactorHistoryField[];
    }
  | {
      id: string;
      kind: 'asset_series';
      analysisKind: 'time_series' | 'panel';
      meta: FactorInputRequirements;
      assetUniverse?: Array<{ assetId: string; assetClass: MultiAssetClass }>;
    }
  | {
      id: string;
      kind: 'panel_composite';
      standardization: 'rank' | 'zscore';
      assetUniverse: Array<{ assetId: string; assetClass: MultiAssetClass }>;
      components: Array<{
        direction: 'positive' | 'negative';
        definition: Extract<FactorDefinition, { kind: 'asset_series' }>;
      }>;
    };

export interface FactorBatchInput {
  bar: FactorBar;
  closes?: number[];
  dates?: string[];
  amounts?: (number | null)[];
  turnoverRatesF?: (number | null)[];
  roes?: (number | null)[];
  grossProfitMargins?: (number | null)[];
  marketCloses?: (number | null)[];
}

/** Identifies only registered dependencies: callers cannot supply or replace source code. */
export type FactorComputeRequest =
  | { factorId: string; kind: 'cross_sectional'; items: FactorBatchInput[] }
  | { factorId: string; kind: 'asset_series'; fields: Record<string, number[]>; indexes: number[] };

export interface FactorExecutionPort {
  describe(): Promise<FactorDefinition[]>;
  compute(request: FactorComputeRequest): Promise<(number | null)[]>;
}
