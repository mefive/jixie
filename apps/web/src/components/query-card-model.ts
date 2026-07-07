import { observable, runInAction } from 'mobx';
import type { ScreenResult, ScreenSpec } from '@jixie/shared';
import { runScreen } from '@src/api/client';

export interface QueryCardState {
  loading: boolean;
  error: string | null;
  result: ScreenResult | null;
}

/**
 * Result cache for the query cards in an agent conversation. A card persists only its spec; this
 * model re-runs specs on demand (keyed by the spec JSON) so reopening a conversation shows fresh
 * data and duplicate cards share one request. Owned by the page store (one per conversation surface).
 */
export class QueryCardResults {
  private states = observable.map<string, QueryCardState>();

  public get(spec: ScreenSpec): QueryCardState | undefined {
    return this.states.get(JSON.stringify(spec));
  }

  /** Kick off the query for a card once; later calls for the same spec are no-ops. */
  public load(spec: ScreenSpec): void {
    const key = JSON.stringify(spec);
    if (this.states.has(key)) {
      return;
    }
    this.states.set(key, { loading: true, error: null, result: null });
    runScreen(spec)
      .then((result) => {
        runInAction(() => this.states.set(key, { loading: false, error: null, result }));
      })
      .catch((e) => {
        // A rejected spec (e.g. persisted before a schema change) degrades to an inline error — never crashes.
        const message = e instanceof Error ? e.message : '查询失败';
        runInAction(() => this.states.set(key, { loading: false, error: message, result: null }));
      });
  }
}
