import { makeObservable, observable, runInAction } from 'mobx';
import type { StockSeries } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { fetchStockSeries } from '@src/api/client';

type StockSetupParams = { code?: string };

/** Stock detail page store — loads one stock's OHLC/vol/pe series for the full-page K线/PE/量 chart. */
export class StockStore extends BaseStore<StockSetupParams> {
  public code = '';
  public seriesLoader = new LoaderModel<StockSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, { code: observable.ref });
  }

  public setup(params: StockSetupParams) {
    super.setup(params);
    runInAction(() => {
      this.code = params.code ?? '';
    });
    this.seriesLoader.setup({ request: () => fetchStockSeries(this.code) });
    this.registCleaner(() => this.seriesLoader.cleanup());
    if (this.code) {
      void this.seriesLoader.run();
    }
  }
}
