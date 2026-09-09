import type { AssetVisibility, SharingFactor, SharingCatalog } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import {
  copyFactor,
  copyFactorComposite,
  copyPublicStrategy,
  fetchSharingCatalog,
  setFactorVisibility,
  setStrategyVisibility,
} from '@src/api/client';

export class LibraryStore extends BaseStore<Record<string, never>> {
  public loader = new LoaderModel<SharingCatalog>();

  public setup(params: Record<string, never> = {}) {
    super.setup(params);
    this.loader.setup({ request: (_data, signal) => fetchSharingCatalog(signal) });
    this.registCleaner(() => this.loader.cleanup());
    void this.reload();
  }

  public async reload(): Promise<SharingCatalog> {
    return this.loader.run();
  }

  public async setStrategyVisibility(id: string, visibility: AssetVisibility): Promise<void> {
    await setStrategyVisibility(id, visibility);
    await this.reload();
  }

  public async setFactorVisibility(
    asset: SharingFactor,
    visibility: AssetVisibility,
  ): Promise<void> {
    await setFactorVisibility(asset.id, asset.kind, visibility);
    await this.reload();
  }

  public copyStrategy(id: string) {
    return copyPublicStrategy(id);
  }

  public copyFactor(asset: SharingFactor) {
    return asset.kind === 'composite' ? copyFactorComposite(asset.id) : copyFactor(asset.id);
  }
}
