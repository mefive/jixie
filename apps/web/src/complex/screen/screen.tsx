import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatMarketCapWan } from '@src/i18n/format';
import classNames from 'classnames';
import { Button, Input, Popconfirm, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ChatMessage, ScreenConversationMeta, ScreenRow, SavedMeta } from '@jixie/shared';
import {
  faArrowDown,
  faComments,
  faFilter,
  faPaperPlane,
  faPen,
  faPlus,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { MessageParts } from '@src/components/message-parts';
import type { QueryCardResults } from '@src/components/query-card-model';
import { ToolTrace } from '@src/components/tool-trace';
import { AgentPending } from '@src/components/agent-pending';
import { AgentTrace } from '@src/components/agent-trace';
import type { AgentTurnStream } from '@src/components/agent-turn-stream';
import type { AgentToolTraceItem } from '@src/api/client';
import { complex } from './complex';
import { ConditionChips } from './condition-chips';
import './screen.css';

/** ChatGPT-style screener with persistent history and a centered conversation workspace. */
export const Screen = complex.component(() => {
  const store = complex.useStore();

  return (
    <main className="jx-screen">
      <ScreenSidebar />
      <section className="jx-screen-workspace">
        {store.view === 'query' ? <QueryView /> : <ChatView />}
      </section>
    </main>
  );
}, 'Screen');

// —— Subcomponents ——

const ScreenSidebar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  const queries = store.savedLoader.result ?? [];
  const conversations = store.conversationsLoader.result ?? [];

  return (
    <aside className="jx-screen-sidebar">
      <div className="jx-screen-sidebarHead">
        <h1 className="jx-screen-sidebarTitle">{t('title')}</h1>
        <Button
          className="jx-screen-newChat"
          icon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => store.newChat()}
        >
          {t('newChat')}
        </Button>
      </div>

      <div className="jx-screen-sidebarScroll">
        <section className="jx-screen-sidebarSection">
          <h2 className="jx-screen-sidebarLabel">{t('sidebar.history')}</h2>
          {!store.conversationsLoader.loading && conversations.length === 0 && (
            <p className="jx-screen-sidebarEmpty">{t('sidebar.emptyHistory')}</p>
          )}
          {conversations.map((conversation) => (
            <ConversationItem key={conversation.id} meta={conversation} />
          ))}
        </section>

        <section className="jx-screen-sidebarSection">
          <h2 className="jx-screen-sidebarLabel">{t('sidebar.savedQueries')}</h2>
          {!store.savedLoader.loading && queries.length === 0 && (
            <p className="jx-screen-sidebarEmpty">{t('sidebar.emptySaved')}</p>
          )}
          {queries.map((query) => (
            <SavedQueryItem key={query.id} meta={query} />
          ))}
        </section>
      </div>
    </aside>
  );
}, 'ScreenSidebar');

const ConversationItem = complex.component(({ meta }: { meta: ScreenConversationMeta }) => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');

  return (
    <div
      className={classNames('jx-screen-historyItem', {
        'jx-screen-historyItem--active': store.view === 'chat' && store.conversationId === meta.id,
      })}
      onClick={() => void store.openConversation(meta.id)}
    >
      <FontAwesomeIcon className="jx-screen-historyIcon" icon={faComments} />
      <div className="jx-screen-historyText">
        <div className="jx-screen-historyTitle">{meta.title}</div>
        {meta.preview && <div className="jx-screen-historyPreview">{meta.preview}</div>}
      </div>
      <Popconfirm
        title={t('card.deleteChat')}
        onConfirm={() => store.removeConversation(meta.id)}
        onPopupClick={(event) => event.stopPropagation()}
      >
        <button className="jx-screen-historyDelete" onClick={(event) => event.stopPropagation()}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </Popconfirm>
    </div>
  );
}, 'ConversationItem');

const SavedQueryItem = complex.component(({ meta }: { meta: SavedMeta }) => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');

  return (
    <div className="jx-screen-historyItem" onClick={() => void store.openSaved(meta.id)}>
      <FontAwesomeIcon className="jx-screen-historyIcon" icon={faFilter} />
      <div className="jx-screen-historyText">
        <div className="jx-screen-historyTitle">{meta.name}</div>
        <div className="jx-screen-historyPreview">{formatDay(meta.updatedAt)}</div>
      </div>
      <Popconfirm
        title={t('card.deleteQuery')}
        onConfirm={() => store.removeSaved(meta.id)}
        onPopupClick={(event) => event.stopPropagation()}
      >
        <button className="jx-screen-historyDelete" onClick={(event) => event.stopPropagation()}>
          <FontAwesomeIcon icon={faTrash} />
        </button>
      </Popconfirm>
    </div>
  );
}, 'SavedQueryItem');

// Query view: an opened (or example) spec — editable chips + fresh result table + save-to-wall.
const QueryView = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  const [name, setName] = useState(store.queryName);
  const result = store.result;
  return (
    <div className="jx-screen-body">
      <div className="jx-screen-viewBar">
        <Input
          className="jx-screen-nameInput"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('namePlaceholder')}
        />
        <LoaderButton
          type="primary"
          disabled={!name.trim() || !store.spec}
          action={() => store.saveCurrent(name.trim())}
        >
          {t('pinToWall')}
        </LoaderButton>
      </div>

      {store.spec && <ConditionChips spec={store.spec} onChange={(s) => void store.applySpec(s)} />}

      {result && (
        <div className="jx-screen-summary">
          {t('summary', {
            tradeDate: result.tradeDate,
            total: result.total,
            shown: result.rows.length,
          })}
        </div>
      )}

      <Table<ScreenRow>
        className="jx-screen-table"
        rowKey="tsCode"
        size="middle"
        loading={store.busy}
        dataSource={result?.rows ?? []}
        columns={columns(t)}
        pagination={false}
        scroll={{ y: 'calc(100vh - 320px)' }}
        // Open the stock's candlestick/PE/volume in a new tab — keeps the screen list intact.
        onRow={(r) => ({ onClick: () => window.open(`/stock/${r.tsCode}`, '_blank') })}
      />
    </div>
  );
}, 'QueryView');

// Chat view: continue (or start) a screening conversation with the agent.
const ChatView = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const commitTitle = () => {
    setEditingTitle(false);
    void store.renameConversation(draftTitle);
  };
  return (
    <div className="jx-screen-chat">
      <div className="jx-screen-viewBar">
        {editingTitle ? (
          <Input
            className="jx-screen-nameInput"
            value={draftTitle}
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onPressEnter={commitTitle}
          />
        ) : (
          <span className="jx-screen-chatTitle">
            {store.conversationTitle || t('chatTitleFallback')}
            {store.conversationId && (
              <button
                className="jx-screen-titleEdit"
                onClick={() => {
                  setDraftTitle(store.conversationTitle);
                  setEditingTitle(true);
                }}
              >
                <FontAwesomeIcon icon={faPen} />
              </button>
            )}
          </span>
        )}
      </div>

      {store.chatMessages.length === 0 && !store.sending ? (
        // A brand-new conversation: centered hero input (ChatGPT-style) instead of an empty log
        // over a bottom bar. The first message flips to the log + bottom-composer layout.
        <div className="jx-screen-chatHero">
          <h1 className="jx-screen-chatHeroTitle">{t('heroTitle')}</h1>
          <p className="jx-screen-chatHeroHint">{t('heroHint')}</p>
          <Composer hero />
          <div className="jx-screen-chatHeroExamples">
            <span className="jx-screen-examplesLabel">{t('examplesLabel')}</span>
            {EXAMPLE_CHAT_PROMPTS.map((promptKey) => (
              <Button
                key={promptKey}
                size="small"
                onClick={() => void store.sendAgent(t(`chatExample.${promptKey}`))}
              >
                {t(`chatExample.${promptKey}`)}
              </Button>
            ))}
          </div>
          <div className="jx-screen-chatHeroKbd">{t('heroKbd')}</div>
        </div>
      ) : (
        <>
          <ScreenChatLog
            messages={store.chatMessages}
            sending={store.sending}
            cards={store.cardResults}
            stream={store.turnStream}
          />
          <Composer />
        </>
      )}
    </div>
  );
}, 'ChatView');

// The chat input row — bottom bar normally, widened + shadowed in the new-conversation hero.
const Composer = complex.component(({ hero }: { hero?: boolean }) => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  return (
    <div
      className={classNames('jx-screen-chatComposer', {
        'jx-screen-chatComposer--hero': hero,
      })}
    >
      <PromptInput
        value={store.nlText}
        onChange={(v) => store.setNlText(v)}
        onSubmit={() => void store.sendAgent(store.nlText)}
        placeholder={t('composerPlaceholder')}
        autoFocus
      />
      <Button
        type="primary"
        shape="circle"
        className="jx-screen-send"
        icon={<FontAwesomeIcon icon={faPaperPlane} />}
        disabled={!store.nlText.trim() || store.sending}
        onClick={() => void store.sendAgent(store.nlText)}
      />
    </div>
  );
}, 'Composer');

// Chat bubbles (parts: text + query cards), with ChatGPT's scroll model:
//  - sending a message scrolls that new user turn to the TOP of the viewport (a dynamic tail spacer
//    reserves room below so even a short reply can push it up); we never force-follow the stream.
//  - a floating "scroll to bottom" chevron appears whenever the newest content sits below the viewport.
function ScreenChatLog({
  messages,
  sending,
  cards,
  stream,
}: {
  messages: ChatMessage[];
  sending: boolean;
  cards: QueryCardResults;
  stream: AgentTurnStream;
}) {
  const logRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const lastUserRef = useRef<HTMLDivElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef<number | null>(null);
  const pendingTop = useRef(false);
  const [showDown, setShowDown] = useState(false);

  // The last user message anchors both the scroll-to-top and the tail-spacer math.
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      lastUserIndex = index;
    }
  });

  // Recompute (scroll-independent): how much blank tail to reserve so the last user turn can reach the
  // top, and whether the newest content is below the fold (→ show the scroll-down chevron). Both use the
  // content-end marker, which sits before the spacer, so the spacer never feeds back into its own size.
  const recompute = useCallback(() => {
    const log = logRef.current;
    const end = contentEndRef.current;
    if (!log || !end) {
      return;
    }
    const endBottom = end.getBoundingClientRect().bottom;
    setShowDown(endBottom - log.getBoundingClientRect().bottom > 80);

    const user = lastUserRef.current;
    if (!user) {
      if (tailRef.current) {
        tailRef.current.style.height = '0px';
      }
      return;
    }
    const contentBelow = endBottom - user.getBoundingClientRect().top;
    const next = Math.max(0, log.clientHeight - contentBelow - 24);
    if (tailRef.current) {
      tailRef.current.style.height = `${next}px`;
    }
  }, []);

  // Content grows while a reply streams (the thinking row / assistant text) — a ResizeObserver keeps the
  // spacer and chevron in sync without force-scrolling.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) {
      return;
    }
    const observer = new ResizeObserver(() => recompute());
    observer.observe(thread);
    return () => observer.disconnect();
  }, [recompute]);

  // New turn / initial load: record intent + size the spacer here; the initial load jumps straight to the
  // bottom (show the latest). Assistant appends never scroll.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log) {
      return;
    }
    recompute();
    const len = messages.length;
    if (prevLen.current === null) {
      log.scrollTop = log.scrollHeight;
    } else if (len > prevLen.current && messages[len - 1]?.role === 'user') {
      pendingTop.current = true;
    }
    prevLen.current = len;
  }, [messages, recompute]);

  // Runs every commit: once the spacer has landed and there's room, lift the new user turn to the top (8px
  // gap) and clear the intent. Guarding on available room means the scroll fires on the commit *after* the
  // spacer is applied, not before it — so the question actually reaches the top.
  useLayoutEffect(() => {
    if (!pendingTop.current) {
      return;
    }
    const log = logRef.current;
    const user = lastUserRef.current;
    if (!log || !user) {
      return;
    }
    const userTop =
      user.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop;
    if (log.scrollHeight - userTop >= log.clientHeight - 8) {
      // Instant, not smooth: the reply streams in right after, and its spacer recompute would cancel an
      // in-flight smooth scroll partway (leaving the question mid-screen). Appending below never moves it.
      log.scrollTop = Math.max(0, userTop - 8);
      pendingTop.current = false;
    }
  });

  const scrollToBottom = () => {
    contentEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  return (
    <div className="jx-screen-chatLogWrap">
      <div ref={logRef} className="jx-screen-chatLog" onScroll={recompute}>
        {/* Centered, responsive column (ChatGPT-style): user turns as right bubbles, assistant turns as
            full-width markdown. The scroll area is full-bleed; only this thread is width-capped. */}
        <div ref={threadRef} className="jx-screen-chatThread">
          {messages.map((message, index) => (
            <div
              key={index}
              ref={index === lastUserIndex ? lastUserRef : undefined}
              className={classNames('jx-screen-bubble', `jx-screen-bubble--${message.role}`)}
            >
              <MessageParts message={message} cards={cards} />
              {message.role === 'assistant' && message.turnId ? (
                <AgentTrace turnId={message.turnId} />
              ) : (
                traceOf(message) && <ToolTrace trace={traceOf(message)!} />
              )}
            </div>
          ))}
          {sending && (
            <div className="jx-screen-bubble jx-screen-bubble--assistant jx-screen-bubble--thinking">
              <AgentPending stream={stream} autoScroll={false} />
            </div>
          )}
          <div ref={contentEndRef} className="jx-screen-chatEnd" />
          <div ref={tailRef} className="jx-screen-chatTail" aria-hidden />
        </div>
      </div>
      {showDown && (
        <button
          className="jx-screen-scrollDown"
          onClick={scrollToBottom}
          aria-label="scroll to bottom"
        >
          <FontAwesomeIcon icon={faArrowDown} />
        </button>
      )}
    </div>
  );
}

// Prompt textarea: Enter sends; Shift+Space / Shift+Enter insert a newline; IME composition never sends.
function PromptInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    } // mid-IME (pinyin candidates) — let Enter confirm, never send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.shiftKey && e.code === 'Space') {
      // Shift+Space → newline at the caret (Shift+Enter falls through to the textarea's own newline).
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + '\n' + value.slice(end));
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
    }
  };
  return (
    <div className="jx-screen-inputWrap">
      <Input.TextArea
        className="jx-screen-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        autoSize={{ minRows: 1, maxRows: 6 }}
        variant="borderless"
      />
      {/* Hint as an overlay, not the textarea's `placeholder` attribute: antd autoSize measures
          `value || placeholder`, so a long (wrapping) placeholder forces the empty box to 2 rows.
          Overlaying keeps the empty textarea a single row regardless of hint length / locale. */}
      {!value && <div className="jx-screen-inputHint">{placeholder}</div>}
    </div>
  );
}

// —— Helpers / config ——

function formatDay(iso: string): string {
  return iso.slice(0, 10);
}

/** The turn's ephemeral tool trace (display only — absent once a conversation is reloaded). */
function traceOf(message: ChatMessage): AgentToolTraceItem[] | undefined {
  const trace = (message as ChatMessage & { toolTrace?: AgentToolTraceItem[] }).toolTrace;
  return trace?.length ? trace : undefined;
}

// Starter prompts for the new-conversation hero — clicking one sends the localized text to the agent.
const EXAMPLE_CHAT_PROMPTS = ['lowPeHighDividend', 'topTurnover', 'maotaiPe'];

const pct = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);
const num = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));

// Result table columns — a function of the translator so headers/units follow the active locale.
function columns(t: TFunction<'screen'>): ColumnsType<ScreenRow> {
  const yi = (wan: number | null) => formatMarketCapWan(wan); // 10k CNY → yi (zh) / B (en)
  return [
    {
      title: t('column.name'),
      dataIndex: 'name',
      fixed: 'left',
      render: (_v, r) => (
        <div className="jx-screen-name">
          <span className="jx-screen-nameMain">{r.name}</span>
          <span className="jx-screen-nameCode">{r.tsCode}</span>
        </div>
      ),
    },
    { title: t('column.close'), dataIndex: 'close', align: 'right', render: (v) => num(v) },
    {
      title: t('column.pctChg'),
      dataIndex: 'pctChg',
      align: 'right',
      render: (v: number | null) => (
        <span className={classNames({ 'text-up': (v ?? 0) > 0, 'text-down': (v ?? 0) < 0 })}>
          {pct(v)}
        </span>
      ),
    },
    { title: 'PE(TTM)', dataIndex: 'peTtm', align: 'right', render: (v) => num(v) },
    { title: 'PB', dataIndex: 'pb', align: 'right', render: (v) => num(v) },
    { title: t('column.dvRatio'), dataIndex: 'dvRatio', align: 'right', render: (v) => pct(v) },
    { title: t('column.totalMv'), dataIndex: 'totalMv', align: 'right', render: (v) => yi(v) },
    {
      title: t('column.turnoverRate'),
      dataIndex: 'turnoverRate',
      align: 'right',
      render: (v) => pct(v),
    },
  ];
}
