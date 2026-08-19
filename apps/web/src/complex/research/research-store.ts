import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type MessagePart,
  type ResearchCellKindV1,
  type ResearchCellChangeAttemptV1,
  type ResearchCellChangeReviewCellV1,
  type ResearchCellChangeReviewResolutionResultV1,
  type ResearchCellChangeRunResultV1,
  type ResearchCellChangeResolutionResultV1,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogResultV1,
  type ResearchCuratorDispositionV1,
  type ResearchCuratorFindingV1,
  type ResearchCuratorRunV1,
  type ResearchCuratorVerificationAssessmentV1,
  type ResearchDocumentInterruptResultV1,
  type ResearchDocumentRunResultV1,
  type ResearchDocumentSummaryV1,
  type ResearchDocumentTemplateV1,
  type ResearchDocumentV1,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  ApiError,
  acceptResearchCellChangeReview,
  addResearchCell,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  createResearchDocument,
  deleteResearchCell,
  deleteResearchConversation,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  getResearchDocument,
  interruptResearchDocument,
  listResearchDocuments,
  renameResearchConversation,
  rejectResearchCellChangeProposal,
  revertResearchCellChangeReview,
  resetResearchDocument,
  runAffectedResearchCells,
  runResearchCellChangeProposal,
  runResearchCell,
  runResearchDocument,
  sendResearchAgent,
  searchResearchDataCatalog,
  startResearchCurator,
  updateResearchCell,
  updateResearchCuratorFinding,
} from '@src/api/client';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import i18n from '@src/i18n';
import {
  editResearchCellDraft,
  RESEARCH_AUTOSAVE_TICK_MS,
  researchCellDraftIsDue,
  savedResearchCellDraft,
  type ResearchCellDraftState,
} from './research-autosave';

type ResearchSetupParams = {};

interface ResearchDataCatalogQuery {
  query: string;
  assetType?: ResearchAssetTypeV1;
}

type ResearchDocumentMutation =
  | { kind: 'create'; template: ResearchDocumentTemplateV1 }
  | { kind: 'add'; documentId: string; cellKind: ResearchCellKindV1; source?: string }
  | { kind: 'update'; cellId: string; source: string; expectedRevision: number }
  | { kind: 'delete'; cellId: string }
  | { kind: 'run'; cellId: string }
  | { kind: 'reset'; documentId: string };

type ResearchCuratorMutation =
  | { kind: 'start' }
  | {
      kind: 'disposition';
      findingId: string;
      disposition: Exclude<ResearchCuratorDispositionV1, 'pending'>;
    }
  | {
      kind: 'verification';
      findingId: string;
      assessment: ResearchCuratorVerificationAssessmentV1;
    };

type ResearchCellChangeResolution = {
  kind: 'apply' | 'apply_for_review' | 'reject';
  proposalId: string;
};

type ResearchCellChangeReviewResolution = {
  kind: 'accept' | 'revert';
  proposalId: string;
  expectedContentRevision: number;
};

const CURATOR_POLL_INTERVAL_MS = 1_000;

/** Domain state for the reactive research document and its attached Agent conversation. */
export class ResearchStore extends BaseStore<ResearchSetupParams> {
  public document: ResearchDocumentV1 | null = null;
  public chatMessages: ChatMessage[] = [];
  public sending = false;
  public prompt = '';
  public busyCellId: string | null = null;
  public affectedRunningCellId: string | null = null;
  public documentRunning = false;
  public interrupting = false;
  public runInterrupted = false;
  public resolvingProposalId: string | null = null;
  public runningProposalId: string | null = null;
  public explainingAttemptId: string | null = null;
  public cellDrafts = observable.map<string, ResearchCellDraftState>();
  public turnStream = new AgentTurnStream();
  public documentsLoader = new LoaderModel<ResearchDocumentSummaryV1[]>();
  public documentLoader = new LoaderModel<ResearchDocumentV1>();
  public documentMutationLoader = new LoaderModel<ResearchDocumentV1>();
  public documentRunLoader = new LoaderModel<ResearchDocumentRunResultV1>();
  public affectedRunLoader = new LoaderModel<ResearchDocumentRunResultV1>();
  public interruptLoader = new LoaderModel<ResearchDocumentInterruptResultV1>();
  public cellChangeResolutionLoader = new LoaderModel<ResearchCellChangeResolutionResultV1>();
  public cellChangeReviewResolutionLoader =
    new LoaderModel<ResearchCellChangeReviewResolutionResultV1>();
  public cellChangeRunLoader = new LoaderModel<ResearchCellChangeRunResultV1>();
  public dataCatalogLoader = new LoaderModel<ResearchDataCatalogResultV1>();
  public curatorLoader = new LoaderModel<ResearchCuratorRunV1 | null>();
  public curatorMutationLoader = new LoaderModel<ResearchCuratorRunV1 | ResearchCuratorFindingV1>();
  public curatorPoller = new PollingModel();
  private autosaveTimer: number | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private queuedCellSaves = new Map<string, Promise<boolean>>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      document: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      prompt: observable.ref,
      busyCellId: observable.ref,
      affectedRunningCellId: observable.ref,
      documentRunning: observable.ref,
      interrupting: observable.ref,
      runInterrupted: observable.ref,
      resolvingProposalId: observable.ref,
      runningProposalId: observable.ref,
      explainingAttemptId: observable.ref,
      setPrompt: action,
      clearRunInterrupted: action,
    });
  }

  public setup(params: ResearchSetupParams) {
    super.setup(params);
    this.documentsLoader.setup({ request: () => listResearchDocuments() });
    this.documentLoader.setup({ request: (documentId: string) => getResearchDocument(documentId) });
    this.documentMutationLoader.setup({
      preserveResult: false,
      request: (mutation: ResearchDocumentMutation) => {
        switch (mutation.kind) {
          case 'create':
            return createResearchDocument(mutation.template);
          case 'add':
            return addResearchCell(
              mutation.documentId,
              mutation.cellKind,
              mutation.source ?? defaultCellSource(mutation.cellKind),
            );
          case 'update':
            return updateResearchCell(mutation.cellId, {
              source: mutation.source,
              expectedRevision: mutation.expectedRevision,
            });
          case 'delete':
            return deleteResearchCell(mutation.cellId);
          case 'run':
            return runResearchCell(mutation.cellId);
          case 'reset':
            return resetResearchDocument(mutation.documentId);
        }
      },
    });
    this.documentRunLoader.setup({
      preserveResult: false,
      request: ({ documentId, clean }: { documentId: string; clean: boolean }) =>
        runResearchDocument(documentId, clean),
    });
    this.affectedRunLoader.setup({
      preserveResult: false,
      request: (cellId: string) => runAffectedResearchCells(cellId),
    });
    this.interruptLoader.setup({
      preserveResult: false,
      request: (documentId: string) => interruptResearchDocument(documentId),
    });
    this.cellChangeResolutionLoader.setup({
      preserveResult: false,
      request: (resolution: ResearchCellChangeResolution) => {
        switch (resolution.kind) {
          case 'apply':
            return applyResearchCellChangeProposal(resolution.proposalId);
          case 'apply_for_review':
            return applyResearchCellChangeProposalForReview(resolution.proposalId);
          case 'reject':
            return rejectResearchCellChangeProposal(resolution.proposalId);
        }
      },
    });
    this.cellChangeReviewResolutionLoader.setup({
      preserveResult: false,
      request: (resolution: ResearchCellChangeReviewResolution) =>
        resolution.kind === 'accept'
          ? acceptResearchCellChangeReview(
              resolution.proposalId,
              resolution.expectedContentRevision,
            )
          : revertResearchCellChangeReview(
              resolution.proposalId,
              resolution.expectedContentRevision,
            ),
    });
    this.cellChangeRunLoader.setup({
      preserveResult: false,
      request: (proposalId: string) => runResearchCellChangeProposal(proposalId),
    });
    this.dataCatalogLoader.setup({
      request: ({ query, assetType }: ResearchDataCatalogQuery, signal) =>
        searchResearchDataCatalog(query, assetType, signal),
    });
    this.curatorLoader.setup({
      request: (runId?: string) =>
        runId ? getResearchCuratorRun(runId) : getLatestResearchCuratorRun(),
    });
    this.curatorMutationLoader.setup({
      preserveResult: false,
      request: (mutation: ResearchCuratorMutation) => {
        switch (mutation.kind) {
          case 'start':
            return startResearchCurator();
          case 'disposition':
            return updateResearchCuratorFinding(mutation.findingId, {
              disposition: mutation.disposition,
            });
          case 'verification':
            return updateResearchCuratorFinding(mutation.findingId, {
              verificationAssessment: mutation.assessment,
            });
        }
      },
    });
    this.curatorPoller.setup({
      interval: CURATOR_POLL_INTERVAL_MS,
      request: () => this.pollCurator(),
    });
    this.registCleaner(() => this.documentsLoader.cleanup());
    this.registCleaner(() => this.documentLoader.cleanup());
    this.registCleaner(() => this.documentMutationLoader.cleanup());
    this.registCleaner(() => this.documentRunLoader.cleanup());
    this.registCleaner(() => this.affectedRunLoader.cleanup());
    this.registCleaner(() => this.interruptLoader.cleanup());
    this.registCleaner(() => this.cellChangeResolutionLoader.cleanup());
    this.registCleaner(() => this.cellChangeReviewResolutionLoader.cleanup());
    this.registCleaner(() => this.cellChangeRunLoader.cleanup());
    this.registCleaner(() => this.dataCatalogLoader.cleanup());
    this.registCleaner(() => this.curatorLoader.cleanup());
    this.registCleaner(() => this.curatorMutationLoader.cleanup());
    this.registCleaner(() => this.curatorPoller.cleanup());
    this.registCleaner(() => this.turnStream.detach());
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (this.hasUnsavedDrafts) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    this.registCleaner(() => window.removeEventListener('beforeunload', warnBeforeUnload));
    this.registCleaner(() => this.stopAutosaveTimer());
    void this.documentsLoader.run();
    void this.loadCurator().catch(() => {});
  }

  public get documentId(): string | null {
    return this.document?.id ?? null;
  }

  public get conversationId(): string | null {
    return this.document?.conversationId ?? null;
  }

  public get conversationTitle(): string {
    return this.document?.title ?? '';
  }

  public get hasActiveRun(): boolean {
    return (
      this.busyCellId !== null ||
      this.affectedRunningCellId !== null ||
      this.documentRunning ||
      this.runningProposalId !== null
    );
  }

  public get hasUnsavedDrafts(): boolean {
    return [...this.cellDrafts.values()].some((draft) => draft.status !== 'saved');
  }

  public get hasOpenCellChangeReview(): boolean {
    return this.document?.activeCellChangeReview?.status === 'open';
  }

  public cellDraft(cellId: string): ResearchCellDraftState | undefined {
    return this.cellDrafts.get(cellId);
  }

  public cellChangeReview(cellId: string): ResearchCellChangeReviewCellV1 | undefined {
    return this.document?.activeCellChangeReview?.cells.find((cell) => cell.cellId === cellId);
  }

  public setPrompt(value: string) {
    this.prompt = value;
  }

  public clearRunInterrupted() {
    this.runInterrupted = false;
  }

  public changeCellDraft(cellId: string, source: string) {
    const current = this.cellDrafts.get(cellId);
    if (!current || current.draft === source) {
      return;
    }
    runInAction(() => {
      this.cellDrafts.set(cellId, editResearchCellDraft(current, source, Date.now()));
    });
    this.ensureAutosaveTimer();
  }

  public async newDocument() {
    if (!(await this.flushAllCellDrafts())) {
      return;
    }
    this.turnStream.detach();
    runInAction(() => {
      this.document = null;
      this.cellDrafts.clear();
      this.chatMessages = [];
      this.sending = false;
      this.prompt = '';
      this.runInterrupted = false;
    });
  }

  public async createDocument(template: ResearchDocumentTemplateV1) {
    const document = await this.documentMutationLoader.run({ kind: 'create', template });
    runInAction(() => this.cellDrafts.clear());
    this.acceptDocument(document);
    void this.documentsLoader.run();
  }

  public async openDocument(id: string) {
    if (id === this.documentId || !(await this.flushAllCellDrafts())) {
      return;
    }
    this.turnStream.detach();
    runInAction(() => {
      this.runInterrupted = false;
      this.cellDrafts.clear();
    });
    const document = await this.documentLoader.run(id);
    this.acceptDocument(document);
    void this.reattachTurn();
  }

  public flushCellDraft(cellId: string): Promise<boolean> {
    return this.flushCellDrafts([cellId]);
  }

  public flushPendingChanges(): Promise<boolean> {
    return this.flushAllCellDrafts();
  }

  public async addCell(kind: ResearchCellKindV1) {
    if (!this.documentId || this.hasOpenCellChangeReview || !(await this.flushAllCellDrafts())) {
      return;
    }
    const document = await this.documentMutationLoader.run({
      kind: 'add',
      documentId: this.documentId,
      cellKind: kind,
    });
    this.acceptDocument(document, false);
  }

  public async deleteCell(cellId: string) {
    if (this.hasOpenCellChangeReview || !(await this.flushAllCellDrafts())) {
      return;
    }
    const document = await this.documentMutationLoader.run({ kind: 'delete', cellId });
    this.acceptDocument(document, false);
    void this.documentsLoader.run();
  }

  public async runCell(cellId: string) {
    if (this.hasActiveRun || this.hasOpenCellChangeReview || !(await this.flushAllCellDrafts())) {
      return;
    }
    runInAction(() => {
      this.busyCellId = cellId;
      this.runInterrupted = false;
    });
    try {
      const document = await this.documentMutationLoader.run({ kind: 'run', cellId });
      this.acceptDocument(document, false);
    } finally {
      runInAction(() => {
        this.busyCellId = null;
      });
    }
  }

  public async runAffected(cellId: string) {
    if (this.hasActiveRun || this.hasOpenCellChangeReview || !(await this.flushAllCellDrafts())) {
      return;
    }
    runInAction(() => {
      this.affectedRunningCellId = cellId;
      this.runInterrupted = false;
    });
    try {
      const result = await this.affectedRunLoader.run(cellId);
      this.acceptDocument(result.document, false);
      void this.documentsLoader.run();
    } finally {
      runInAction(() => {
        this.affectedRunningCellId = null;
      });
    }
  }

  public async runAll(clean = true) {
    if (
      !this.documentId ||
      this.hasActiveRun ||
      this.hasOpenCellChangeReview ||
      !(await this.flushAllCellDrafts())
    ) {
      return;
    }
    runInAction(() => {
      this.documentRunning = true;
      this.runInterrupted = false;
    });
    try {
      const result = await this.documentRunLoader.run({ documentId: this.documentId, clean });
      this.acceptDocument(result.document, false);
      void this.documentsLoader.run();
    } finally {
      runInAction(() => {
        this.documentRunning = false;
      });
    }
  }

  public async interruptRun() {
    if (!this.documentId || !this.hasActiveRun || this.interrupting) {
      return;
    }
    runInAction(() => {
      this.interrupting = true;
    });
    try {
      const result = await this.interruptLoader.run(this.documentId);
      this.acceptDocument(result.document, false);
      runInAction(() => {
        this.runInterrupted = result.interrupted;
      });
      void this.documentsLoader.run();
    } finally {
      runInAction(() => {
        this.interrupting = false;
      });
    }
  }

  public async resetRuntime() {
    if (!this.documentId || this.hasOpenCellChangeReview || !(await this.flushAllCellDrafts())) {
      return;
    }
    const document = await this.documentMutationLoader.run({
      kind: 'reset',
      documentId: this.documentId,
    });
    this.acceptDocument(document, false);
  }

  public applyCellChangeProposal(proposalId: string) {
    return this.resolveCellChangeProposal('apply', proposalId);
  }

  public rejectCellChangeProposal(proposalId: string) {
    return this.resolveCellChangeProposal('reject', proposalId);
  }

  public acceptCellChangeReview(proposalId: string) {
    return this.resolveCellChangeReview('accept', proposalId);
  }

  public revertCellChangeReview(proposalId: string) {
    return this.resolveCellChangeReview('revert', proposalId);
  }

  public async runCellChangeProposal(proposalId: string) {
    if (this.hasActiveRun || this.runningProposalId || !(await this.flushAllCellDrafts())) {
      return;
    }
    runInAction(() => {
      this.runningProposalId = proposalId;
      this.runInterrupted = false;
    });
    try {
      const result = await this.cellChangeRunLoader.run(proposalId);
      this.acceptDocument(result.document);
      void this.documentsLoader.run();
    } finally {
      runInAction(() => {
        this.runningProposalId = null;
      });
    }
  }

  public explainCellChangeAttempt(attempt: ResearchCellChangeAttemptV1) {
    return this.send(
      i18n.t('research:workbench.cellChange.explainPrompt', { id: attempt.id }),
      attempt.id,
    );
  }

  public searchDataCatalog(query: string, assetType?: ResearchAssetTypeV1) {
    return this.dataCatalogLoader.run({ query, assetType });
  }

  public async send(message: string, attemptId?: string) {
    const text = message.trim();
    if (!text || this.sending || this.resolvingProposalId || !this.conversationId) {
      return;
    }
    if (!(await this.flushAllCellDrafts())) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.explainingAttemptId = attemptId ?? null;
      this.prompt = '';
    });
    try {
      const started = await sendResearchAgent(text, this.conversationId, attemptId);
      await this.turnStream.attach(started.turnId, this.turnHandlers());
    } catch (error) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('research:error.withDetail', {
              detail:
                error instanceof Error ? error.message : i18n.t('research:error.requestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => {
        this.sending = false;
        this.explainingAttemptId = null;
      });
      void this.documentsLoader.run();
    }
  }

  public async renameConversation(title: string) {
    const trimmed = title.trim();
    if (!trimmed || !this.conversationId || !this.document) {
      return;
    }
    const previous = this.document;
    runInAction(() => {
      this.document = { ...previous, title: trimmed };
    });
    try {
      await renameResearchConversation(this.conversationId, trimmed);
      void this.documentsLoader.run();
    } catch {
      runInAction(() => {
        this.document = previous;
      });
    }
  }

  public async removeConversation(id: string) {
    await deleteResearchConversation(id);
    void this.documentsLoader.run();
    if (this.documentId === id) {
      this.turnStream.detach();
      runInAction(() => {
        this.document = null;
        this.cellDrafts.clear();
        this.chatMessages = [];
        this.sending = false;
        this.prompt = '';
        this.runInterrupted = false;
      });
    }
  }

  public async startCurator() {
    const result = await this.curatorMutationLoader.run({ kind: 'start' });
    if (!('findings' in result)) {
      return;
    }
    const run = await this.curatorLoader.run(result.id);
    if (run && isCuratorActive(run)) {
      this.curatorPoller.start();
    }
  }

  public async setCuratorDisposition(
    findingId: string,
    disposition: Exclude<ResearchCuratorDispositionV1, 'pending'>,
  ) {
    await this.curatorMutationLoader.run({ kind: 'disposition', findingId, disposition });
    const runId = this.curatorLoader.result?.id;
    if (runId) {
      await this.curatorLoader.run(runId);
    }
  }

  public async assessCuratorVerification(
    findingId: string,
    assessment: ResearchCuratorVerificationAssessmentV1,
  ) {
    await this.curatorMutationLoader.run({ kind: 'verification', findingId, assessment });
    const runId = this.curatorLoader.result?.id;
    if (runId) {
      await this.curatorLoader.run(runId);
    }
  }

  private acceptDocument(
    document: ResearchDocumentV1,
    replaceMessages = true,
    savedCell?: { cellId: string; source: string },
  ) {
    runInAction(() => {
      this.document = document;
      this.reconcileCellDrafts(document, savedCell);
      if (replaceMessages) {
        this.chatMessages = document.messages.map(normalizeChatMessage);
      }
    });
  }

  private async resolveCellChangeProposal(
    kind: ResearchCellChangeResolution['kind'],
    proposalId: string,
  ) {
    if (this.resolvingProposalId) {
      return;
    }
    runInAction(() => {
      this.resolvingProposalId = proposalId;
    });
    try {
      if (kind !== 'reject' && !(await this.flushAllCellDrafts())) {
        return;
      }
      const result = await this.cellChangeResolutionLoader.run({ kind, proposalId });
      this.acceptDocument(result.document);
      void this.documentsLoader.run();
    } catch {
      // LoaderModel retains the localized API error for the workspace alert.
    } finally {
      runInAction(() => {
        this.resolvingProposalId = null;
      });
    }
  }

  private async resolveCellChangeReview(
    kind: ResearchCellChangeReviewResolution['kind'],
    proposalId: string,
  ) {
    if (this.resolvingProposalId || !this.document) {
      return;
    }
    runInAction(() => {
      this.resolvingProposalId = proposalId;
    });
    try {
      if (!(await this.flushAllCellDrafts())) {
        return;
      }
      const result = await this.cellChangeReviewResolutionLoader.run({
        kind,
        proposalId,
        expectedContentRevision: this.document.contentRevision,
      });
      this.acceptDocument(result.document);
      void this.documentsLoader.run();
    } finally {
      runInAction(() => {
        this.resolvingProposalId = null;
      });
    }
  }

  private autoApplyCellChangeProposal(parts: MessagePart[]): void {
    const proposal = parts.find(
      (part): part is Extract<MessagePart, { type: 'research_cell_change' }> =>
        part.type === 'research_cell_change',
    )?.proposal;
    if (!proposal || proposal.operations.some((operation) => operation.kind === 'delete')) {
      return;
    }
    void this.resolveCellChangeProposal('apply_for_review', proposal.id);
  }

  private reconcileCellDrafts(
    document: ResearchDocumentV1,
    savedCell?: { cellId: string; source: string },
  ) {
    const serverCellIds = new Set(document.cells.map((cell) => cell.id));
    for (const cellId of this.cellDrafts.keys()) {
      if (!serverCellIds.has(cellId)) {
        this.cellDrafts.delete(cellId);
      }
    }
    for (const cell of document.cells) {
      const current = this.cellDrafts.get(cell.id);
      if (savedCell?.cellId === cell.id) {
        const latest = current ?? savedResearchCellDraft(cell.id, cell.source, cell.revision);
        const clean = latest.draft === savedCell.source;
        this.cellDrafts.set(cell.id, {
          ...latest,
          persistedSource: cell.source,
          expectedRevision: cell.revision,
          status: clean ? 'saved' : 'dirty',
          dirtySince: clean ? null : (latest.dirtySince ?? Date.now()),
          lastChangedAt: clean ? null : (latest.lastChangedAt ?? Date.now()),
        });
        continue;
      }
      if (!current || current.status === 'saved') {
        this.cellDrafts.set(cell.id, savedResearchCellDraft(cell.id, cell.source, cell.revision));
        continue;
      }
      if (current.expectedRevision !== cell.revision || current.persistedSource !== cell.source) {
        this.cellDrafts.set(cell.id, { ...current, status: 'conflict' });
      }
    }
    this.ensureAutosaveTimer();
  }

  private ensureAutosaveTimer() {
    const hasDirty = [...this.cellDrafts.values()].some((draft) => draft.status === 'dirty');
    if (!hasDirty) {
      this.stopAutosaveTimer();
      return;
    }
    if (this.autosaveTimer !== null) {
      return;
    }
    this.autosaveTimer = window.setInterval(() => this.autosaveTick(), RESEARCH_AUTOSAVE_TICK_MS);
  }

  private stopAutosaveTimer() {
    if (this.autosaveTimer !== null) {
      window.clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  private autosaveTick() {
    const now = Date.now();
    const candidate = [...this.cellDrafts.values()].find(
      (draft) => !this.queuedCellSaves.has(draft.cellId) && researchCellDraftIsDue(draft, now),
    );
    if (candidate) {
      void this.enqueueCellSave(candidate.cellId);
    }
    this.ensureAutosaveTimer();
  }

  private enqueueCellSave(cellId: string): Promise<boolean> {
    const queued = this.queuedCellSaves.get(cellId);
    if (queued) {
      return queued;
    }
    const save = this.saveChain.then(() => this.persistCellDraft(cellId));
    this.saveChain = save.then(
      (): void => undefined,
      (): void => undefined,
    );
    this.queuedCellSaves.set(cellId, save);
    void save.finally(() => {
      if (this.queuedCellSaves.get(cellId) === save) {
        this.queuedCellSaves.delete(cellId);
      }
      this.ensureAutosaveTimer();
    });
    return save;
  }

  private async persistCellDraft(cellId: string): Promise<boolean> {
    const current = this.cellDrafts.get(cellId);
    if (!current || current.status === 'saved') {
      return true;
    }
    if (current.status === 'conflict') {
      return false;
    }
    if (current.draft === current.persistedSource) {
      runInAction(() => {
        this.cellDrafts.set(cellId, { ...current, status: 'saved' });
      });
      return true;
    }
    const source = current.draft;
    runInAction(() => {
      this.cellDrafts.set(cellId, { ...current, status: 'saving' });
    });
    try {
      const document = await this.documentMutationLoader.run({
        kind: 'update',
        cellId,
        source,
        expectedRevision: current.expectedRevision,
      });
      this.acceptDocument(document, false, { cellId, source });
      void this.documentsLoader.run();
      return true;
    } catch (error) {
      runInAction(() => {
        const latest = this.cellDrafts.get(cellId);
        if (latest) {
          this.cellDrafts.set(cellId, {
            ...latest,
            status: error instanceof ApiError && error.status === 409 ? 'conflict' : 'error',
          });
        }
      });
      return false;
    }
  }

  private flushAllCellDrafts(): Promise<boolean> {
    return this.flushCellDrafts([...this.cellDrafts.keys()]);
  }

  private async flushCellDrafts(cellIds: string[]): Promise<boolean> {
    while (true) {
      const candidates = cellIds.filter((cellId) => {
        const draft = this.cellDrafts.get(cellId);
        return draft?.status === 'dirty' || draft?.status === 'error' || draft?.status === 'saving';
      });
      if (cellIds.some((cellId) => this.cellDrafts.get(cellId)?.status === 'conflict')) {
        return false;
      }
      if (candidates.length === 0) {
        return true;
      }
      for (const cellId of candidates) {
        if (!(await this.enqueueCellSave(cellId))) {
          return false;
        }
      }
    }
  }

  private turnHandlers(): AgentTurnHandlers {
    return {
      onDone: (done) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            {
              role: 'assistant',
              parts: done.parts,
              turnId: done.turnId,
              toolTrace: done.toolTrace,
            } as ChatMessage,
          ];
          this.sending = false;
        });
        this.autoApplyCellChangeProposal(done.parts);
      },
      onError: (message) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('research:error.withDetail', { detail: message })),
          ];
          this.sending = false;
        });
      },
      onCancelled: () => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('research:error.cancelled')),
          ];
          this.sending = false;
        });
      },
    };
  }

  private async reattachTurn() {
    if (!this.conversationId) {
      return;
    }
    runInAction(() => {
      this.sending = true;
    });
    await this.turnStream.attachRunning(`research:${this.conversationId}`, this.turnHandlers());
    runInAction(() => {
      this.sending = false;
    });
  }

  private async loadCurator() {
    const run = await this.curatorLoader.run();
    if (run && isCuratorActive(run)) {
      this.curatorPoller.start();
    }
  }

  private async pollCurator(): Promise<false | void> {
    const runId = this.curatorLoader.result?.id;
    if (!runId) {
      return false;
    }
    try {
      const run = await this.curatorLoader.run(runId);
      return isCuratorActive(run) ? undefined : false;
    } catch {
      return false;
    }
  }
}

function isCuratorActive(run: ResearchCuratorRunV1 | null): boolean {
  return run?.status === 'queued' || run?.status === 'running';
}

function defaultCellSource(kind: ResearchCellKindV1): string {
  switch (kind) {
    case 'markdown':
      return '## 新的研究步骤\n\n记录问题、假设或观察。';
    case 'python':
      return '# Write exploratory Python here\n';
    case 'validation':
      return '{\n  "version": 1\n}';
  }
}
