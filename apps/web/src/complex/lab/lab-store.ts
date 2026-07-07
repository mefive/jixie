import { computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type BacktestConfig,
  type BacktestSummary,
  type ChatMessage,
  type LogLine,
  type StrategyCard,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import i18n from '@src/i18n';
import { QueryCardResults } from '@src/components/query-card-model';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import {
  createStrategy,
  deleteStrategy,
  findBacktestRunningJob,
  generateStrategyName,
  getStrategy,
  listStrategies,
  pollBacktest,
  sendAgent,
  submitBacktest,
  updateStrategy,
} from '@src/api/client';
import { DEFAULT_CODE } from './default-strategy';
import { pushRecent, readRecents, removeRecent } from './recents';

type LabSetupParams = { id?: string; isNew?: boolean };

/**
 * Backtest workbench store — code-first. Persistence model (per the agent workflow):
 *  - a strategy row is CREATED up front on the first Agent prompt (LLM-named from the request), so the
 *    conversation has something to attach to;
 *  - `messages` save in real time (every Agent turn, by id);
 *  - `config` (code / range / capital) + `name` persist ONLY on a run — the name is re-derived from the
 *    code each run (the model keeps it when it still fits). So the editor's code/params are a working
 *    state that only commits when you 运行回测; an unrun edit is lost on refresh (by design).
 * `dirty` = the run-relevant config changed since the last run → gates the 运行回测 button + the "result
 * is stale" behavior. The result is replaced only by a run, never cleared by editing code.
 */
export class LabStore extends BaseStore<LabSetupParams> {
  public name = ''; // LLM-derived name; regenerated from the code on each run (the 策略名称, not the code's own)
  public start = '20200101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public code = DEFAULT_CODE;

  public nlText = ''; // the Agent chat draft / hero prompt

  public chatMessages: ChatMessage[] = []; // the Agent conversation for this strategy (persisted per strategy)
  public sending = false; // an Agent turn is in flight
  public cardResults = new QueryCardResults(); // fresh results for the conversation's query cards
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)

  public logLines: LogLine[] = []; // live backtest progress (streamed via polling), tagged system/user
  public result: BacktestSummary | null = null; // a finished run OR the saved last-result on reopen
  public error: string | null = null; // backtest failure message
  public savedId: string | null = null; // this strategy's DB id (for the URL)
  public savedConfig = ''; // run-relevant config at the LAST RUN (or '' if never run) — baseline for `dirty`
  public persistedConfig = ''; // run-relevant config as PERSISTED in the DB (create/run/open) — baseline for `edited`
  public initializing = false; // opening the initial strategy on mount — render a neutral loader, not the hero

  private jobId: string | null = null; // polling cursor for the current backtest
  private since = 0;

  public backtestPoller = new PollingModel();
  public savedLoader = new LoaderModel<StrategyCard[]>(); // 我的策略 / 历史 cards

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      name: observable.ref,
      start: observable.ref,
      end: observable.ref,
      initialCash: observable.ref,
      code: observable.ref,
      nlText: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      logLines: observable.ref,
      result: observable.ref,
      error: observable.ref,
      savedId: observable.ref,
      savedConfig: observable.ref,
      persistedConfig: observable.ref,
      initializing: observable.ref,
      config: computed,
      dirty: computed,
      edited: computed,
      isFresh: computed,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.registCleaner(() => this.backtestPoller.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    this.registCleaner(() => this.turnStream.detach()); // drop the SSE subscription; the turn keeps running
    void this.savedLoader.run(); // prime 我的策略 (also feeds the hero's 最近访问 cards)
    // A fresh (never-run) strategy: empty run-baseline → dirty → 运行回测 enabled; but the pristine
    // skeleton IS the "persisted" state (nothing to lose) → not edited → no leave guard.
    this.savedConfig = '';
    this.persistedConfig = this.configKey();
    // Resolve the initial view: `?new=1` forces the blank hero; else an explicit ?id; else the
    // most-recently-opened strategy (so re-entering /lab lands on your last work, not the blank hero);
    // else the blank starter. When we WILL open one, set `initializing` synchronously so the first paint
    // is a neutral loader — not the hero / empty workbench flashing before openSaved resolves.
    const initialId = params.isNew ? '' : params.id || readRecents()[0];
    if (initialId) {
      this.initializing = true;
      void this.openSaved(initialId).finally(() => runInAction(() => (this.initializing = false)));
    }
  }

  /** True while a backtest is running (drives the loading state + progress log). */
  public get running(): boolean {
    return this.backtestPoller.running;
  }

  /** Untouched starter strategy (no saved id, default code, no run, no chat) → show the prompt-first hero. */
  public get isFresh(): boolean {
    return (
      !this.savedId && !this.result && this.code === DEFAULT_CODE && this.chatMessages.length === 0
    );
  }

  /** The run-relevant config (range/capital/code — NOT name) changed since the last run. Gates 运行回测:
   * a never-run strategy has an empty baseline → dirty → runnable; a fresh run resets the baseline. */
  public get dirty(): boolean {
    return this.configKey() !== this.savedConfig;
  }

  /** The code/params differ from what's PERSISTED in the DB — i.e. there are unrun edits that leaving
   * would lose. Gates the leave guard (新建 / 切策略 / 刷新). A just-opened strategy is NOT edited (even
   * if never run → dirty), so opening one doesn't false-warn. */
  public get edited(): boolean {
    return this.configKey() !== this.persistedConfig;
  }

  /** Range/capital + the strategy code → a runnable BacktestConfig. */
  public get config(): BacktestConfig {
    return {
      name: this.name.trim() || '未命名策略',
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      code: this.code,
    };
  }

  public setField<K extends keyof LabStore>(key: K, value: LabStore[K]) {
    runInAction(() => {
      (this as LabStore)[key] = value;
    });
  }

  /** One Agent turn — streamed. Append the user message locally, ensure the strategy exists (the
   * first prompt creates it, LLM-named from that request), START the turn (server persists both the
   * user message and the reply onto the strategy row), then subscribe to its SSE stream; the reply
   * lands via turnHandlers. Code is NOT persisted here (only a run commits config). */
  public async sendAgent(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.nlText = '';
    });
    // First prompt → create the strategy so the conversation has a home (named from this request).
    await this.ensureStrategy(text);
    if (!this.savedId) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage('assistant', i18n.t('lab:storeChatStartFailed')),
        ];
        this.sending = false;
      });
      return;
    }
    try {
      const { turnId } = await sendAgent(this.savedId, text, this.code);
      await this.turnStream.attach(turnId, this.turnHandlers()); // resolves after the terminal event
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('lab:storeError', {
              message: e instanceof Error ? e.message : i18n.t('lab:storeRequestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => {
        this.sending = false;
      });
    }
  }

  /** Terminal-event handlers shared by sendAgent and the refresh reattach. */
  private turnHandlers(): AgentTurnHandlers {
    return {
      onDone: (done) => {
        runInAction(() => {
          // toolTrace rides along for display only (the server persisted the message without it).
          this.chatMessages = [
            ...this.chatMessages,
            { role: 'assistant', parts: done.parts, toolTrace: done.toolTrace } as ChatMessage,
          ];
          if (done.changed) {
            this.code = done.code; // dirty → runnable; the shown result stays until the next run
          }
        });
      },
      onError: (message) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('lab:storeError', { message })),
          ];
        });
      },
      onCancelled: () => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('lab:storeTurnStopped')),
          ];
        });
      },
    };
  }

  /** Refresh reattach: if this strategy has a live turn, subscribe (snapshot replays what we missed). */
  private async reattachTurn() {
    if (!this.savedId) {
      return;
    }
    runInAction(() => (this.sending = true));
    await this.turnStream.attachRunning(`strategy:${this.savedId}`, this.turnHandlers());
    runInAction(() => (this.sending = false)); // resolved at the terminal event (or no live turn)
  }

  /** Create the strategy row if it doesn't exist yet (first Agent prompt, or a first run of a
   * hand-written strategy). Names it via the LLM — from the prompt when given, else from the code. The
   * baseline is left empty so a never-run strategy is dirty (→ runnable). Best-effort. */
  private async ensureStrategy(namePrompt?: string) {
    if (this.savedId) {
      return;
    }
    let name = '未命名策略';
    try {
      const suggested = await generateStrategyName(
        namePrompt ? { prompt: namePrompt } : { code: this.code },
      );
      name = suggested.name;
    } catch {
      /* naming is best-effort */
    }
    runInAction(() => (this.name = name));
    try {
      // No messages in the create payload — the turn runner appends the user message server-side.
      const meta = await createStrategy(this.config);
      runInAction(() => {
        this.savedId = meta.id;
        this.name = meta.name; // server de-dupes the name
        this.persistedConfig = this.configKey(); // we just persisted this config (nothing to lose yet)
      });
      pushRecent(meta.id);
      void this.savedLoader.run();
    } catch {
      /* best-effort — a later run retries via ensureStrategy */
    }
  }

  /** Start fresh: a blank skeleton strategy. Empty baseline → dirty → 运行回测 enabled. */
  public newStrategy() {
    runInAction(() => {
      this.name = '';
      this.code = DEFAULT_CODE;
      this.nlText = '';
      this.chatMessages = [];
      this.result = null;
      this.error = null;
      this.logLines = [];
      this.savedId = null;
      this.savedConfig = ''; // never run → dirty (runnable)
      this.persistedConfig = this.configKey(); // pristine skeleton → not edited (no leave guard)
    });
  }

  /** Run a backtest. This is the commit point: it persists the current config (code/range/capital) onto
   * the strategy, replaces the shown result with the new run, and re-derives the name from the code. */
  public async run() {
    await this.ensureStrategy(); // create the row if this is a hand-written strategy that never talked to the agent
    if (!this.savedId) {
      runInAction(() => (this.error = i18n.t('lab:storeSaveFailedNoBacktest')));
      return;
    }
    // Commit the config (code/range/capital) by id — the new "last run" baseline. Renames don't ride
    // here; the name is refreshed in the background (below) so the backtest starts without waiting on it.
    try {
      await updateStrategy(this.savedId, { config: this.config });
      this.markSaved();
      void this.savedLoader.run();
    } catch (e) {
      runInAction(
        () => (this.error = e instanceof Error ? e.message : i18n.t('lab:storeSaveFailed')),
      );
      return;
    }
    // Backend confirmed the new config → clear the now-stale result + logs; the run fills them back in.
    runInAction(() => {
      this.result = null;
      this.logLines = [];
      this.error = null;
    });
    let jobId: string;
    try {
      ({ jobId } = await submitBacktest(this.config, this.savedId));
    } catch (e) {
      runInAction(
        () => (this.error = e instanceof Error ? e.message : i18n.t('lab:storeSubmitFailed')),
      );
      return;
    }
    this.startPolling(jobId);
    void this.refreshName(); // re-derive the name from the code (keeps it when it still fits), in the background
  }

  /** Re-derive the strategy name from its code (the model keeps the current name when it still fits),
   * then persist just the name by id. Runs in the background after a run so it never blocks the backtest;
   * a name-only change doesn't touch the (run-relevant) config, so it won't invalidate the fresh result. */
  private async refreshName() {
    if (!this.savedId) {
      return;
    }
    try {
      const { name } = await generateStrategyName({ code: this.code, currentName: this.name });
      if (name && name !== this.name) {
        runInAction(() => (this.name = name));
        await updateStrategy(this.savedId, { config: this.config });
        void this.savedLoader.run();
      }
    } catch {
      /* best-effort */
    }
  }

  /** Re-attach to a still-running backtest (jobId from localStorage) without resubmitting. */
  public resume(jobId: string) {
    runInAction(() => {
      this.logLines = [];
      this.result = null;
      this.error = null;
    });
    this.startPolling(jobId);
  }

  /** Append log lines streamed from the backtest worker. */
  public appendLogs(lines: LogLine[]) {
    runInAction(() => {
      this.logLines = [...this.logLines, ...lines];
    });
  }

  /** Reflect a full saved BacktestConfig back into the editor (name + range/capital + code). The caller
   * (openSaved) sets the `dirty` baseline, since it depends on whether a run result exists. */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
      this.code = config.code;
    });
  }

  /** Serialize the RUN-relevant config for `dirty` (excludes name — a rename doesn't invalidate a run). */
  private configKey(): string {
    return JSON.stringify({
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      code: this.code,
    });
  }

  /** A run committed the current config: it's both the new run baseline (dirty) and persisted (edited). */
  private markSaved() {
    runInAction(() => {
      this.savedConfig = this.persistedConfig = this.configKey();
    });
  }

  /** Reopen a saved strategy: load its config + last result, and re-attach to a running backtest if one
   * is still in flight for it (so a refresh continues streaming logs instead of losing the run). */
  public async openSaved(id: string) {
    let s;
    try {
      s = await getStrategy(id);
    } catch {
      return; // strategy gone (deleted)
    }
    this.applyConfig(s.config);
    runInAction(() => {
      this.result = s.lastResult ?? null;
      this.chatMessages = (s.messages ?? []).map(normalizeChatMessage); // restore (upgrades legacy rows)
      this.error = null;
      this.savedId = id;
      // A strategy with a result → its config IS the last-run config (not dirty); one never run stays
      // dirty (empty run-baseline) so 运行回测 is enabled. Either way the loaded config IS what's in the
      // DB → not edited (opening it doesn't false-warn the leave guard).
      this.savedConfig = s.lastResult ? this.configKey() : '';
      this.persistedConfig = this.configKey();
    });
    pushRecent(id); // record the visit → hero 最近访问 + auto-open on next entry
    void this.reattachTurn(); // a live agent turn for this strategy? re-subscribe (snapshot replays)
    // Re-attach to a still-running backtest (found server-side by strategyId — no localStorage, works
    // cross-client) so a refresh keeps streaming logs instead of losing the run.
    try {
      const { jobId } = await findBacktestRunningJob(id);
      if (jobId) {
        this.resume(jobId);
      }
    } catch {
      /* none running / expired — the saved lastResult stays shown */
    }
  }

  /** Delete a saved strategy, then refresh the list. */
  public removeSaved(id: string) {
    removeRecent(id);
    void deleteStrategy(id).then(() => this.savedLoader.run());
  }

  public loadSavedList() {
    void this.savedLoader.run();
  }

  private startPolling(jobId: string) {
    this.jobId = jobId;
    this.since = 0;
    this.backtestPoller.start();
  }

  /** One poll tick — append new logs; return false to stop the poller (done / error / expired). */
  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollBacktest(this.jobId!, this.since);
      if (job.logs.length) {
        this.appendLogs(job.logs);
        this.since = job.nextSince;
      }
      if (job.status === 'done') {
        // Result lives on the strategy now (worker wrote lastResult) — fetch it.
        let result: BacktestSummary | null = null;
        if (this.savedId) {
          try {
            const s = await getStrategy(this.savedId);
            result = (s.lastResult as BacktestSummary) ?? null;
          } catch {
            /* strategy fetch failed — leave the last shown result */
          }
        }
        runInAction(() => {
          this.result = result;
        });
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        runInAction(() => {
          this.error =
            job.status === 'stale'
              ? i18n.t('lab:storeBacktestInterrupted')
              : job.error || i18n.t('lab:storeBacktestFailed');
        });
        return false;
      }
    } catch {
      // job gone (server restart / expired) / network — stop; the saved last result (if any) stays shown.
      return false;
    }
  }
}

// —— helpers ——

const POLL_INTERVAL_MS = 1500;
