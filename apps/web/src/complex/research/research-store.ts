import { action, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type ResearchConversationMeta,
} from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import {
  deleteResearchConversation,
  getAgentConversationMessages,
  listResearchConversations,
  renameResearchConversation,
  sendResearchAgent,
} from '@src/api/client';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import i18n from '@src/i18n';

type ResearchSetupParams = {};

/** Conversation state for the natural-language research workbench. A result part is already a
 * complete, immutable ResearchRun — reopening a conversation never asks the LLM to reconstruct it. */
export class ResearchStore extends BaseStore<ResearchSetupParams> {
  public conversationId: string | null = null;
  public conversationTitle = '';
  public chatMessages: ChatMessage[] = [];
  public sending = false;
  public prompt = '';
  public turnStream = new AgentTurnStream();
  public conversationsLoader = new LoaderModel<ResearchConversationMeta[]>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      conversationId: observable.ref,
      conversationTitle: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      prompt: observable.ref,
      setPrompt: action,
    });
  }

  public setup(params: ResearchSetupParams) {
    super.setup(params);
    this.conversationsLoader.setup({ request: () => listResearchConversations() });
    this.registCleaner(() => this.conversationsLoader.cleanup());
    this.registCleaner(() => this.turnStream.detach());
    void this.conversationsLoader.run();
  }

  public setPrompt(value: string) {
    this.prompt = value;
  }

  public newChat() {
    this.turnStream.detach();
    runInAction(() => {
      this.conversationId = null;
      this.conversationTitle = '';
      this.chatMessages = [];
      this.sending = false;
      this.prompt = '';
    });
  }

  public async openConversation(id: string) {
    this.turnStream.detach();
    const meta = this.conversationsLoader.result?.find((item) => item.id === id);
    const detail = await getAgentConversationMessages(id);
    runInAction(() => {
      this.conversationId = id;
      this.conversationTitle = meta?.title ?? '';
      this.chatMessages = detail.messages.map(normalizeChatMessage);
      this.sending = false;
      this.prompt = '';
    });
    void this.reattachTurn();
  }

  public async send(message: string) {
    const text = message.trim();
    if (!text || this.sending) {
      return;
    }
    runInAction(() => {
      this.chatMessages = [...this.chatMessages, textMessage('user', text)];
      this.sending = true;
      this.prompt = '';
      if (!this.conversationTitle) {
        this.conversationTitle = text.slice(0, 60);
      }
    });
    try {
      const started = await sendResearchAgent(text, this.conversationId ?? undefined);
      runInAction(() => {
        this.conversationId = started.conversationId;
      });
      void this.conversationsLoader.run();
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
      void this.conversationsLoader.run();
    }
  }

  public async renameConversation(title: string) {
    const trimmed = title.trim();
    if (!trimmed || !this.conversationId) {
      return;
    }
    const previous = this.conversationTitle;
    runInAction(() => {
      this.conversationTitle = trimmed;
    });
    try {
      await renameResearchConversation(this.conversationId, trimmed);
      void this.conversationsLoader.run();
    } catch {
      runInAction(() => {
        this.conversationTitle = previous;
      });
    }
  }

  public removeConversation(id: string) {
    void deleteResearchConversation(id).then(() => this.conversationsLoader.run());
    if (this.conversationId === id) {
      this.newChat();
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
}
