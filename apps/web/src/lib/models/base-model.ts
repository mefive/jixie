import { observable, makeObservable, runInAction } from 'mobx';
import { dataUtils } from '@src/lib/utils';

type Cleaner = () => void;

export class BaseModel<SetupParams = any> {
  public uuid!: string;

  public ready = false;

  public setupParams: SetupParams | null = null;

  public setupKey: string | null = null;

  private cleaners = new Set<Cleaner>();

  public constructor() {
    this.uuid = dataUtils.uuid();
    makeObservable(this, {
      ready: observable.ref,
      setupParams: observable.ref,
      setupKey: observable.ref,
    });
  }

  public setup(setupParams?: SetupParams) {
    runInAction(() => {
      this.cleanup();
      this.setupParams =
        setupParams !== undefined ? ({ ...setupParams } as SetupParams) : ({} as SetupParams);
      this.setupKey = dataUtils.uuid();
      this.ready = true;
    });
  }

  public cleanup() {
    runInAction(() => {
      this.cleaners.forEach((cleaner) => {
        try {
          cleaner();
        } catch (er) {
          console.error(er);
        }
      });
      this.cleaners.clear();
      this.setupParams = null;
      this.setupKey = null;
      this.ready = false;
    });
  }

  protected registCleaner(cleaner: Cleaner) {
    this.cleaners.add(cleaner);
  }
}
