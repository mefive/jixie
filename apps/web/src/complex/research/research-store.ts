import { changeEmbeddedInputMode } from '@src/api/research-embedded';
import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  researchUpstreamDependencyCellIds,
  textMessage,
  type ChatMessage,
  type MessagePart,
  type ResearchCellContextRoleV1,
  type ResearchCellKindV1,
  type ResearchCellV1,
  type ResearchCellChangeAttemptV1,
  type ResearchCellChangeReviewCellV1,
  type ResearchCellChangeReviewResolutionResultV1,
  type ResearchCellChangeRunResultV1,
  type ResearchCellChangeResolutionResultV1,
  type ResearchClarificationSelectionV1,
  type ResearchClarificationV1,
  type ResearchAssetTypeV1,
  type ResearchDataCatalogResultV1,
  type ResearchDataCatalogScopeV1,
  type ResearchCuratorDispositionV1,
  type ResearchCuratorFindingV1,
  type ResearchCuratorRunV1,
  type ResearchCuratorVerificationAssessmentV1,
  type ResearchDocumentInterruptResultV1,
  type ResearchDocumentRunResultV1,
  type ResearchDocumentSummaryV1,
  type ResearchDocumentTemplateV1,
  type ResearchDocumentV1,
  type ResearchExecutionPromotionInputV1,
  type ResearchExecutionSummaryV1,
  type ResearchExecutionV1,
  type ResearchFactorDraftResultV1,
  type ResearchStrategyDraftResultV1,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import { ApiError } from '@src/api/client';
import {
  answerResearchClarification,
  acceptResearchCellChangeReview,
  addResearchCell,
  applyResearchCellChangeProposal,
  applyResearchCellChangeProposalForReview,
  archiveResearchDocument,
  createResearchDocument,
  createResearchDocumentFromBacktestReport,
  createResearchFactorDraft,
  createResearchStrategyDraft,
  deleteResearchCell,
  deleteResearchDocument,
  getLatestResearchCuratorRun,
  getResearchExecution,
  getResearchCuratorRun,
  getResearchDocument,
  interruptResearchDocument,
  listResearchDocuments,
  listResearchExecutions,
  promoteResearchExecution,
  renameResearchDocument,
  rejectResearchCellChangeProposal,
  revertResearchCellChangeReview,
  resetResearchDocument,
  restoreResearchDocument,
  runAffectedResearchCells,
  runResearchCellChangeProposal,
  runResearchCell,
  runResearchDocument,
  sendResearchAgent,
  searchResearchDataCatalog,
  startResearchCurator,
  updateResearchCell,
  updateResearchCuratorFinding,
} from '@src/api/research';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import i18n from '@src/i18n';
import {
  editResearchCellDraft,
  RESEARCH_AUTOSAVE_TICK_MS,
  researchCellDraftIsDue,
  savedResearchCellDraft,
  type ResearchCellDraftState,
} from './research-autosave';

/**
 * 配置研究路由的文档、执行或报告初始选择。
 *
 * Configure initial document, execution or report selection for the research route.
 */
type ResearchSetupParams = {
  document?: string;
  execution?: string;
  backtestReport?: string;
};

/**
 * 限定工作台目录搜索范围与筛选条件。
 *
 * Configure catalog scope and filters in the research workspace.
 */
interface ResearchDataCatalogQuery {
  query: string;
  assetType?: ResearchAssetTypeV1;
  scope: ResearchDataCatalogScopeV1;
}

/**
 * 区分文档和 Cell 变更，供统一 Mutation Loader。
 *
 * Discriminate document and cell mutations for the shared loader.
 */
type ResearchDocumentMutation =
  | {
      kind: 'embedded-input-mode';
      documentId: string;
      inputMode: 'retained' | 'current';
      expectedRevision: number;
    }
  | { kind: 'create'; template: ResearchDocumentTemplateV1 }
  | { kind: 'add'; documentId: string; cellKind: ResearchCellKindV1; source?: string }
  | { kind: 'update'; cellId: string; source: string; expectedRevision: number }
  | { kind: 'delete'; cellId: string }
  | { kind: 'run'; cellId: string }
  | { kind: 'reset'; documentId: string };

/**
 * 区分归档、恢复和删除，供文档管理请求。
 *
 * Discriminate archive, restore and delete document actions.
 */
type ResearchDocumentManagementMutation =
  | { kind: 'archive'; documentId: string }
  | { kind: 'restore'; documentId: string }
  | { kind: 'delete'; documentId: string };

/**
 * 区分整理启动和反馈更新，供 Curator 请求。
 *
 * Discriminate curator starts and feedback changes.
 */
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

/**
 * 绑定审阅接受或撤销动作与当前记录身份。
 *
 * Associate review accept or revert actions with the current review identity.
 */
type ResearchCellChangeReviewResolution = {
  kind: 'accept' | 'revert';
  proposalId: string;
  expectedContentRevision: number;
};

const CURATOR_POLL_INTERVAL_MS = 1_000;
const MAX_RESEARCH_AGENT_CONTEXT_CELLS = 8;

/** Domain state for the reactive research document and its attached Agent conversation. */
export class ResearchStore extends BaseStore<ResearchSetupParams> {
  public document: ResearchDocumentV1 | null = null;
  public requestedExecutionId: string | null = null;
  public requestedBacktestReportId: string | null = null;
  public chatMessages: ChatMessage[] = [];
  public sending = false;
  public prompt = '';
  public agentContextCellIds: string[] = [];
  public busyCellId: string | null = null;
  public affectedRunningCellId: string | null = null;
  public documentRunning = false;
  public interrupting = false;
  public runInterrupted = false;
  public resolvingProposalId: string | null = null;
  public answeringClarificationId: string | null = null;
  public runningProposalId: string | null = null;
  public explainingAttemptId: string | null = null;
  public cellDrafts = observable.map<string, ResearchCellDraftState>();
  public turnStream = new AgentTurnStream();
  public documentsLoader = new LoaderModel<ResearchDocumentSummaryV1[]>();
  public archivedDocumentsLoader = new LoaderModel<ResearchDocumentSummaryV1[]>();
  public documentLoader = new LoaderModel<ResearchDocumentV1>();
  public documentMutationLoader = new LoaderModel<ResearchDocumentV1>();
  public backtestDocumentLoader = new LoaderModel<ResearchDocumentV1>();
  public documentManagementLoader = new LoaderModel<{ ok: true }>();
  public documentRunLoader = new LoaderModel<ResearchDocumentRunResultV1>();
  public executionListLoader = new LoaderModel<ResearchExecutionSummaryV1[]>();
  public executionLoader = new LoaderModel<ResearchExecutionV1>();
  public executionPromotionLoader = new LoaderModel<ResearchExecutionSummaryV1>();
  public researchFactorDraftLoader = new LoaderModel<ResearchFactorDraftResultV1>();
  public researchStrategyDraftLoader = new LoaderModel<ResearchStrategyDraftResultV1>();
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
  private documentSwitchGeneration = 0;

  /**
   * 登记研究工作区可观察状态与计算视图。
   *
   * Register observable research workspace state and computed views.
   */
  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      document: observable.ref,
      requestedExecutionId: observable.ref,
      requestedBacktestReportId: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      prompt: observable.ref,
      agentContextCellIds: observable.ref,
      busyCellId: observable.ref,
      affectedRunningCellId: observable.ref,
      documentRunning: observable.ref,
      interrupting: observable.ref,
      runInterrupted: observable.ref,
      resolvingProposalId: observable.ref,
      answeringClarificationId: observable.ref,
      runningProposalId: observable.ref,
      explainingAttemptId: observable.ref,
      setPrompt: action,
      attachAgentContextCell: action,
      detachAgentContextCell: action,
      clearRunInterrupted: action,
      clearRequestedBacktestReport: action,
    });
  }

  /**
   * 配置文档、Cell、对话、提案和整理 Loader，并注册轮询与订阅清理。
   *
   * Initialize document, cell, conversation, proposal and curator loaders with polling and subscription cleanup.
   */
  public setup(params: ResearchSetupParams) {
    super.setup(params);
    runInAction(() => {
      this.requestedExecutionId = params.execution ?? null;
      this.requestedBacktestReportId = params.backtestReport ?? null;
    });
    this.documentsLoader.setup({ request: () => listResearchDocuments('active') });
    this.archivedDocumentsLoader.setup({ request: () => listResearchDocuments('archived') });
    this.documentLoader.setup({ request: (documentId: string) => getResearchDocument(documentId) });
    this.documentMutationLoader.setup({
      preserveResult: false,

      /**
       * 按文档变更种类分派创建、Cell 编辑和输入模式接口。
       *
       * Dispatch document creation, cell edits and input-mode changes through the mutation loader.
       */
      request: (mutation: ResearchDocumentMutation) => {
        switch (mutation.kind) {
          case 'embedded-input-mode':
            return changeEmbeddedInputMode(
              mutation.documentId,
              mutation.inputMode,
              mutation.expectedRevision,
            );
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
    this.backtestDocumentLoader.setup({
      preserveResult: false,
      request: (reportId: string) => createResearchDocumentFromBacktestReport(reportId),
    });
    this.documentManagementLoader.setup({
      preserveResult: false,

      /**
       * 按归档、恢复或删除意图分派文档管理请求。
       *
       * Dispatch archive, restore or delete requests for document management.
       */
      request: (mutation: ResearchDocumentManagementMutation) => {
        switch (mutation.kind) {
          case 'archive':
            return archiveResearchDocument(mutation.documentId);
          case 'restore':
            return restoreResearchDocument(mutation.documentId);
          case 'delete':
            return deleteResearchDocument(mutation.documentId);
        }
      },
    });
    this.documentRunLoader.setup({
      preserveResult: false,
      request: ({ documentId, clean }: { documentId: string; clean: boolean }) =>
        runResearchDocument(documentId, clean),
    });
    this.executionListLoader.setup({
      request: (documentId: string) => listResearchExecutions(documentId),
    });
    this.executionLoader.setup({
      request: (executionId: string) => getResearchExecution(executionId),
    });
    this.executionPromotionLoader.setup({
      preserveResult: false,
      request: ({
        executionId,
        input,
      }: {
        executionId: string;
        input: ResearchExecutionPromotionInputV1;
      }) => promoteResearchExecution(executionId, input),
    });
    this.researchFactorDraftLoader.setup({
      preserveResult: false,
      request: (executionId: string) => createResearchFactorDraft(executionId),
    });
    this.researchStrategyDraftLoader.setup({
      preserveResult: false,
      request: (executionId: string) => createResearchStrategyDraft(executionId),
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

      /**
       * 按应用、待审应用或拒绝动作分派提案接口。
       *
       * Dispatch proposal application, review-first application or rejection.
       */
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
      request: ({ query, assetType, scope }: ResearchDataCatalogQuery, signal) =>
        searchResearchDataCatalog(query, assetType, signal, scope),
    });
    this.curatorLoader.setup({
      request: (runId?: string) =>
        runId ? getResearchCuratorRun(runId) : getLatestResearchCuratorRun(),
    });
    this.curatorMutationLoader.setup({
      preserveResult: false,

      /**
       * 按整理启动或反馈动作分派 Curator 请求。
       *
       * Dispatch curator starts and finding feedback mutations.
       */
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
    this.registCleaner(() => this.archivedDocumentsLoader.cleanup());
    this.registCleaner(() => this.documentLoader.cleanup());
    this.registCleaner(() => this.documentMutationLoader.cleanup());
    this.registCleaner(() => this.backtestDocumentLoader.cleanup());
    this.registCleaner(() => this.documentManagementLoader.cleanup());
    this.registCleaner(() => this.documentRunLoader.cleanup());
    this.registCleaner(() => this.executionListLoader.cleanup());
    this.registCleaner(() => this.executionLoader.cleanup());
    this.registCleaner(() => this.executionPromotionLoader.cleanup());
    this.registCleaner(() => this.researchFactorDraftLoader.cleanup());
    this.registCleaner(() => this.researchStrategyDraftLoader.cleanup());
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
    if (params.document) {
      void this.openDocument(params.document).catch(() => {});
    } else if (params.backtestReport) {
      void this.openBacktestReportDocument(params.backtestReport).catch(() => {});
    }
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

  public get hasPendingClarification(): boolean {
    return this.chatMessages.some((message) =>
      message.parts.some(
        (part) => part.type === 'research_clarification' && part.clarification.status === 'pending',
      ),
    );
  }

  public get agentContextCells() {
    const cellById = new Map(this.document?.cells.map((cell) => [cell.id, cell]) ?? []);
    return this.agentContextCellIds.flatMap((cellId) => {
      const cell = cellById.get(cellId);
      return cell ? [cell] : [];
    });
  }

  public get agentContextDependencyCells() {
    const cells = this.document?.cells ?? [];
    const attachedCellIdSet = new Set(this.agentContextCellIds);
    const dependencyCellIds = researchUpstreamDependencyCellIds(cells, this.agentContextCellIds);
    const cellById = new Map(cells.map((cell) => [cell.id, cell]));
    return dependencyCellIds.flatMap((cellId) => {
      const cell = cellById.get(cellId);
      return cell && !attachedCellIdSet.has(cellId) ? [cell] : [];
    });
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

  public attachAgentContextCell(cellId: string) {
    if (
      this.agentContextCellIds.includes(cellId) ||
      this.agentContextCellIds.length >= MAX_RESEARCH_AGENT_CONTEXT_CELLS ||
      !this.document?.cells.some((cell) => cell.id === cellId)
    ) {
      return;
    }
    this.agentContextCellIds = [...this.agentContextCellIds, cellId];
  }

  public detachAgentContextCell(cellId: string) {
    this.agentContextCellIds = this.agentContextCellIds.filter((candidate) => candidate !== cellId);
  }

  public clearRunInterrupted() {
    this.runInterrupted = false;
  }

  public clearRequestedBacktestReport() {
    this.requestedBacktestReportId = null;
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
    this.documentSwitchGeneration += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.document = null;
      this.cellDrafts.clear();
      this.chatMessages = [];
      this.sending = false;
      this.prompt = '';
      this.agentContextCellIds = [];
      this.runInterrupted = false;
    });
  }

  /**
   * 创建研究文档后提交初始问题，保留导航与会话身份。
   *
   * Create a research document and submit its initial question with navigation and conversation identity.
   */
  public async createDocumentFromPrompt(message: string) {
    const text = message.trim();
    if (!text || this.documentMutationLoader.loading || this.sending) {
      return;
    }
    let document: ResearchDocumentV1;
    try {
      document = await this.documentMutationLoader.run({ kind: 'create', template: 'blank' });
    } catch {
      return;
    }
    this.documentSwitchGeneration += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.document = document;
      this.cellDrafts.clear();
      this.reconcileCellDrafts(document);
      this.chatMessages = [
        ...document.messages.map(normalizeChatMessage),
        textMessage('user', text),
      ];
      this.sending = true;
      this.prompt = '';
      this.agentContextCellIds = [];
      this.runInterrupted = false;
      this.explainingAttemptId = null;
    });
    void this.executionListLoader.run(document.id).catch(() => {});
    void this.documentsLoader.run();
    await this.runAgentTurn(text, document.conversationId);
  }

  /**
   * 从选定模板创建文档并切换到其工作区。
   *
   * Create a document from a selected template and open its workspace.
   */
  public async createDocumentFromTemplate(template: ResearchDocumentTemplateV1) {
    if (this.documentMutationLoader.loading || this.sending) {
      return;
    }
    let document: ResearchDocumentV1;
    try {
      document = await this.documentMutationLoader.run({ kind: 'create', template });
    } catch {
      return;
    }
    this.documentSwitchGeneration += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.document = document;
      this.cellDrafts.clear();
      this.reconcileCellDrafts(document);
      this.chatMessages = document.messages.map(normalizeChatMessage);
      this.sending = false;
      this.prompt = '';
      this.agentContextCellIds = [];
      this.runInterrupted = false;
      this.explainingAttemptId = null;
    });
    void this.executionListLoader.run(document.id).catch(() => {});
    void this.documentsLoader.run();
  }

  private async openBacktestReportDocument(reportId: string) {
    const document = await this.backtestDocumentLoader.run(reportId);
    this.documentSwitchGeneration += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.document = document;
      this.cellDrafts.clear();
      this.reconcileCellDrafts(document);
      this.chatMessages = document.messages.map(normalizeChatMessage);
      this.sending = false;
      this.prompt = '';
      this.agentContextCellIds = [];
      this.runInterrupted = false;
    });
    void this.executionListLoader.run(document.id).catch(() => {});
    void this.documentsLoader.run();
  }

  /**
   * 切换文档前保存草稿并清理旧订阅，随后恢复目标文档和运行状态。
   *
   * Save drafts and detach old subscriptions before restoring the selected document and runs.
   */
  public async openDocument(id: string) {
    if (id === this.documentId || !(await this.flushAllCellDrafts())) {
      return;
    }
    const switchGeneration = ++this.documentSwitchGeneration;
    const document = await this.documentLoader.run(id);
    const runningTurnId = await this.turnStream.findRunning(`research:${document.conversationId}`);
    if (switchGeneration !== this.documentSwitchGeneration) {
      return;
    }
    this.turnStream.detach();
    runInAction(() => {
      this.runInterrupted = false;
      this.cellDrafts.clear();
      this.document = document;
      this.reconcileCellDrafts(document);
      this.chatMessages = document.messages.map(normalizeChatMessage);
      this.agentContextCellIds = [];
    });
    if (runningTurnId) {
      void this.turnStream.attach(runningTurnId, this.turnHandlers());
    }
    void this.executionListLoader.run(id).catch(() => {});
  }

  public flushCellDraft(cellId: string): Promise<boolean> {
    return this.flushCellDrafts([cellId]);
  }

  public flushPendingChanges(): Promise<boolean> {
    return this.flushAllCellDrafts();
  }

  /**
   * 提交嵌入式输入模式修订并刷新当前文档。
   *
   * Submit an embedded input-mode revision and refresh the document.
   */
  public async changeEmbeddedInputMode(inputMode: 'retained' | 'current') {
    if (
      !this.document?.embeddedSource ||
      this.hasActiveRun ||
      this.hasOpenCellChangeReview ||
      this.documentMutationLoader.loading ||
      !(await this.flushAllCellDrafts())
    ) {
      return;
    }
    const documentId = this.documentId;
    try {
      const document = await this.documentMutationLoader.run({
        kind: 'embedded-input-mode',
        documentId,
        inputMode,
        expectedRevision: this.document.contentRevision,
      });
      if (this.documentId === documentId) {
        this.acceptDocument(document, false);
      }
    } catch {
      /* The workspace displays the mutation error. */
    }
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

  /**
   * 先保存草稿再执行整文档，协调活动运行与结果刷新。
   *
   * Flush drafts before running the document and refresh execution state.
   */
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
      await this.executionListLoader.run(this.documentId);
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
      await this.executionListLoader.run(this.documentId);
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

  public searchDataCatalog(
    query: string,
    assetType?: ResearchAssetTypeV1,
    scope: ResearchDataCatalogScopeV1 = 'instruments',
  ) {
    return this.dataCatalogLoader.run({ query, assetType, scope });
  }

  public loadExecutionHistory() {
    return this.documentId ? this.executionListLoader.run(this.documentId) : Promise.resolve([]);
  }

  public viewResearchExecution(executionId: string) {
    return this.executionLoader.run(executionId);
  }

  /**
   * 提升当前执行证据并刷新可交接状态。
   *
   * Promote execution evidence and refresh handoff eligibility.
   */
  public async promoteExecution(executionId: string, input: ResearchExecutionPromotionInputV1) {
    const result = await this.executionPromotionLoader.run({ executionId, input });
    if (this.documentId) {
      await this.executionListLoader.run(this.documentId);
    }
    if (this.executionLoader.result?.id === executionId) {
      await this.executionLoader.run(executionId);
    }
    return result;
  }

  public createFactorDraft(executionId: string) {
    return this.researchFactorDraftLoader.run(executionId);
  }

  public createStrategyDraft(executionId: string) {
    return this.researchStrategyDraftLoader.run(executionId);
  }

  /**
   * 先保存 Cell 草稿，再冻结当前上下文提交 Agent 消息，阻止审阅或澄清冲突。
   *
   * Flush cell drafts before submitting captured agent context and guard against review or clarification conflicts.
   */
  public async send(message: string, attemptId?: string) {
    const text = message.trim();
    if (
      !text ||
      this.sending ||
      this.resolvingProposalId ||
      this.hasPendingClarification ||
      !this.conversationId
    ) {
      return;
    }
    if (!(await this.flushAllCellDrafts())) {
      return;
    }
    const conversationId = this.conversationId;
    const contextCells = attemptId ? [] : this.agentContextCells;
    const dependencyCells = attemptId ? [] : this.agentContextDependencyCells;
    const contextCellIds = contextCells.map((cell) => cell.id);
    const userParts: MessagePart[] = [
      ...(contextCells.length > 0
        ? [
            {
              type: 'research_cell_context' as const,
              snapshotVersion: 1 as const,
              cells: [
                ...contextCells.map((cell) => researchContextCellSnapshot(cell, 'attached')),
                ...dependencyCells.map((cell) => researchContextCellSnapshot(cell, 'dependency')),
              ],
            },
          ]
        : []),
      { type: 'text', text },
    ];
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, { role: 'user', parts: userParts }];
      this.sending = true;
      this.explainingAttemptId = attemptId ?? null;
      this.prompt = '';
      if (!attemptId) {
        this.agentContextCellIds = [];
      }
    });
    await this.runAgentTurn(text, conversationId, attemptId, contextCellIds);
  }

  /**
   * 保存澄清选择并恢复研究对话，保留确认的数据引用。
   *
   * Persist clarification selections and resume the conversation with confirmed references.
   */
  public async answerClarification(
    clarification: ResearchClarificationV1,
    selections: ResearchClarificationSelectionV1[],
  ) {
    if (
      clarification.status !== 'pending' ||
      this.sending ||
      this.answeringClarificationId ||
      !this.conversationId
    ) {
      return;
    }
    if (!(await this.flushAllCellDrafts())) {
      return;
    }

    const previousMessages = this.chatMessages;
    const answeredAt = new Date().toISOString();
    const answeredClarification: ResearchClarificationV1 = {
      ...clarification,
      status: 'answered',
      answer: { selections, answeredAt },
    };
    const answerLabel = clarificationAnswerLabel(answeredClarification);
    runInAction(() => {
      this.chatMessages = [
        ...replaceResearchClarification(this.chatMessages, clarification.id, answeredClarification),
        textMessage(
          'user',
          i18n.t('research:workbench.clarification.answerMessage', { answerLabel }),
        ),
      ];
      this.sending = true;
      this.answeringClarificationId = clarification.id;
    });
    try {
      const started = await answerResearchClarification(
        this.conversationId,
        clarification.id,
        selections,
      );
      await this.turnStream.attach(started.turnId, this.turnHandlers());
    } catch (error) {
      runInAction(() => {
        this.chatMessages = [
          ...previousMessages,
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
        this.answeringClarificationId = null;
      });
      void this.documentsLoader.run();
    }
  }

  /**
   * 创建研究后台轮次并连接增量事件流。
   *
   * Start a background research turn and attach its incremental event stream.
   */
  private async runAgentTurn(
    text: string,
    conversationId: string,
    attemptId?: string,
    contextCellIds: string[] = [],
  ) {
    try {
      const started = await sendResearchAgent(text, conversationId, attemptId, contextCellIds);
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
      await renameResearchDocument(this.conversationId, trimmed);
      void this.documentsLoader.run();
    } catch {
      runInAction(() => {
        this.document = previous;
      });
    }
  }

  public loadArchivedDocuments() {
    if (!this.archivedDocumentsLoader.loading) {
      void this.archivedDocumentsLoader.run();
    }
  }

  /**
   * 归档前处理草稿与选择，完成后刷新文档列表。
   *
   * Reconcile drafts and selection before archiving and refreshing documents.
   */
  public async archiveDocument(documentId: string): Promise<boolean> {
    const isCurrentDocument = this.documentId === documentId;
    if (
      this.documentManagementLoader.loading ||
      (isCurrentDocument && (this.hasActiveRun || this.sending)) ||
      (isCurrentDocument && !(await this.flushAllCellDrafts()))
    ) {
      return false;
    }
    await this.documentManagementLoader.run({ kind: 'archive', documentId });
    if (isCurrentDocument) {
      this.clearCurrentDocument();
    }
    await Promise.all([this.documentsLoader.run(), this.archivedDocumentsLoader.run()]);
    return true;
  }

  public async restoreDocument(documentId: string) {
    await this.documentManagementLoader.run({ kind: 'restore', documentId });
    await Promise.all([this.documentsLoader.run(), this.archivedDocumentsLoader.run()]);
  }

  public async permanentlyDeleteDocument(documentId: string) {
    await this.documentManagementLoader.run({ kind: 'delete', documentId });
    await this.archivedDocumentsLoader.run();
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

  private clearCurrentDocument() {
    this.documentSwitchGeneration += 1;
    this.turnStream.detach();
    runInAction(() => {
      this.document = null;
      this.cellDrafts.clear();
      this.chatMessages = [];
      this.sending = false;
      this.prompt = '';
      this.agentContextCellIds = [];
      this.runInterrupted = false;
    });
  }

  private acceptDocument(
    document: ResearchDocumentV1,
    replaceMessages = true,
    savedCell?: { cellId: string; source: string },
  ) {
    runInAction(() => {
      this.document = document;
      this.reconcileCellDrafts(document, savedCell);
      const serverCellIds = new Set(document.cells.map((cell) => cell.id));
      this.agentContextCellIds = this.agentContextCellIds.filter((cellId) =>
        serverCellIds.has(cellId),
      );
      if (replaceMessages) {
        this.chatMessages = document.messages.map(normalizeChatMessage);
      }
    });
  }

  /**
   * 应用或拒绝提案后刷新文档与消息，保持审阅入口同步。
   *
   * Resolve a proposal and refresh document and messages consistently.
   */
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

  /**
   * 接受或撤销已应用修改后刷新 Cell 与依赖状态。
   *
   * Accept or revert applied edits and refresh cells and dependency state.
   */
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

  /**
   * 将服务端 Cell 修订与本地草稿协调，保留未保存编辑及冲突。
   *
   * Reconcile server cell revisions with local drafts while preserving edits and conflicts.
   */
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

  /**
   * 按草稿版本提交 Cell 修改，仅在请求仍对应当前草稿时确认保存。
   *
   * Save a cell draft and acknowledge it only if the draft version still matches.
   */
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

  /**
   * 按文档顺序刷新待保存 Cell，供运行或对话前建立稳定输入。
   *
   * Flush pending cell saves to establish stable input before execution or conversation.
   */
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

  /**
   * 处理研究轮次增量和终态，并刷新对应文档、提案及消息。
   *
   * Handle research turn events and refresh associated documents, proposals and messages.
   */
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

  private async loadCurator() {
    const run = await this.curatorLoader.run();
    if (run && isCuratorActive(run)) {
      this.curatorPoller.start();
    }
  }

  /**
   * 轮询整理任务并在完成时读取发现，停止无效或终态轮询。
   *
   * Poll curation and load completed findings while stopping terminal or invalid polling.
   */
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

function replaceResearchClarification(
  messages: ChatMessage[],
  clarificationId: string,
  clarification: ResearchClarificationV1,
): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === 'research_clarification' && part.clarification.id === clarificationId
        ? { type: 'research_clarification' as const, clarification }
        : part,
    ),
  }));
}

function researchContextCellSnapshot(cell: ResearchCellV1, role: ResearchCellContextRoleV1) {
  return {
    cellId: cell.id,
    position: cell.position,
    kind: cell.kind,
    revision: cell.revision,
    role,
    source: cell.source,
  };
}

function clarificationAnswerLabel(clarification: ResearchClarificationV1): string {
  const useChinese = i18n.resolvedLanguage?.startsWith('zh') ?? true;
  return (
    clarification.answer?.selections
      .flatMap((selection) => {
        const question = clarification.questions.find(
          (candidate) => candidate.id === selection.questionId,
        );
        const labels = selection.selectedOptionIds.flatMap((optionId) => {
          const option = question?.options.find((candidate) => candidate.id === optionId);
          return option ? [useChinese ? option.labelZh : option.labelEn] : [];
        });
        return selection.customText ? [...labels, selection.customText] : labels;
      })
      .join(useChinese ? '；' : '; ') ?? ''
  );
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
  }
}
