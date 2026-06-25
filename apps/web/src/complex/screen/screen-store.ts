import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { ScreenResult, ScreenSpec, StockSeries } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import { fetchStockSeries, parseScreen, runScreen } from '@src/api/client';

type ScreenSetupParams = {};

/** Example queries — clickable chips. They run runScreen directly (no LLM), so the screener is
 * usable without a DEEPSEEK_API_KEY; the NL box is the AI path on top. */
export const EXAMPLE_SCREENS: { label: string; spec: ScreenSpec }[] = [
  {
    label: '低PE高股息大盘',
    spec: {
      filters: [
        { field: 'peTtm', op: '<', value: 15 },
        { field: 'dvRatio', op: '>', value: 3 },
      ],
      sort: { field: 'totalMv', dir: 'desc' },
      limit: 50,
    },
  },
  { label: '小市值', spec: { filters: [{ field: 'totalMv', op: '>', value: 0 }], sort: { field: 'totalMv', dir: 'asc' }, limit: 50 } },
  { label: '高换手', spec: { filters: [], sort: { field: 'turnoverRate', dir: 'desc' }, limit: 50 } },
  { label: '破净 (PB<1)', spec: { filters: [{ field: 'pb', op: '<', value: 1 }], sort: { field: 'pb', dir: 'asc' }, limit: 50 } },
];

/**
 * Screener store. The query `spec` is the editable source of truth: NL parse and example chips both
 * set it; editing a condition chip re-runs the *deterministic* query (runScreen, no LLM) — mirrors
 * fangtu's ConditionChips. `result` is the latest table data (set by either path).
 */
export class ScreenStore extends BaseStore<ScreenSetupParams> {
  public nlText = '';
  public spec: ScreenSpec | null = null;
  public result: ScreenResult | null = null;
  public selectedCode: string | null = null;

  public runLoader = new LoaderModel<ScreenResult>(); // direct deterministic query (examples, chip edits)
  public parseLoader = new LoaderModel<{ spec: ScreenSpec; result: ScreenResult }>(); // NL→spec→run
  public seriesLoader = new LoaderModel<StockSeries>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      nlText: observable.ref,
      spec: observable.ref,
      result: observable.ref,
      selectedCode: observable.ref,
      busy: computed,
      setNlText: action,
      selectStock: action,
      closeDetail: action,
    });
  }

  public setup(params: ScreenSetupParams) {
    super.setup(params);
    this.runLoader.setup({ request: () => runScreen(this.spec!) });
    this.parseLoader.setup({ request: () => parseScreen(this.nlText.trim()) });
    this.seriesLoader.setup({ request: () => fetchStockSeries(this.selectedCode!) });
    this.registCleaner(() => this.runLoader.cleanup());
    this.registCleaner(() => this.parseLoader.cleanup());
    this.registCleaner(() => this.seriesLoader.cleanup());
  }

  public get busy(): boolean {
    return this.runLoader.loading || this.parseLoader.loading;
  }

  public setNlText(v: string) {
    runInAction(() => {
      this.nlText = v;
    });
  }

  /** AI path: NL → spec → results (server does both); reflect the spec into the editable chips. */
  public async searchNl() {
    if (!this.nlText.trim()) return;
    const r = await this.parseLoader.run();
    runInAction(() => {
      this.spec = r.spec;
      this.result = r.result;
    });
  }

  /** Example path: load a preset spec, then run it. */
  public runExample(spec: ScreenSpec) {
    this.applySpec(spec);
  }

  /** Set the editable spec and re-run the deterministic query (used by chip edits + examples). */
  public async applySpec(spec: ScreenSpec) {
    runInAction(() => {
      this.spec = spec;
    });
    const r = await this.runLoader.run();
    runInAction(() => {
      this.result = r;
    });
  }

  public selectStock(code: string) {
    runInAction(() => {
      this.selectedCode = code;
    });
    void this.seriesLoader.run();
  }

  public closeDetail() {
    runInAction(() => {
      this.selectedCode = null;
    });
  }
}
