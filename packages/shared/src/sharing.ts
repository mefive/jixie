export type AssetVisibility = 'private' | 'public';

/**
 * 共享公共资产身份、作者与可见范围，供公共库列表。
 * Describe shared public asset identity, author and visibility.
 */
export interface SharingAssetBase {
  id: string;
  name: string;
  author: string;
  owned: boolean;
  visibility: AssetVisibility;
  updatedAt: string;
}

/**
 * 提供可复制公开策略的配置与绩效摘要。
 * Describe a public strategy's copyable configuration and performance.
 */
export interface SharingStrategy extends SharingAssetBase {
  kind: 'strategy';
}

/**
 * 提供公开因子或组合的定义和批准证据。
 * Describe a public factor or composite definition and approval evidence.
 */
export interface SharingFactor extends SharingAssetBase {
  kind: 'factor' | 'composite';
  key: string;
  analysisKind: string;
  language?: 'typescript' | 'python';
}

/**
 * 组合公共策略与因子资源，供资产库检索。
 * Collect public strategies and factors for library discovery.
 */
export interface SharingCatalog {
  strategies: SharingStrategy[];
  factors: SharingFactor[];
  mine: {
    strategies: SharingStrategy[];
    factors: SharingFactor[];
  };
}
