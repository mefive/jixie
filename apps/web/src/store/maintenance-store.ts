import { action, makeObservable, observable, runInAction } from 'mobx';
import { fetchMaintenanceStatus, type MaintenanceStatus } from '@src/api/client';
import { LoaderModel, PollingModel } from '@src/lib';

class MaintenanceStore {
  public loader = new LoaderModel<MaintenanceStatus>();

  public polling = new PollingModel();

  public status: MaintenanceStatus | null = null;

  public serviceUnavailable = false;

  public constructor() {
    makeObservable(this, {
      status: observable.ref,
      serviceUnavailable: observable.ref,
      acceptStatus: action,
      acceptServiceUnavailable: action,
    });
    this.loader.setup({ request: () => fetchMaintenanceStatus() });
    this.polling.setup({
      interval: 5_000,
      request: async () => {
        try {
          const status = await fetchMaintenanceStatus();
          this.acceptStatus(status);
          return status.active ? undefined : false;
        } catch {
          this.acceptServiceUnavailable();
          return undefined;
        }
      },
    });
    window.addEventListener('jixie:maintenance', this.onMaintenance);
    window.addEventListener('jixie:service-unavailable', this.onServiceUnavailable);
  }

  public async load(): Promise<void> {
    try {
      const status = await this.loader.run();
      runInAction(() => this.acceptStatus(status));
    } catch {
      runInAction(() => this.acceptServiceUnavailable());
    }
  }

  public acceptStatus(status: MaintenanceStatus): void {
    const wasBlocking = this.status?.active === true || this.serviceUnavailable;
    this.status = status;
    this.serviceUnavailable = false;
    if (status.active && !this.polling.running) {
      this.polling.start();
    } else if (!status.active) {
      this.polling.stop();
      if (wasBlocking) {
        window.location.reload();
      }
    }
  }

  public acceptServiceUnavailable(): void {
    this.serviceUnavailable = true;
    if (!this.polling.running) {
      this.polling.start();
    }
  }

  private readonly onMaintenance = (event: Event): void => {
    const status = (event as CustomEvent<MaintenanceStatus>).detail;
    if (status) {
      this.acceptStatus(status);
    }
  };

  private readonly onServiceUnavailable = (): void => {
    this.acceptServiceUnavailable();
  };
}

export const maintenanceStore = new MaintenanceStore();
