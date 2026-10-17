import type { FactorLanguage, FactorBar } from '@jixie/shared';
import type { AssetFactorV2, CustomFactor } from '@jixie/shared/sdk/factor/contract';
import type { UserLogSink } from '#infra/sandbox/console.js';
import type { Sandbox } from '#infra/sandbox/sandbox.js';
import type { FactorV2FieldKey } from '../definitions/fields.js';

/**
 * 限定沙盒可执行因子种类，供输入与元数据分派。
 * Restrict executable factor kinds for input and metadata dispatch.
 */
export type ExecutableFactorKind = 'cross_sectional' | 'time_series' | 'panel';
export type AssetFactorKind = Exclude<ExecutableFactorKind, 'cross_sectional'>;

/**
 * 配置因子会话源码、语言和协议，供宿主启动。
 * Configure factor session source, language and protocol for startup.
 */
export interface FactorStartOptions<Kind extends ExecutableFactorKind = ExecutableFactorKind> {
  language: FactorLanguage;
  analysisKind: Kind;
  code: string;
  onUserLog?: UserLogSink;
}

/**
 * 提供按字段组织的因子历史，供 SDK 绑定读取。
 * Supply field-indexed factor histories for SDK binding.
 */
export interface FactorHistory {
  closes?: number[]; // tail window ending at the evaluation day (windowed factors only)
  dates?: string[]; // aligned trade dates for the window
  amounts?: (number | null)[]; // aligned daily turnover amounts (thousand yuan)
  turnoverRatesF?: (number | null)[]; // aligned free-float turnover rates for the window
  roes?: (number | null)[]; // aligned point-in-time ROE values (as-of announcement date)
  grossProfitMargins?: (number | null)[]; // aligned point-in-time gross margins
  marketCloses?: (number | null)[]; // aligned exact-date CSI All Share closes
}

/**
 * 绑定单证券或资产批次输入，供一次因子计算请求。
 * Associate instrument or asset inputs within a factor computation batch.
 */
export interface FactorBatchItem extends FactorHistory {
  bar: FactorBar;
}

/**
 * 提供横截面因子计算的证券、日期与市场字段。
 * Supply instruments, dates and fields for cross-sectional factor computation.
 */
export interface CrossSectionalFactorComputeInput {
  items: FactorBatchItem[];
}

/**
 * 提供资产范围因子的序列与元数据，保持各研究协议区别。
 * Supply series and metadata for asset-scope factor computation.
 */
export interface AssetFactorComputeInput {
  fields: Partial<Record<FactorV2FieldKey, number[]>>;
  indexes: number[];
}

export type FactorComputeInput<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends 'cross_sectional' ? CrossSectionalFactorComputeInput : AssetFactorComputeInput;

/**
 * 返回截面因子握手定义，供宿主验证输入声明。
 * Describe cross-sectional handshake metadata validated by the host.
 */
export interface CrossSectionalFactorSandboxMetadata extends Omit<CustomFactor, 'compute'> {
  analysisKind: 'cross_sectional';
}

/**
 * 返回资产范围因子握手定义，供宿主验证冻结协议。
 * Describe asset-scope handshake metadata validated against the frozen protocol.
 */
export interface AssetFactorSandboxMetadata<
  Kind extends AssetFactorKind = AssetFactorKind,
> extends Omit<AssetFactorV2, 'analysisKind' | 'inputs' | 'compute'> {
  analysisKind: Kind;
  // Controlled research templates support fields outside the editable TS SDK surface.
  inputs: FactorV2FieldKey[];
}

export type FactorSandboxMetadata<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends 'cross_sectional'
    ? CrossSectionalFactorSandboxMetadata
    : AssetFactorSandboxMetadata<Kind & AssetFactorKind>;

export type FactorValues = (number | null)[];

export type FactorSandboxInstance<Kind extends ExecutableFactorKind = ExecutableFactorKind> =
  Kind extends ExecutableFactorKind
    ? Pick<
        Sandbox<FactorComputeInput<Kind>, FactorValues, FactorSandboxMetadata<Kind>>,
        'metadata' | 'execute' | 'close'
      >
    : never;
export type CrossSectionalFactorSandbox = FactorSandboxInstance<'cross_sectional'>;
export type AssetFactorSandbox<Kind extends AssetFactorKind = AssetFactorKind> =
  FactorSandboxInstance<Kind>;
export type TimeSeriesFactorSandbox = FactorSandboxInstance<'time_series'>;
export type PanelFactorSandbox = FactorSandboxInstance<'panel'>;
