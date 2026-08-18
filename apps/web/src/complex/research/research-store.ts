import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type ResearchCellKindV1,
  type ResearchCuratorDispositionV1,
  type ResearchCuratorFindingV1,
  type ResearchCuratorRunV1,
  type ResearchCuratorVerificationAssessmentV1,
  type ResearchDocumentRunResultV1,
  type ResearchDocumentSummaryV1,
  type ResearchDocumentTemplateV1,
  type ResearchDocumentV1,
} from '@jixie/shared';
import { BaseStore, LoaderModel, PollingModel } from '@src/lib';
import {
  addResearchCell,
  createResearchDocument,
  deleteResearchCell,
  deleteResearchConversation,
  getLatestResearchCuratorRun,
  getResearchCuratorRun,
  getResearchDocument,
  listResearchDocuments,
  renameResearchConversation,
  resetResearchDocument,
  runResearchCell,
  runResearchDocument,
  sendResearchAgent,
  startResearchCurator,
  updateResearchCell,
  updateResearchCuratorFinding,
} from '@src/api/client';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import i18n from '@src/i18n';

type ResearchSetupParams = {};

type ResearchDocumentMutation =
  | { kind: 'create'; template: ResearchDocumentTemplateV1 }
  | { kind: 'add'; documentId: string; cellKind: ResearchCellKindV1; source?: string }
  | { kind: 'update'; cellId: string; source: string }
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

const CURATOR_POLL_INTERVAL_MS = 1_000;

/** Domain state for the reactive research document and its attached Agent conversation. */
export class ResearchStore extends BaseStore<ResearchSetupParams> {
  public document: ResearchDocumentV1 | null = null;
  public chatMessages: ChatMessage[] = [];
  public sending = false;
  public prompt = '';
  public busyCellId: string | null = null;
  public documentRunning = false;
  public turnStream = new AgentTurnStream();
  public documentsLoader = new LoaderModel<ResearchDocumentSummaryV1[]>();
  public documentLoader = new LoaderModel<ResearchDocumentV1>();
  public documentMutationLoader = new LoaderModel<ResearchDocumentV1>();
  public documentRunLoader = new LoaderModel<ResearchDocumentRunResultV1>();
  public curatorLoader = new LoaderModel<ResearchCuratorRunV1 | null>();
  public curatorMutationLoader = new LoaderModel<ResearchCuratorRunV1 | ResearchCuratorFindingV1>();
  public curatorPoller = new PollingModel();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      document: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      prompt: observable.ref,
      busyCellId: observable.ref,
      documentRunning: observable.ref,
      setPrompt: action,
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
            return updateResearchCell(mutation.cellId, { source: mutation.source });
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
    this.registCleaner(() => this.curatorLoader.cleanup());
    this.registCleaner(() => this.curatorMutationLoader.cleanup());
    this.registCleaner(() => this.curatorPoller.cleanup());
    this.registCleaner(() => this.turnStream.detach());
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

  public setPrompt(value: string) {
    this.prompt = value;
  }

  public newDocument() {
    this.turnStream.detach();
    runInAction(() => {
      this.document = null;
      this.chatMessages = [];
      this.sending = false;
      this.prompt = '';
    });
  }

  public async createDocument(template: ResearchDocumentTemplateV1) {
    const document = await this.documentMutationLoader.run({ kind: 'create', template });
    this.acceptDocument(document);
    void this.documentsLoader.run();
  }

  public async openDocument(id: string) {
    this.turnStream.detach();
    const document = await this.documentLoader.run(id);
    this.acceptDocument(document);
    void this.reattachTurn();
  }

  public async updateCell(cellId: string, source: string) {
    const current = this.document?.cells.find((cell) => cell.id === cellId);
    if (!current || source === current.source) {
      return;
    }
    const document = await this.documentMutationLoader.run({ kind: 'update', cellId, source });
    this.acceptDocument(document, false);
    void this.documentsLoader.run();
  }

  public async addCell(kind: ResearchCellKindV1) {
    if (!this.documentId) {
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
    const document = await this.documentMutationLoader.run({ kind: 'delete', cellId });
    this.acceptDocument(document, false);
    void this.documentsLoader.run();
  }

  public async runCell(cellId: string, source?: string) {
    if (source !== undefined) {
      await this.updateCell(cellId, source);
    }
    runInAction(() => {
      this.busyCellId = cellId;
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

  public async runAll(clean = true) {
    if (!this.documentId || this.documentRunning) {
      return;
    }
    runInAction(() => {
      this.documentRunning = true;
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

  public async resetRuntime() {
    if (!this.documentId) {
      return;
    }
    const document = await this.documentMutationLoader.run({
      kind: 'reset',
      documentId: this.documentId,
    });
    this.acceptDocument(document, false);
  }

  public async send(message: string) {
    const text = message.trim();
    if (!text || this.sending || !this.conversationId) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.prompt = '';
    });
    try {
      const started = await sendResearchAgent(text, this.conversationId);
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

  public removeConversation(id: string) {
    void deleteResearchConversation(id).then(() => this.documentsLoader.run());
    if (this.documentId === id) {
      this.newDocument();
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

  private acceptDocument(document: ResearchDocumentV1, replaceMessages = true) {
    runInAction(() => {
      this.document = document;
      if (replaceMessages) {
        this.chatMessages = document.messages.map(normalizeChatMessage);
      }
    });
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
