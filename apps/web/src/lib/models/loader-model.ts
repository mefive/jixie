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
    // cleanup 代表 model 寿终正寝，挂起请求一定不再需要——主动 abort，让 request 闭包里
    // 接住 signal 的 fetch 真正取消（dev StrictMode 双 mount、用户切路由打断旧请求都靠它）。
    // reset() 不调 abort，保留"业务层面状态复位但请求继续"的可能性。
    this.abort();
    this.reset();
  }

  // 外注AbortController导致不少问题，暂时禁用，等实在有必要再重新设计
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
          // TODO 待研究：如果已过期的request返回，则不resolve也不reject，这种做法是否会引起内存泄漏？
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
