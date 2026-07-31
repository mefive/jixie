import { computed, makeObservable, observable, runInAction } from 'mobx';
import type {
  ActualExecutionUpdate,
  LogLine,
  SignalRun,
  SignalTodayEntry,
  StrategyExecutionOverview,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  getStrategyExecutionOverview,
  listSignalRuns,
  listTodaySignals,
  pollSignalJob,
  submitSignalRun,
  updateSignalExecution,
} from '@src/api/client';
import i18n from '@src/i18n';

export class SignalsStore extends BaseStore {
  public selectedDeploymentId = '';
  public selectedRunId = '';
  public runningDeploymentId = '';
  public savingExecutionId = '';
  public logLines: LogLine[] = [];
  public error: string | null = null;

  public todayLoader = new LoaderModel<SignalTodayEntry[]>();
  public historyLoader = new LoaderModel<SignalRun[]>();
  public overviewLoader = new LoaderModel<StrategyExecutionOverview>();
  public poller = new PollingModel();

  private jobId = '';
  private since = 0;

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      selectedDeploymentId: observable.ref,
      selectedRunId: observable.ref,
      runningDeploymentId: observable.ref,
      savingExecutionId: observable.ref,
      logLines: observable.ref,
      error: observable.ref,
      entries: computed,
      selected: computed,
      selectedRun: computed,
    });
  }

  public setup() {
    super.setup();
    this.todayLoader.setup({ request: () => listTodaySignals() });
    this.historyLoader.setup({
      request: (deploymentId: string) => listSignalRuns(deploymentId),
    });
    this.overviewLoader.setup({
      request: (deploymentId: string) => getStrategyExecutionOverview(deploymentId),
    });
    this.poller.setup({ interval: 1500, request: () => this.pollOnce() });
    this.registCleaner(() => this.todayLoader.cleanup());
    this.registCleaner(() => this.historyLoader.cleanup());
    this.registCleaner(() => this.overviewLoader.cleanup());
    this.registCleaner(() => this.poller.cleanup());

    void this.refresh();
  }

  public get entries(): SignalTodayEntry[] {
    return this.todayLoader.result ?? [];
  }

  public get selected(): SignalTodayEntry | null {
    return (
      this.entries.find((entry) => entry.deployment.id === this.selectedDeploymentId) ??
      this.entries[0] ??
      null
    );
  }

  public get selectedRun(): SignalRun | null {
    const runs = this.historyLoader.result ?? [];
    return (
      runs.find((run) => run.id === this.selectedRunId) ?? this.selected?.run ?? runs[0] ?? null
    );
  }

  public async refresh() {
    try {
      const entries = await this.todayLoader.run();
      const selected =
        entries.find((entry) => entry.deployment.id === this.selectedDeploymentId) ?? entries[0];
      const deploymentChanged = selected?.deployment.id !== this.selectedDeploymentId;
      runInAction(() => {
        this.selectedDeploymentId = selected?.deployment.id ?? '';
        if (deploymentChanged) {
          this.selectedRunId = '';
        }
        this.error = null;
      });
      if (selected) {
        void this.loadDeployment(selected.deployment.id);
        const jobId = selected.run?.status === 'running' ? selected.run.jobId : null;
        if (jobId) {
          this.startPolling(selected.deployment.id, jobId);
        }
      }
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : i18n.t('signals:loadFailed');
      });
    }
  }

  public selectDeployment(deploymentId: string) {
    if (deploymentId === this.selectedDeploymentId) {
      return;
    }
    runInAction(() => {
      this.selectedDeploymentId = deploymentId;
      this.selectedRunId = '';
      this.logLines = [];
      this.error = null;
    });
    void this.loadDeployment(deploymentId);
  }

  public selectRun(runId: string) {
    runInAction(() => {
      this.selectedRunId = runId;
    });
  }

  public async saveExecution(executionId: string, input: ActualExecutionUpdate) {
    if (this.savingExecutionId) {
      return;
    }
    runInAction(() => {
      this.savingExecutionId = executionId;
      this.error = null;
    });
    try {
      const run = await updateSignalExecution(executionId, input);
      runInAction(() => {
        this.selectedRunId = run.id;
      });
      await this.loadDeployment(run.deploymentId);
    } catch (error) {
      runInAction(() => {
        this.error = error instanceof Error ? error.message : i18n.t('signals:executionSaveFailed');
      });
    } finally {
      runInAction(() => {
        this.savingExecutionId = '';
      });
    }
  }

  public async generate(deploymentId: string) {
    if (this.runningDeploymentId) {
      return;
    }
    runInAction(() => {
      this.runningDeploymentId = deploymentId;
      this.logLines = [];
      this.error = null;
    });
    try {
      const result = await submitSignalRun(deploymentId);
      if (result.jobId) {
        this.startPolling(deploymentId, result.jobId);
      } else {
        runInAction(() => {
          this.runningDeploymentId = '';
        });
        await this.refresh();
      }
    } catch (error) {
      runInAction(() => {
        this.runningDeploymentId = '';
        this.error = error instanceof Error ? error.message : i18n.t('signals:generateFailed');
      });
    }
  }

  private startPolling(deploymentId: string, jobId: string) {
    this.jobId = jobId;
    this.since = 0;
    runInAction(() => {
      this.runningDeploymentId = deploymentId;
      this.logLines = [];
    });
    this.poller.start();
  }

  private async loadDeployment(deploymentId: string) {
    await Promise.all([
      this.historyLoader.run(deploymentId),
      this.overviewLoader.run(deploymentId),
    ]);
  }

  private async pollOnce(): Promise<false | void> {
    try {
      const job = await pollSignalJob(this.jobId, this.since);
      if (job.logs.length > 0) {
        runInAction(() => {
          this.logLines = [...this.logLines, ...job.logs];
          this.since = job.nextSince;
        });
      }
      if (job.status === 'done') {
        runInAction(() => {
          this.runningDeploymentId = '';
        });
        await this.refresh();
        return false;
      }
      if (job.status === 'error' || job.status === 'stale') {
        runInAction(() => {
          this.runningDeploymentId = '';
          this.error =
            job.status === 'stale'
              ? i18n.t('signals:interrupted')
              : job.error || i18n.t('signals:generateFailed');
        });
        await this.refresh();
        return false;
      }
    } catch {
      runInAction(() => {
        this.runningDeploymentId = '';
      });
      return false;
    }
  }
}
