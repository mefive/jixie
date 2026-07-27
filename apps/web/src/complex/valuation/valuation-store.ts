import { action, makeObservable, observable } from 'mobx';
import type { IndexValuationCatalog, IndexValuationSeries } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { fetchIndexValuationCatalog, fetchIndexValuationSeries } from '@src/api/client';

type ValuationSetupParams = { code?: string };

const DEFAULT_INDEX_CODE = '000300.SH';

export class ValuationStore extends BaseStore<ValuationSetupParams> {
  public code = DEFAULT_INDEX_CODE;
  public catalogLoader = new LoaderModel<IndexValuationCatalog>();
  public seriesLoader = new LoaderModel<IndexValuationSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      code: observable.ref,
      setCode: action,
    });
  }

  public setup(params: ValuationSetupParams) {
    super.setup(params);
    this.code = params.code || DEFAULT_INDEX_CODE;
    this.catalogLoader.setup({
      request: (_data, signal) => fetchIndexValuationCatalog(signal),
    });
    this.seriesLoader.setup({
      request: (code: string, signal) => fetchIndexValuationSeries(code, signal),
    });
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.seriesLoader.cleanup());

    void this.catalogLoader.run();
    void this.seriesLoader.run(this.code);
  }

  public setCode(code: string) {
    if (!code || code === this.code) {
      return;
    }

    this.code = code;
    void this.seriesLoader.run(code);
  }
}
