import { runInAction } from 'mobx';
import { BaseModel, LoaderModel } from '@src/lib/models';

export class BaseStore<
  SetupParams = any,
  ParentStore extends BaseStore = any,
> extends BaseModel<SetupParams> {
  public parentStore: ParentStore;

  private childStores: BaseStore[];

  public prepareLoader = new LoaderModel();

  public constructor(parentStore?: ParentStore) {
    super();
    this.parentStore = parentStore;
    this.parentStore?.addChildStore(this);
    this.childStores = [];
    this.prepareLoader.setup();
    this.prepareLoader.run(this.prepare());
  }

  protected async prepare() {
    // Does nothing by default
  }

  public cleanup() {
    runInAction(() => {
      super.cleanup();
      this.childStores.forEach((childStore) => {
        childStore.cleanup();
      });
    });
  }

  public get rootStore(): BaseStore<SetupParams, ParentStore> {
    if (!this.parentStore) {
      return this;
    }
    return this.parentStore.rootStore;
  }

  protected addChildStore(childStore: BaseStore) {
    this.childStores.push(childStore);
  }
}
