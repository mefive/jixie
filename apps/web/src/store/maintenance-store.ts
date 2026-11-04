import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  fetchIngestionStatus,
  fetchIngestionIssues,
  type IngestionStatus,
} from '@src/api/maintenance';
import type { IngestionIssueList } from '@jixie/shared/api/ingestion';
import { LoaderModel, PollingModel } from '@src/lib';

class MaintenanceStore {
  public loader = new LoaderModel<IngestionStatus>();
  public issuesLoader = new LoaderModel<IngestionIssueList>();

  public polling = new PollingModel();

  public status: IngestionStatus | null = null;

  public serviceUnavailable = false;

  public constructor() {
    makeObservable(this, {
      status: observable.ref,
      serviceUnavailable: observable.ref,
      acceptStatus: action,
      acceptServiceUnavailable: action,
    });
    this.loader.setup({ request: () => fetchIngestionStatus() });
    this.issuesLoader.setup({
      request: (offset: number, signal) => fetchIngestionIssues(offset, signal),
    });
    this.polling.setup({
      interval: 5_000,
      request: async () => {
        try {
          const status = await fetchIngestionStatus();
          this.acceptStatus(status);
          return undefined;
        } catch {
          this.acceptServiceUnavailable();
          return undefined;
        }
      },
    });
    window.addEventListener('jixie:maintenance', this.onMaintenance);
    window.addEventListener('jixie:service-unavailable', this.onServiceUnavailable);
  }

  public async loadIssues(offset = 0): Promise<void> {
    try {
      await this.issuesLoader.run(offset);
    } catch {
      // Loader 保留错误状态供弹层展示；关闭弹层时的取消无需额外通知。
      // The loader retains errors for the drawer; cancellation on close needs no extra notification.
    }
  }

  public async load(): Promise<void> {
    try {
      const status = await this.loader.run();
      runInAction(() => this.acceptStatus(status));
    } catch {
      runInAction(() => this.acceptServiceUnavailable());
    }
  }

  /**
   * 接收维护状态并检测部署变化，协调应用门禁与刷新提示。
   *
   * Accept maintenance state and detect deployment changes for availability gating and refresh prompts.
   */
  public acceptStatus(status: IngestionStatus): void {
    const wasBlocking = this.status?.active === true || this.serviceUnavailable;
    this.status = status;
    this.serviceUnavailable = false;
    if (!this.polling.running) {
      this.polling.start();
    }
    if (!status.active && wasBlocking) {
      window.location.reload();
    }
  }

  public acceptServiceUnavailable(): void {
    this.serviceUnavailable = true;
    if (!this.polling.running) {
      this.polling.start();
    }
  }

  private readonly onMaintenance = (event: Event): void => {
    const status = (event as CustomEvent<IngestionStatus>).detail;
    if (status) {
      this.acceptStatus(status);
    }
  };

  private readonly onServiceUnavailable = (): void => {
    this.acceptServiceUnavailable();
  };
}

export const maintenanceStore = new MaintenanceStore();
