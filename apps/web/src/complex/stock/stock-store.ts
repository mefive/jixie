import { makeObservable, observable, runInAction } from 'mobx';
import type { ResearchAssetTypeV1, StockSeries } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { fetchObjectSeries } from '@src/api/client';

type StockSetupParams = { assetType?: string; id?: string };

/** Stock detail page store — loads one stock's OHLC/vol/pe series for the full-page candlestick/PE/volume chart. */
export class StockStore extends BaseStore<StockSetupParams> {
  public assetType: ResearchAssetTypeV1 = 'stock';
  public id = '';
  public seriesLoader = new LoaderModel<StockSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, { assetType: observable.ref, id: observable.ref });
  }

  public setup(params: StockSetupParams) {
    super.setup(params);
    runInAction(() => {
      this.assetType = isAssetType(params.assetType) ? params.assetType : 'stock';
      this.id = params.id ?? '';
    });
    this.seriesLoader.setup({ request: () => fetchObjectSeries(this.assetType, this.id) });
    this.registCleaner(() => this.seriesLoader.cleanup());
    if (this.id) {
      void this.seriesLoader.run();
    }
  }
}

function isAssetType(value: string | undefined): value is ResearchAssetTypeV1 {
  return value === 'stock' || value === 'etf' || value === 'index' || value === 'future';
}
