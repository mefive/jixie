import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import type { ScreenQueryResponse, ScreenResult, ScreenSpec, SavedMeta } from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import {
  deleteScreen,
  getScreen,
  listScreens,
  queryScreen,
  runScreen,
  saveScreen,
} from '@src/api/client';

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
  public nlText = ''; // current draft (hero input / edit modal)
  public submittedPrompt = ''; // the NL text behind the current result — shown as a read-only bubble; '' if from example/saved
  public spec: ScreenSpec | null = null; // present → screen (chips shown); null → direct lookup / nothing yet
  public result: ScreenResult | null = null;

  public runLoader = new LoaderModel<ScreenResult>(); // direct deterministic query (examples, chip edits)
  public queryLoader = new LoaderModel<ScreenQueryResponse>(); // one box → screen | lookup (local resolve, then LLM)
  public savedLoader = new LoaderModel<SavedMeta[]>(); // 我的选股 list (saved on demand)

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      nlText: observable.ref,
      submittedPrompt: observable.ref,
      spec: observable.ref,
      result: observable.ref,
      busy: computed,
      setNlText: action,
    });
  }

  public setup(params: ScreenSetupParams) {
    super.setup(params);
    this.runLoader.setup({ request: () => runScreen(this.spec!) });
    this.queryLoader.setup({ request: () => queryScreen(this.nlText.trim()) });
    this.savedLoader.setup({ request: () => listScreens() });
    this.registCleaner(() => this.runLoader.cleanup());
    this.registCleaner(() => this.queryLoader.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    void this.savedLoader.run(); // prime the 我的选股 dropdown
  }

  public get busy(): boolean {
    return this.runLoader.loading || this.queryLoader.loading;
  }

  public setNlText(v: string) {
    runInAction(() => {
      this.nlText = v;
    });
  }

  /** The box: server resolves NL→screen or name/code→lookup. Screen sets the editable chips; lookup has
   * no spec (just the matched stocks). Either way the submitted text becomes the read-only prompt bubble. */
  public async searchNl() {
    const text = this.nlText.trim();
    if (!text) return;
    const r = await this.queryLoader.run();
    runInAction(() => {
      this.submittedPrompt = text;
      this.spec = r.kind === 'screen' ? r.spec : null;
      this.result = r.result;
    });
  }

  /** Example path: load a preset spec, then run it (clears the NL bubble — this didn't come from a prompt).
   * Returns applySpec's promise so a LoaderButton can track just this click's in-flight state. */
  public runExample(spec: ScreenSpec) {
    runInAction(() => {
      this.submittedPrompt = '';
    });
    return this.applySpec(spec);
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

  // —— Saved screens (手动存) ——

  /** Save the current query under a name (upsert by name), then refresh the list. */
  public saveCurrent(name: string) {
    if (!this.spec) return;
    void saveScreen(name, this.spec).then(() => this.savedLoader.run());
  }

  /** Reopen a saved screen: fetch its spec, then apply it (sets the chips + runs the query). */
  public async openSaved(id: string) {
    const s = await getScreen(id);
    runInAction(() => {
      this.submittedPrompt = '';
    });
    await this.applySpec(s.spec);
  }

  /** Delete a saved screen, then refresh the list. */
  public removeSaved(id: string) {
    void deleteScreen(id).then(() => this.savedLoader.run());
  }

  public loadSavedList() {
    void this.savedLoader.run();
  }
}
