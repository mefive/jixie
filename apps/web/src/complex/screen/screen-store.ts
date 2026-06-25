import { action, makeObservable, observable, runInAction } from 'mobx';
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

export class ScreenStore extends BaseStore<ScreenSetupParams> {
  public nlText = '';
  public selectedCode: string | null = null;

  // Both the NL path and the example path resolve to {spec, result}; the table reads it.
  public searchLoader = new LoaderModel<{ spec: ScreenSpec; result: ScreenResult }>();
  public seriesLoader = new LoaderModel<StockSeries>();

  private pending: () => Promise<{ spec: ScreenSpec; result: ScreenResult }> = async () => {
    throw new Error('no query');
  };

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      nlText: observable.ref,
      selectedCode: observable.ref,
      setNlText: action,
      selectStock: action,
      closeDetail: action,
    });
  }

  public setup(params: ScreenSetupParams) {
    super.setup(params);
    this.searchLoader.setup({ request: () => this.pending() });
    this.seriesLoader.setup({ request: () => fetchStockSeries(this.selectedCode!) });
    this.registCleaner(() => this.searchLoader.cleanup());
    this.registCleaner(() => this.seriesLoader.cleanup());
  }

  public setNlText(v: string) {
    runInAction(() => {
      this.nlText = v;
    });
  }

  /** AI path: NL → query spec → results (server does both). */
  public searchNl() {
    if (!this.nlText.trim()) return;
    this.pending = () => parseScreen(this.nlText.trim());
    void this.searchLoader.run();
  }

  /** Example path: run a preset spec directly (no LLM). */
  public runExample(spec: ScreenSpec) {
    this.pending = async () => ({ spec, result: await runScreen(spec) });
    void this.searchLoader.run();
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
