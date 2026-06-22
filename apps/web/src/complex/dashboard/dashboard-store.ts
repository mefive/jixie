import { BaseStore } from '@src/lib';

type DashboardSetupParams = {};

// 登录后首页的空壳 store。后续因子 / 回测数据用 LoaderModel 加进来。
export class DashboardStore extends BaseStore<DashboardSetupParams> {
  public constructor(parentStore?: any) {
    super(parentStore);
  }

  public setup(params: DashboardSetupParams) {
    super.setup(params);
  }
}
