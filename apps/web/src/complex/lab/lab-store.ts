import { computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  BacktestConfig,
  BacktestSummary,
  ChatMessage,
  LogLine,
  StrategyCard,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  deleteStrategy,
  findBacktestRunningJob,
  generateName,
  getStrategy,
  listStrategies,
  pollBacktest,
  saveStrategy,
  sendAgent,
  submitBacktest,
} from '@src/api/client';
import { DEFAULT_CODE } from './default-strategy';
import { pushRecent, readRecents, removeRecent } from './recents';

type LabSetupParams = { id?: string; isNew?: boolean };

/**
 * Backtest workbench store — code-first. The strategy is a single TS source string (`code`); the server
 * compiles and runs it. `/?id=<sid>` loads a saved strategy + its last result on mount (refresh-safe), and
 * re-attaches to a running backtest via the localStorage job pointer + PollingModel.
 */
export class LabStore extends BaseStore<LabSetupParams> {
  public name = ''; // blank → auto-named from the code on first run (the 策略名称 field, not the code's own name)
  public start = '20200101';
  public end = '20241231';
  public initialCash = 1_000_000;
  public code = DEFAULT_CODE;

  public nlText = ''; // the Agent chat draft / hero prompt

  public chatMessages: ChatMessage[] = []; // the Agent conversation for this strategy (persisted per strategy)
  public sending = false; // an Agent turn is in flight

  public logLines: LogLine[] = []; // live backtest progress (streamed via polling), tagged system/user
  public result: BacktestSummary | null = null; // a finished run OR the saved last-result on reopen
  public error: string | null = null; // backtest failure message
  public savedId: string | null = null; // this strategy's DB id (for the URL)
  public savedConfig = ''; // serialized config as last saved/loaded — the baseline `dirty` compares against

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
      config: computed,
      dirty: computed,
      isFresh: computed,
    });
  }

  public setup(params: LabSetupParams) {
    super.setup(params);
    this.backtestPoller.setup({ interval: POLL_INTERVAL_MS, request: () => this.pollOnce() });
    this.savedLoader.setup({ request: () => listStrategies() });
    this.registCleaner(() => this.backtestPoller.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    void this.savedLoader.run(); // prime 我的策略 (also feeds the hero's 最近访问 cards)
    // A fresh default strategy is the baseline (not "dirty") until we load something over it.
    this.markSaved();
    // Resolve the initial view: `?new=1` forces the blank hero; else an explicit ?id; else the
    // most-recently-opened strategy (so re-entering /lab lands on your last work, not the blank hero);
    // else the blank starter.
    if (!params.isNew) {
      const initialId = params.id || readRecents()[0];
      if (initialId) {
        void this.openSaved(initialId);
      }
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

  /** The editor has unsaved edits vs. the last saved/loaded snapshot (gates the 新建 save prompt). */
  public get dirty(): boolean {
    return this.configKey() !== this.savedConfig;
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

  /** One Agent turn: append the user message, ask the server (history + current code), append the reply,
   * and apply the returned code when it changed. Persists the conversation onto the strategy (if saved). */
  public async sendAgent(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, { role: 'user', content: text }];
      this.sending = true;
      this.nlText = '';
    });
    try {
      const history = this.chatMessages.slice(0, -1); // prior turns (exclude the message we just added)
      const res = await sendAgent(history, text, this.code);
      runInAction(() => {
        this.chatMessages = [...this.chatMessages, { role: 'assistant', content: res.reply }];
        // A code change invalidates the shown result — the strategy is different now.
        if (res.changed) {
          this.code = res.code;
          this.result = null;
        }
      });
      void this.persistMessages();
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          { role: 'assistant', content: `出错了:${e instanceof Error ? e.message : '请求失败'}` },
        ];
      });
    } finally {
      runInAction(() => {
        this.sending = false;
      });
    }
  }

  /** Persist the conversation onto the saved strategy. A fresh (unsaved) strategy keeps its chat in
   * memory — it's flushed on the first run/save, which carries the messages along. */
  private async persistMessages() {
    if (!this.savedId) {
      return;
    }
    try {
      await saveStrategy(this.config, this.chatMessages);
    } catch {
      /* best-effort */
    }
  }

  /** Start fresh: a blank-named strategy on the default template (blank name → auto-named on first run). */
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
    });
    this.markSaved(); // the blank default is the new baseline (not dirty)
  }

  /** Persist the current config without running (used by the 新建 "保存并新建" prompt). The server drops the
   * old last-result because the code changed, so the saved strategy reopens clean until its next run. */
  public async save() {
    if (!this.name.trim()) {
      try {
        const { name } = await generateName(this.code);
        runInAction(() => (this.name = name));
      } catch {
        runInAction(() => (this.name = '未命名策略'));
      }
    }
    try {
      const meta = await saveStrategy(this.config, this.chatMessages);
      runInAction(() => {
        this.savedId = meta.id;
        this.result = null; // this saved version has no run yet — don't carry a stale curve
      });
      pushRecent(meta.id);
      this.markSaved();
      void this.savedLoader.run();
    } catch {
      /* best-effort */
    }
  }

  public async run() {
    // Auto-name from the code when 策略名称 is blank (the user can edit it after).
    if (!this.name.trim()) {
      try {
        const { name } = await generateName(this.code);
        runInAction(() => {
          this.name = name;
        });
      } catch {
        runInAction(() => {
          this.name = '未命名策略';
        });
      }
    }
    runInAction(() => {
      this.logLines = [];
      this.result = null;
      this.error = null;
    });
    // Save first so the strategy has an id — the backtest Job is keyed by it (URL + DB-backed resume),
    // and the worker writes the result to that strategy's lastResult on completion.
    try {
      const meta = await saveStrategy(this.config, this.chatMessages);
      runInAction(() => {
        this.savedId = meta.id;
      });
      pushRecent(meta.id);
      this.markSaved(); // running persists the current config — it's now the saved baseline
      void this.savedLoader.run();
    } catch {
      /* best-effort */
    }
    if (!this.savedId) {
      runInAction(() => {
        this.error = '策略保存失败,无法回测';
      });
      return;
    }
    let jobId: string;
    try {
      ({ jobId } = await submitBacktest(this.config, this.savedId));
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : '回测提交失败';
      });
      return;
    }
    this.startPolling(jobId);
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

  /** Reflect a full saved BacktestConfig back into the editor (range/capital + code) — the loaded
   * snapshot becomes the `dirty` baseline. */
  public applyConfig(config: BacktestConfig) {
    runInAction(() => {
      this.name = config.name;
      this.start = config.start;
      this.end = config.end;
      this.initialCash = config.initialCash;
      this.code = config.code;
    });
    this.markSaved();
  }

  /** Serialize the editable config (raw fields) for the `dirty` comparison + saved baseline. */
  private configKey(): string {
    return JSON.stringify({
      name: this.name,
      start: this.start,
      end: this.end,
      initialCash: this.initialCash,
      code: this.code,
    });
  }

  /** Snapshot the current config as the saved baseline → `dirty` is false until the next edit. */
  private markSaved() {
    runInAction(() => {
      this.savedConfig = this.configKey();
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
      this.chatMessages = s.messages ?? []; // restore this strategy's Agent conversation
      this.error = null;
      this.savedId = id;
    });
    pushRecent(id); // record the visit → hero 最近访问 + auto-open on next entry
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
            job.status === 'stale' ? '回测中断(服务重启),请重试' : job.error || '回测失败';
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
