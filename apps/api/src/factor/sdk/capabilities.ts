/**
 * 表示 SDK 历史读取返回的值，供公开辅助方法使用。
 * Describe values returned by SDK history capabilities.
 */
export type FactorHistoryValues = number[] | string[] | (number | null)[];

/**
 * 定义截面作者 SDK 所需原始能力，不依赖宿主 runtime。
 * Declare primitive capabilities required by the cross-sectional author SDK.
 */
export interface CrossSectionalFactorCapabilities {
  readonly hasHistory: boolean;
  historyValues(field?: string): FactorHistoryValues | undefined;
}

/**
 * 定义资产作者 SDK 所需历史与字段能力，不依赖宿主 runtime。
 * Declare historical and field capabilities required by the asset author SDK.
 */
export interface AssetFactorCapabilities {
  declaresInput(field: string): boolean;
  valueAt(field: string, periods: number): number | undefined;
}
