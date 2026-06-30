import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { FactorReport } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { getFactorAnalysis } from '@src/api/client';

type FactorSetupParams = {};

/**
 * 因子研究 store. Loads every pre-computed factor's analysis report once on setup (the API memoizes
 * the heavy cross-sectional compute). `selectedKey` drives the detail panel; the default selection
 * (highest |IC|) is resolved lazily in the `selected` getter so no post-load wiring is needed.
 */
export class FactorStore extends BaseStore<FactorSetupParams> {
  public reportLoader = new LoaderModel<FactorReport[]>();
  public selectedKey = ''; // '' → fall back to the most predictive factor (see `selected`)

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      selectedKey: observable.ref,
      reports: computed,
      selected: computed,
      select: action,
    });
  }

  public setup(params: FactorSetupParams) {
    super.setup(params);
    this.reportLoader.setup({ request: () => getFactorAnalysis() });
    this.registCleaner(() => this.reportLoader.cleanup());
    void this.reportLoader.run();
  }

  /** Reports ordered by predictive strength (|IC mean| desc) — used for the default selection and as
   * the table's initial order before the user clicks a column sorter. */
  public get reports(): FactorReport[] {
    return [...(this.reportLoader.result ?? [])].sort(
      (a, b) => Math.abs(b.icMean) - Math.abs(a.icMean),
    );
  }

  /** The factor whose detail is shown: the explicit selection, else the most predictive one. */
  public get selected(): FactorReport | null {
    const rs = this.reports;
    return rs.find((r) => r.factor === this.selectedKey) ?? rs[0] ?? null;
  }

  public select(key: string) {
    runInAction(() => {
      this.selectedKey = key;
    });
  }
}
