import type { FactorMeta, FactorWeatherDirection, FactorWeatherResponse } from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  getFactorCatalog,
  getFactorWeather,
  pinFactorWeather,
  refreshFactorWeatherPin,
  unpinFactorWeather,
} from '@src/api/factor';

/**
 * 区分气象固定、刷新与移除变更，供 Loader 穷尽分派。
 * Discriminate weather pin, refresh and removal mutations for loader dispatch.
 */
type FactorWeatherMutation =
  | { kind: 'pin'; factorId: string; direction?: FactorWeatherDirection }
  | { kind: 'refresh'; pinId: string }
  | { kind: 'unpin'; pinId: string };

const POLL_INTERVAL_MS = 1_500;

export class FactorWeatherStore extends BaseStore {
  public weatherLoader = new LoaderModel<FactorWeatherResponse>();
  public catalogLoader = new LoaderModel<FactorMeta[]>();
  public mutationLoader = new LoaderModel<void>();
  public poller = new PollingModel();

  /**
   * 配置气象目录、变更和轮询 Loader，并注册页面退出清理。
   * Configure weather catalog, mutation and polling loaders with page cleanup.
   */
  public setup() {
    super.setup();
    this.weatherLoader.setup({ request: () => getFactorWeather() });
    this.catalogLoader.setup({ request: () => getFactorCatalog() });
    this.mutationLoader.setup({
      preserveResult: false,

      /**
       * 按固定、刷新或移除操作调用气象接口，供统一 Loader 管理状态。
       * Dispatch pin, refresh and unpin operations through the weather mutation loader.
       */
      request: async (mutation: FactorWeatherMutation) => {
        switch (mutation.kind) {
          case 'pin':
            await pinFactorWeather(mutation.factorId, mutation.direction);
            break;
          case 'refresh':
            await refreshFactorWeatherPin(mutation.pinId);
            break;
          case 'unpin':
            await unpinFactorWeather(mutation.pinId);
            break;
        }
      },
    });
    this.poller.setup({
      interval: POLL_INTERVAL_MS,
      request: async () => {
        try {
          const weather = await this.weatherLoader.run();
          return hasPendingPins(weather) ? undefined : false;
        } catch {
          return undefined;
        }
      },
    });
    this.registCleaner(() => this.weatherLoader.cleanup());
    this.registCleaner(() => this.catalogLoader.cleanup());
    this.registCleaner(() => this.mutationLoader.cleanup());
    this.registCleaner(() => this.poller.cleanup());

    void this.load().catch(() => {});
  }

  public async pin(factorId: string, direction?: FactorWeatherDirection): Promise<void> {
    await this.mutationLoader.run({ kind: 'pin', factorId, direction });
    await this.reloadAndPoll();
  }

  public async refresh(pinId: string): Promise<void> {
    await this.mutationLoader.run({ kind: 'refresh', pinId });
    await this.reloadAndPoll();
  }

  public async unpin(pinId: string): Promise<void> {
    await this.mutationLoader.run({ kind: 'unpin', pinId });
    await this.reloadAndPoll();
  }

  private async load(): Promise<void> {
    const [weather] = await Promise.all([this.weatherLoader.run(), this.catalogLoader.run()]);
    if (hasPendingPins(weather)) {
      this.poller.start();
    }
  }

  private async reloadAndPoll(): Promise<void> {
    const weather = await this.weatherLoader.run();
    if (hasPendingPins(weather)) {
      this.poller.start();
    }
  }
}

function hasPendingPins(weather: FactorWeatherResponse): boolean {
  return weather.pins.some((pin) => pin.status === 'pending' || pin.status === 'running');
}
