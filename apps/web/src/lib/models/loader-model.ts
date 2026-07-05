import { observable, computed, makeObservable, runInAction } from 'mobx';

import { generateKey } from './public';
import { BaseModel } from './base-model';

const STATUS = {
  INITIAL: 0,
  LOADING: 1,
  LOADED: 2,
  ERROR: -1,
} as const;

type LoaderModelSetupParams<Result> = {
  request: (data: any, signal: AbortSignal) => Promise<Result>;
  preserveResult?: boolean;
  clearResultOnError?: boolean;
  // abortController?: AbortController,
  onAbort?: () => void;
};

export type LoaderModelStatus = (typeof STATUS)[keyof typeof STATUS];

export class LoaderModel<Result = any> extends BaseModel<LoaderModelSetupParams<Result>> {
  public static STATUS = STATUS;

  public status: LoaderModelStatus = null;

  public errorObject: Error = null;

  public resultKey: number = null;

  public result: Result = null;

  private reqSymbol: object | null = null;

  private abortController: AbortController = null;

  private abortHandler = () => {
    this.setupParams?.onAbort?.();
  };

  public constructor() {
    super();
    makeObservable(this, {
      status: observable.ref,
      errorObject: observable.ref,
      resultKey: observable.ref,
      result: observable.ref,
      initial: computed,
      loading: computed,
      loaded: computed,
      error: computed,
      abortSignal: computed,
    });
  }

  public cleanup() {
    super.cleanup();
    // cleanup means the model has reached end of life, so any pending request is definitely no longer
    // needed—actively abort it so the fetch that caught the signal in the request closure is truly
    // cancelled (relied on by dev StrictMode double-mount and by the user switching routes to interrupt
    // an old request). reset() does not call abort, preserving the option of "reset business-level state
    // but let the request continue".
    this.abort();
    this.reset();
  }

  // Injecting an external AbortController caused quite a few problems; disabled for now, redesign when truly necessary
  public async run(promise?: Promise<Result>): Promise<Result>;
  public async run(data?: any): Promise<Result>;
  public async run(promiseOrData?: Promise<Result> | any): Promise<Result> {
    const reqSymbol = {};
    runInAction(() => {
      this.status = STATUS.LOADING;
      this.errorObject = null;
      this.reqSymbol = reqSymbol;
      // this.abort();
      this.abortController = new AbortController();
      this.abortController.signal.addEventListener('abort', this.abortHandler);
    });
    let promise: Promise<Result>;
    if (promiseOrData instanceof Promise) {
      promise = promiseOrData;
    } else if (typeof this.setupParams?.request === 'function') {
      const data = promiseOrData;
      promise = this.setupParams.request(data, this.abortController.signal);
    } else {
      promise = Promise.reject(new Error('未找到Promise'));
    }
    return new Promise((resolve, reject) => {
      promise
        .then((result) => {
          if (reqSymbol === this.reqSymbol) {
            runInAction(() => {
              this.status = STATUS.LOADED;
              this.errorObject = null;
              if (this.setupParams?.preserveResult !== false) {
                this.resultKey = generateKey('LoaderModel/result');
                this.result = result;
              }
              this.abortController.signal.removeEventListener('abort', this.abortHandler);
              this.abortController = null;
            });
            resolve(result);
          }
          // TODO investigate: if a stale request returns and we neither resolve nor reject, could this cause a memory leak?
        })
        .catch((er) => {
          if (reqSymbol === this.reqSymbol) {
            runInAction(() => {
              this.status = STATUS.ERROR;
              this.errorObject = er;
              if (
                this.setupParams?.preserveResult !== false &&
                this.setupParams?.clearResultOnError
              ) {
                this.resultKey = generateKey('LoaderModel/result');
                this.result = null;
              }
              this.abortController.signal.removeEventListener('abort', this.abortHandler);
              this.abortController = null;
            });
            reject(er);
          }
        });
    });
  }

  // Synchronously mark the loader as loaded without running a request. For callers that know
  // there is no work to do (e.g. BaseStore with the default no-op prepare()): even an already
  // resolved promise flips `loaded` one microtask later, which is observable as a painted blank
  // frame behind complex.render's null gate.
  public markLoaded() {
    runInAction(() => {
      this.status = STATUS.LOADED;
      this.errorObject = null;
    });
  }

  public get initial() {
    return this.status === STATUS.INITIAL;
  }

  public get loading() {
    return this.status === STATUS.LOADING;
  }

  public get loaded() {
    return this.status === STATUS.LOADED;
  }

  public get error() {
    return this.status === STATUS.ERROR;
  }

  public get abortSignal() {
    return this.abortController?.signal;
  }

  public reset() {
    const reqSymbol = {};
    runInAction(() => {
      // this.abort();
      this.reqSymbol = reqSymbol;
      this.status = STATUS.INITIAL;
      this.errorObject = null;
      if (this.abortController?.signal) {
        this.abortController.signal.removeEventListener('abort', this.abortHandler);
      }
      this.abortController = null;
      if (this.setupParams?.preserveResult !== false) {
        this.resultKey = generateKey('LoaderModel/result');
        this.result = null;
      }
    });
  }

  public abort() {
    this.abortController?.abort();
  }
}
