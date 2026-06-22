import { observable, makeObservable, runInAction } from 'mobx';

import { generateKey } from './public';
import { BaseModel } from './base-model';

type ModalModelSetupParams = {
  onClose?: () => void;
};

export class ModalModel<T = any> extends BaseModel<ModalModelSetupParams> {
  public openKey: number = null;

  public opened = false;

  public params = {} as T;

  public contextData: Record<string, any> = null;

  constructor() {
    super();
    makeObservable(this, {
      opened: observable.ref,
      params: observable.ref,
    });
  }

  public open(params?: T) {
    runInAction(() => {
      this.openKey = generateKey('ModalModel/open');
      this.opened = true;
      this.params = { ...params };
    });
  }

  public close() {
    runInAction(() => {
      this.opened = false;
      this.params = {} as T;
    });
    this.setupParams?.onClose?.();
  }
}
