import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import {
  normalizeChatMessage,
  textMessage,
  type ChatMessage,
  type ScreenConversationMeta,
  type ScreenResult,
  type ScreenSpec,
  type SavedMeta,
} from '@jixie/shared';
import { BaseStore, LoaderModel } from '@src/lib';
import {
  createScreenConversation,
  deleteScreen,
  deleteScreenConversation,
  getScreen,
  getScreenConversation,
  listScreenConversations,
  listScreens,
  runScreen,
  saveScreen,
  sendScreenAgent,
  updateScreenConversation,
} from '@src/api/client';
import { QueryCardResults } from '@src/components/query-card-model';
import { AgentTurnStream, type AgentTurnHandlers } from '@src/components/agent-turn-stream';
import i18n from '@src/i18n';

type ScreenSetupParams = {};

/** Example specs — clickable chips on the wall. They run runScreen directly (no LLM), so the wall is
 * usable without a DEEPSEEK_API_KEY; the agent conversation is the AI path on top. */
export const EXAMPLE_SCREENS: { labelKey: string; spec: ScreenSpec }[] = [
  {
    labelKey: 'lowPeHighDividend',
    spec: {
      filters: [
        { field: 'peTtm', op: '<', value: 15 },
        { field: 'dvRatio', op: '>', value: 3 },
      ],
      sort: { field: 'totalMv', dir: 'desc' },
      limit: 50,
    },
  },
  {
    labelKey: 'smallCap',
    spec: {
      filters: [{ field: 'totalMv', op: '>', value: 0 }],
      sort: { field: 'totalMv', dir: 'asc' },
      limit: 50,
    },
  },
  {
    labelKey: 'highTurnover',
    spec: { filters: [], sort: { field: 'turnoverRate', dir: 'desc' }, limit: 50 },
  },
  {
    labelKey: 'belowNav',
    spec: {
      filters: [{ field: 'pb', op: '<', value: 1 }],
      sort: { field: 'pb', dir: 'asc' },
      limit: 50,
    },
  },
];

/**
 * Stock-screener card wall store (docs/design/unified-agent.md design 4). One wall, two card kinds:
 *  - query cards (SavedScreen): click → the query view (editable chips + fresh result table);
 *  - session cards (ScreenConversation): click → the chat view (continue the conversation).
 * The conversation is created lazily on its first turn (title = the message, truncated) and its
 * messages save after every turn; saved query cards are deliberately independent of conversations.
 */
export class ScreenStore extends BaseStore<ScreenSetupParams> {
  public view: 'wall' | 'query' | 'chat' = 'wall';

  // — query view (an opened query card, or an example/unsaved spec) —
  public spec: ScreenSpec | null = null;
  public result: ScreenResult | null = null;
  public queryName = ''; // the opened card's name ('' = unsaved exploration)

  // — chat view —
  public conversationId: string | null = null; // null = a new, not-yet-created conversation
  public conversationTitle = '';
  public chatMessages: ChatMessage[] = [];
  public sending = false;
  public nlText = '';
  public cardResults = new QueryCardResults(); // fresh results for the conversation's query cards
  public turnStream = new AgentTurnStream(); // the in-flight turn's SSE mirror (pending bubble)

  public runLoader = new LoaderModel<ScreenResult>(); // the query view's deterministic run
  public savedLoader = new LoaderModel<SavedMeta[]>(); // wall: query cards
  public conversationsLoader = new LoaderModel<ScreenConversationMeta[]>(); // wall: session cards

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      view: observable.ref,
      spec: observable.ref,
      result: observable.ref,
      queryName: observable.ref,
      conversationId: observable.ref,
      conversationTitle: observable.ref,
      chatMessages: observable.ref,
      sending: observable.ref,
      nlText: observable.ref,
      busy: computed,
      setNlText: action,
    });
  }

  public setup(params: ScreenSetupParams) {
    super.setup(params);
    this.runLoader.setup({ request: () => runScreen(this.spec!) });
    this.savedLoader.setup({ request: () => listScreens() });
    this.conversationsLoader.setup({ request: () => listScreenConversations() });
    this.registCleaner(() => this.runLoader.cleanup());
    this.registCleaner(() => this.savedLoader.cleanup());
    this.registCleaner(() => this.conversationsLoader.cleanup());
    this.registCleaner(() => this.turnStream.detach()); // drop the SSE subscription; the turn keeps running
    void this.savedLoader.run();
    void this.conversationsLoader.run();
  }

  public get busy(): boolean {
    return this.runLoader.loading;
  }

  public setNlText(v: string) {
    runInAction(() => {
      this.nlText = v;
    });
  }

  /** Back to the wall (refresh both card lists — a chat may have pinned new query cards). */
  public showWall() {
    runInAction(() => {
      this.view = 'wall';
    });
    void this.savedLoader.run();
    void this.conversationsLoader.run();
  }

  // —— query view ——

  /** Open an example / unsaved spec in the query view and run it. */
  public openSpec(spec: ScreenSpec, name = '') {
    runInAction(() => {
      this.view = 'query';
      this.queryName = name;
    });
    return this.applySpec(spec);
  }

  /** Open a saved query card: fetch its spec, then run it. */
  public async openSaved(id: string) {
    const s = await getScreen(id);
    await this.openSpec(s.spec, s.name);
  }

  /** Set the editable spec and re-run the deterministic query (chip edits + open). */
  public async applySpec(spec: ScreenSpec) {
    runInAction(() => {
      this.spec = spec;
    });
    const r = await this.runLoader.run();
    runInAction(() => {
      this.result = r;
    });
  }

  /** Save the query view's current spec under a name (upsert by name), then refresh the wall. */
  public async saveCurrent(name: string) {
    if (!this.spec) {
      return;
    }
    await saveScreen(name, this.spec);
    runInAction(() => {
      this.queryName = name;
    });
    void this.savedLoader.run();
  }

  /** Delete a saved query card, then refresh the wall. */
  public removeSaved(id: string) {
    void deleteScreen(id).then(() => this.savedLoader.run());
  }

  // —— chat view ——

  /** Start a brand-new conversation (created lazily on the first message). */
  public newChat() {
    runInAction(() => {
      this.view = 'chat';
      this.conversationId = null;
      this.conversationTitle = '';
      this.chatMessages = [];
      this.nlText = '';
    });
  }

  /** Reopen a session card: load its messages (upgrading any legacy rows) and continue chatting.
   * A live turn for it (page refresh mid-reply) re-subscribes — the snapshot replays what we missed. */
  public async openConversation(id: string) {
    const detail = await getScreenConversation(id);
    runInAction(() => {
      this.view = 'chat';
      this.conversationId = detail.id;
      this.conversationTitle = detail.title;
      this.chatMessages = detail.messages.map(normalizeChatMessage);
      this.nlText = '';
    });
    void this.reattachTurn();
  }

  /** One agent turn — streamed. The first turn creates the conversation row (title = the message,
   * truncated); the server persists the user message + reply onto it. */
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
    await this.ensureConversation(text);
    if (!this.conversationId) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('screen:error.withDetail', {
              detail: i18n.t('screen:error.conversationCreateFailed'),
            }),
          ),
        ];
        this.sending = false;
      });
      return;
    }
    try {
      const { turnId } = await sendScreenAgent(this.conversationId, text);
      await this.turnStream.attach(turnId, this.turnHandlers()); // resolves after the terminal event
    } catch (e) {
      runInAction(() => {
        this.chatMessages = [
          ...this.chatMessages,
          textMessage(
            'assistant',
            i18n.t('screen:error.withDetail', {
              detail: e instanceof Error ? e.message : i18n.t('screen:error.requestFailed'),
            }),
          ),
        ];
      });
    } finally {
      runInAction(() => {
        this.sending = false;
      });
      void this.conversationsLoader.run(); // the wall card's preview/updatedAt moved
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
        });
      },
      onError: (message) => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('screen:error.withDetail', { detail: message })),
          ];
        });
      },
      onCancelled: () => {
        runInAction(() => {
          this.chatMessages = [
            ...this.chatMessages,
            textMessage('assistant', i18n.t('screen:error.cancelled')),
          ];
        });
      },
    };
  }

  /** Refresh reattach: if this conversation has a live turn, subscribe (snapshot replays). */
  private async reattachTurn() {
    if (!this.conversationId) {
      return;
    }
    runInAction(() => (this.sending = true));
    await this.turnStream.attachRunning(`screen:${this.conversationId}`, this.turnHandlers());
    runInAction(() => (this.sending = false)); // resolved at the terminal event (or no live turn)
  }

  /** Rename the open conversation (inline edit on the chat header). */
  public async renameConversation(title: string) {
    const trimmed = title.trim();
    if (!trimmed || !this.conversationId) {
      return;
    }
    runInAction(() => {
      this.conversationTitle = trimmed;
    });
    try {
      await updateScreenConversation(this.conversationId, { title: trimmed });
      void this.conversationsLoader.run();
    } catch {
      /* best-effort */
    }
  }

  /** Delete a session card. Saved query cards are independent — deleting a conversation never touches
   * them. Only clears the chat state (no view change — deletion happens from the wall). */
  public removeConversation(id: string) {
    void deleteScreenConversation(id).then(() => this.conversationsLoader.run());
    if (this.conversationId === id) {
      runInAction(() => {
        this.conversationId = null;
        this.conversationTitle = '';
        this.chatMessages = [];
      });
    }
  }

  /** Create the conversation row on the first message so the chat has a home. Best-effort. The
   * create payload carries no messages — the turn runner appends the user message server-side. */
  private async ensureConversation(firstMessage: string) {
    if (this.conversationId) {
      return;
    }
    const title = firstMessage.slice(0, 24);
    try {
      const meta = await createScreenConversation(title, []);
      runInAction(() => {
        this.conversationId = meta.id;
        this.conversationTitle = meta.title;
      });
      void this.conversationsLoader.run();
    } catch {
      /* best-effort — sendAgent surfaces the failure */
    }
  }
}
