import type { FactorBar, MultiAssetClass } from '@jixie/shared';
import type { FactorV2FieldKey } from '#factor/definitions/fields.js';
import type { EngineDataRequirements } from '../data/engine-data.js';

/**
 * 限定可用于因子历史输入的市场字段，防止请求未声明的数据。
 * Constrain market fields that factor histories may request.
 */
export type FactorHistoryField = 'turnoverRateF' | 'roe' | 'grossprofitMargin' | 'marketClose';

/**
 * 声明因子运行需要的行情和辅助历史，指导引擎按需准备数据。
 * Declare price and auxiliary-history requirements for factor input preparation.
 */
export interface FactorInputRequirements {
  window: number;
  inputs: FactorV2FieldKey[];
}

/**
 * 向引擎提供因子计算及数据需求，不携带用户源码或宿主对象。
 * Computation and data requirements supplied by the factor host; no source or host references.
 */
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

/**
 * 按批次承载因子所需的证券、日期和数据输入，供独立执行端口计算。
 * Carry instruments, dates and prepared data for batch execution through the factor port.
 */
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

/**
 * 只允许请求已注册的因子依赖，不允许调用方传入或替换源码。
 * Identifies only registered dependencies: callers cannot supply or replace source code.
 */
export type FactorComputeRequest =
  | { factorId: string; kind: 'cross_sectional'; items: FactorBatchInput[] }
  | { factorId: string; kind: 'asset_series'; fields: Record<string, number[]>; indexes: number[] };

/**
 * 组合因子定义、依赖与所需输入的描述，供引擎规划预载。
 * Describe registered factors and their input requirements for engine preloading.
 */
export interface FactorDescription {
  definitions: FactorDefinition[];
  dataRequirements: EngineDataRequirements;
  preloadCodes: string[];
  assetClassByCode: Map<string, MultiAssetClass>;
}

/**
 * 隔离模拟引擎与因子代码执行，提供描述和计算能力而不暴露语言运行时。
 * Separate the simulation engine from factor code execution through description and computation capabilities.
 */
export interface FactorExecutionPort {
  describe(): Promise<FactorDescription>;
  compute(request: FactorComputeRequest): Promise<(number | null)[]>;
}
