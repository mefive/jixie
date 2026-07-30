import { BaseStore } from '@src/lib';

type HelpSetupParams = {
  slug?: string;
};

export class HelpStore extends BaseStore<HelpSetupParams> {
  public get slug() {
    return this.setupParams?.slug ?? '';
  }
}
