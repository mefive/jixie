import { observable, makeObservable, runInAction } from 'mobx';

import { BaseModel } from './base-model';

type PollingModelSetupParams = {
  interval?: number;
  request: () => Promise<false | void>;
};

/** Repeatedly calls `request` every `interval` ms; `request` returns `false` to stop (e.g. job done).
 * Copied verbatim from marginalia apps/web/src/lib/models. */
export class PollingModel extends BaseModel<PollingModelSetupParams> {
  private pollingTimer: ReturnType<typeof setTimeout>;

  private interval: number;

  public running = false;

  public constructor() {
    super();
    makeObservable(this, {
      running: observable.ref,
    });
  }

  public cleanup() {
    this.stop();
  }

  public start(interval?: number) {
    clearTimeout(this.pollingTimer);
    if (interval > 0) {
      this.interval = interval;
    } else if (this.setupParams.interval > 0) {
      this.interval = this.setupParams.interval;
    } else {
      return;
    }
    runInAction(() => {
      this.running = true;
    });
    this.pollingTimer = setTimeout(() => {
      this.doRequest();
    }, 100);
  }

  public stop() {
    runInAction(() => {
      this.running = false;
    });
    clearTimeout(this.pollingTimer);
    this.pollingTimer = null;
  }

  private async doRequest() {
    let result: false | void;
    try {
      result = await this.setupParams.request?.();
    } finally {
      if (result !== false) {
        this.pollingTimer = setTimeout(() => {
          this.doRequest();
        }, this.interval);
      } else {
        this.stop();
      }
    }
  }
}
