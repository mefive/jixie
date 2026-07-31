import { action, makeObservable, observable, runInAction } from 'mobx';
import { fetchMaintenanceStatus, type MaintenanceStatus } from '@src/api/client';
import { LoaderModel, PollingModel } from '@src/lib';

class MaintenanceStore {
  public loader = new LoaderModel<MaintenanceStatus>();

  public polling = new PollingModel();

  public status: MaintenanceStatus | null = null;

  public constructor() {
    makeObservable(this, {
      status: observable.ref,
      acceptStatus: action,
    });
    this.loader.setup({ request: () => fetchMaintenanceStatus() });
    this.polling.setup({
      interval: 5_000,
      request: async () => {
        const status = await fetchMaintenanceStatus();
        this.acceptStatus(status);
        return status.active ? undefined : false;
      },
    });
    window.addEventListener('jixie:maintenance', this.onMaintenance);
  }

  public async load(): Promise<void> {
    const status = await this.loader.run().catch((): null => null);
    if (status) {
      runInAction(() => this.acceptStatus(status));
    }
  }

  public acceptStatus(status: MaintenanceStatus): void {
    const wasActive = this.status?.active === true;
    this.status = status;
    if (status.active && !this.polling.running) {
      this.polling.start();
    } else if (!status.active) {
      this.polling.stop();
      if (wasActive) {
        window.location.reload();
      }
    }
  }

  private readonly onMaintenance = (event: Event): void => {
    const status = (event as CustomEvent<MaintenanceStatus>).detail;
    if (status) {
      this.acceptStatus(status);
    }
  };
}

export const maintenanceStore = new MaintenanceStore();
