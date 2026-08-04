import { action, makeObservable, observable } from 'mobx';
import type {
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherSeries,
} from '@jixie/shared';
import { fetchMarketWeather } from '@src/api/client';
import { BaseStore, LoaderModel } from '@src/lib';

interface MarketWeatherRequest {
  dimension: MarketWeatherDimension;
  frequency: MarketWeatherFrequency;
}

export class MarketStore extends BaseStore {
  public weatherDimension: MarketWeatherDimension = 'industry';
  public weatherFrequency: MarketWeatherFrequency = 'month';
  public weatherLoader = new LoaderModel<MarketWeatherSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      weatherDimension: observable.ref,
      weatherFrequency: observable.ref,
      setWeatherDimension: action,
      setWeatherFrequency: action,
    });
  }

  public setup() {
    super.setup();
    this.weatherLoader.setup({
      request: ({ dimension, frequency }: MarketWeatherRequest, signal) =>
        fetchMarketWeather(dimension, frequency, signal),
    });
    this.registCleaner(() => this.weatherLoader.cleanup());

    this.loadWeather();
  }

  public setWeatherDimension(dimension: MarketWeatherDimension) {
    if (!dimension || dimension === this.weatherDimension) {
      return;
    }

    this.weatherDimension = dimension;
    this.loadWeather();
  }

  public setWeatherFrequency(frequency: MarketWeatherFrequency) {
    if (!frequency || frequency === this.weatherFrequency) {
      return;
    }

    this.weatherFrequency = frequency;
    this.loadWeather();
  }

  private loadWeather() {
    void this.weatherLoader.run({
      dimension: this.weatherDimension,
      frequency: this.weatherFrequency,
    });
  }
}
