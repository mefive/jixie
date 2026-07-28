import { action, makeObservable, observable } from 'mobx';
import type { MarketStateScope, MarketStateSnapshot } from '@jixie/shared';
import { fetchMarketState } from '@src/api/client';
import { BaseStore, LoaderModel } from '@src/lib';

export class MarketStore extends BaseStore {
  public marketScope: MarketStateScope = 'all';
  public marketStateLoader = new LoaderModel<MarketStateSnapshot>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      marketScope: observable.ref,
      setMarketScope: action,
    });
  }

  public setup() {
    super.setup();
    this.marketStateLoader.setup({
      request: (scope: MarketStateScope, signal) => fetchMarketState(scope, signal),
    });
    this.registCleaner(() => this.marketStateLoader.cleanup());

    void this.marketStateLoader.run(this.marketScope);
  }

  public setMarketScope(scope: MarketStateScope) {
    if (!scope || scope === this.marketScope) {
      return;
    }

    this.marketScope = scope;
    void this.marketStateLoader.run(scope);
  }
}
