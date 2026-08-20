export type AssetVisibility = 'private' | 'public';

export interface LibraryAssetBase {
  id: string;
  name: string;
  author: string;
  owned: boolean;
  visibility: AssetVisibility;
  updatedAt: string;
}

export interface LibraryStrategy extends LibraryAssetBase {
  kind: 'strategy';
}

export interface LibraryFactor extends LibraryAssetBase {
  kind: 'factor' | 'composite';
  key: string;
  analysisKind: string;
  language?: 'typescript' | 'python';
}

export interface PublicLibrary {
  strategies: LibraryStrategy[];
  factors: LibraryFactor[];
  mine: {
    strategies: LibraryStrategy[];
    factors: LibraryFactor[];
  };
}
