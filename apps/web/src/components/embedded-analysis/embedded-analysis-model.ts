import { BaseModel, LoaderModel, PollingModel } from '@src/lib';
import { makeObservable, observable, runInAction } from 'mobx';
import type {
  EmbeddedAnalysisPart,
  ResearchEmbeddedAnalysisV1,
  ResearchEmbeddedRunV1,
  ResearchEmbeddedVersionV1,
  ResearchEmbeddedRunSummaryV1,
  ResearchEmbeddedPageV1,
} from '@jixie/shared';
import {
  readEmbeddedAnalysis,
  readEmbeddedRun,
  readEmbeddedVersion,
  listEmbeddedRuns,
  runEmbeddedDraft,
  updateEmbeddedDraft,
  deriveEmbeddedDraft,
  continueEmbeddedResearch,
  stopEmbeddedRun,
  readEmbeddedInput,
} from '@src/api/research-embedded';

interface Detail {
  run: ResearchEmbeddedRunV1;
  version: ResearchEmbeddedVersionV1;
  analysis: ResearchEmbeddedAnalysisV1;
}
export interface EmbeddedDraftForm {
  source: string;
  parameters: string;
  inputScope: string;
}
type Action =
  | { type: 'run' | 'cancel' | 'continue' }
  | { type: 'edit'; draft: EmbeddedDraftForm }
  | { type: 'input'; inputId: string };

export class EmbeddedAnalysisModel extends BaseModel<{ part: EmbeddedAnalysisPart }> {
  public detail = new LoaderModel<Detail>();
  public history = new LoaderModel<ResearchEmbeddedPageV1<ResearchEmbeddedRunSummaryV1>>();
  public action = new LoaderModel<{ documentId?: string; input?: unknown }>();
  public polling = new PollingModel();
  public runId = '';
  public historyItems: ResearchEmbeddedRunSummaryV1[] = [];
  private pendingSubmission?: {
    versionId: string;
    requestId: string;
    revision: number;
    draftKey: string;
  };

  public constructor() {
    super();
    makeObservable(this, { runId: observable.ref, historyItems: observable.ref });
  }
  public setup(params: { part: EmbeddedAnalysisPart }) {
    super.setup(params);
    runInAction(() => {
      this.runId = params.part.reference.runId;
      this.historyItems = [];
    });
    this.pendingSubmission = undefined;
    const analysisId = params.part.reference.analysisId;
    this.detail.setup({
      request: async (runId: string, signal) => {
        const [run, analysis] = await Promise.all([
          readEmbeddedRun(analysisId, runId, signal),
          readEmbeddedAnalysis(analysisId, signal),
        ]);
        const version = await readEmbeddedVersion(analysisId, run.versionId, signal);
        if (this.ready && !signal.aborted) {
          this.updateHistoryRun(run);
        }
        return { run, version, analysis };
      },
    });
    this.history.setup({
      request: (cursor: string | undefined, signal) => listEmbeddedRuns(analysisId, cursor, signal),
    });
    this.action.setup({ request: (action: Action) => this.perform(action) });
    this.polling.setup({
      interval: 1_000,
      request: async () => {
        if (!this.ready) {
          return false;
        }
        if (this.detail.loading) {
          return;
        }
        try {
          const result = await this.detail.run(this.runId);
          if (!this.ready || !['queued', 'running'].includes(result.run.status)) {
            return false;
          }
        } catch {
          return false;
        }
      },
    });
    this.registCleaner(() => this.detail.cleanup());
    this.registCleaner(() => this.history.cleanup());
    this.registCleaner(() => this.action.cleanup());
    this.registCleaner(() => this.polling.cleanup());
    void this.refresh();
  }
  public async refresh() {
    if (this.detail.loading) {
      return;
    }
    try {
      const result = await this.detail.run(this.runId);
      if (this.ready && ['queued', 'running'].includes(result.run.status)) {
        this.polling.start();
      }
    } catch {
      /* Loader displays the failure and offers explicit retry. */
    }
  }
  public async selectRun(runId: string) {
    if (this.detail.loading) {
      return;
    }
    this.polling.stop();
    this.pendingSubmission = undefined;
    runInAction(() => {
      this.runId = runId;
    });
    await this.refresh();
  }
  public async loadHistory(older = false) {
    if (this.history.loading) {
      return;
    }
    try {
      const result = await this.history.run(older ? this.history.result?.nextCursor : undefined);
      runInAction(() => {
        this.historyItems = older ? [...this.historyItems, ...result.items] : result.items;
      });
      if (this.detail.result?.run) {
        this.updateHistoryRun(this.detail.result.run);
      }
    } catch {
      /* Loader displays the failure. */
    }
  }
  public async act(action: Action) {
    if (this.action.loading) {
      return;
    }
    try {
      return await this.action.run(action);
    } catch {
      return undefined;
    }
  }
  private updateHistoryRun(run: ResearchEmbeddedRunSummaryV1) {
    runInAction(() => {
      this.historyItems = this.historyItems.map((item) =>
        item.runId === run.runId
          ? {
              ...item,
              status: run.status,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              errorCode: run.errorCode,
              error: run.error,
            }
          : item,
      );
    });
  }
  private async perform(action: Action): Promise<{ documentId?: string; input?: unknown }> {
    const { run, version, analysis } = this.detail.result;
    const analysisId = analysis.id;
    switch (action.type) {
      case 'continue':
        return continueEmbeddedResearch(analysisId, run.runId);
      case 'input':
        return { input: await readEmbeddedInput(analysisId, run.runId, action.inputId) };
      case 'cancel':
        await stopEmbeddedRun(analysisId, run.runId);
        await this.refresh();
        return {};
      case 'edit':
      case 'run': {
        const draftKey =
          action.type === 'edit'
            ? JSON.stringify(action.draft)
            : `${version.id}:${version.revision}`;
        if (!this.pendingSubmission || this.pendingSubmission.draftKey !== draftKey) {
          let next = version;
          if (action.type === 'run' && run.revision !== version.revision) {
            next = await deriveEmbeddedDraft(analysisId, version.id, {
              source: run.source,
              parameters: run.parameters,
              inputScope: run.inputScope,
              reportId: run.context.report?.id,
            });
          }
          if (action.type === 'edit') {
            const draft = {
              source: action.draft.source,
              parameters: JSON.parse(action.draft.parameters),
              inputScope: action.draft.inputScope,
              reportId: run.context.report?.id,
            };
            next = version.frozenAt
              ? await deriveEmbeddedDraft(analysisId, version.id, draft)
              : await updateEmbeddedDraft(analysisId, version.id, {
                  ...draft,
                  expectedRevision: version.revision,
                });
          }
          this.pendingSubmission = {
            versionId: next.id,
            revision: next.revision,
            requestId: crypto.randomUUID(),
            draftKey,
          };
        }
        const pending = this.pendingSubmission;
        const submitted = await runEmbeddedDraft(analysisId, pending.versionId, {
          requestId: pending.requestId,
          expectedRevision: pending.revision,
        });
        this.pendingSubmission = undefined;
        await this.selectRun(submitted.runId);
        await this.loadHistory();
        return {};
      }
    }
  }
}
