export type AssetVisibility = 'private' | 'public';

export interface SharingAssetBase {
  id: string;
  name: string;
  author: string;
  owned: boolean;
  visibility: AssetVisibility;
  updatedAt: string;
}

export interface SharingStrategy extends SharingAssetBase {
  kind: 'strategy';
}

export interface SharingFactor extends SharingAssetBase {
  kind: 'factor' | 'composite';
  key: string;
  analysisKind: string;
  language?: 'typescript' | 'python';
}

export interface SharingCatalog {
  strategies: SharingStrategy[];
  factors: SharingFactor[];
  mine: {
    strategies: SharingStrategy[];
    factors: SharingFactor[];
  };
}
