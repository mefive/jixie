import { BaseStore } from '@src/lib';

type DashboardSetupParams = {};

// Empty shell store for the post-login home page. Factor / backtest data will be added later via LoaderModel.
export class DashboardStore extends BaseStore<DashboardSetupParams> {
  public constructor(parentStore?: any) {
    super(parentStore);
  }

  public setup(params: DashboardSetupParams) {
    super.setup(params);
  }
}
