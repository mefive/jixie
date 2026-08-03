import { action, makeObservable, observable } from 'mobx';
import type {
  IndustryWeatherSeries,
  MarketStateScope,
  MarketStateSnapshot,
  MarketWeatherFrequency,
} from '@jixie/shared';
import { fetchIndustryWeather, fetchMarketState } from '@src/api/client';
import { BaseStore, LoaderModel } from '@src/lib';

export class MarketStore extends BaseStore {
  public marketScope: MarketStateScope = 'all';
  public weatherFrequency: MarketWeatherFrequency = 'month';
  public marketStateLoader = new LoaderModel<MarketStateSnapshot>();
  public industryWeatherLoader = new LoaderModel<IndustryWeatherSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      marketScope: observable.ref,
      weatherFrequency: observable.ref,
      setMarketScope: action,
      setWeatherFrequency: action,
    });
  }

  public setup() {
    super.setup();
    this.marketStateLoader.setup({
      request: (scope: MarketStateScope, signal) => fetchMarketState(scope, signal),
    });
    this.industryWeatherLoader.setup({
      request: (frequency: MarketWeatherFrequency, signal) =>
        fetchIndustryWeather(frequency, signal),
    });
    this.registCleaner(() => this.marketStateLoader.cleanup());
    this.registCleaner(() => this.industryWeatherLoader.cleanup());

    void this.marketStateLoader.run(this.marketScope);
    void this.industryWeatherLoader.run(this.weatherFrequency);
  }

  public setMarketScope(scope: MarketStateScope) {
    if (!scope || scope === this.marketScope) {
      return;
    }

    this.marketScope = scope;
    void this.marketStateLoader.run(scope);
  }

  public setWeatherFrequency(frequency: MarketWeatherFrequency) {
    if (!frequency || frequency === this.weatherFrequency) {
      return;
    }

    this.weatherFrequency = frequency;
    void this.industryWeatherLoader.run(frequency);
  }
}
