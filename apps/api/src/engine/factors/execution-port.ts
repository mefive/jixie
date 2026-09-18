import type { FactorBar, MultiAssetClass } from '@jixie/shared';
import type { AssetFactorRuntimeMeta, CustomFactorHistoryField } from './custom-factor.js';

/** Metadata returned by a sandbox; it contains no executable source or host references. */
export type FactorDefinition =
  | {
      id: string;
      kind: 'cross_sectional';
      window?: number;
      historyFields: CustomFactorHistoryField[];
    }
  | {
      id: string;
      kind: 'asset_series';
      analysisKind: 'time_series' | 'panel';
      meta: AssetFactorRuntimeMeta;
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
