import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatMarketCapWan } from '@src/i18n/format';
import classNames from 'classnames';
import { Button, Input, Popconfirm, Segmented, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ChatMessage, ScreenConversationMeta, ScreenRow, SavedMeta } from '@jixie/shared';
import {
  faArrowLeft,
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
import type { AgentTurnStream } from '@src/components/agent-turn-stream';
import type { AgentToolTraceItem } from '@src/api/client';
import { complex } from './complex';
import { ConditionChips } from './condition-chips';
import { EXAMPLE_SCREENS } from './screen-store';
import './screen.css';

/**
 * Stock-screener card wall (docs/design/unified-agent.md design 4). One wall, two card kinds: query cards (saved
 * ScreenSpec — click re-runs it into an editable result view) and session cards (agent conversations —
 * click continues the chat). "New conversation" is the standing entry; screening itself happens in the agent
 * conversation, whose runScreen tool calls surface as pinnable query cards.
 */
export const Screen = complex.component(() => {
  const store = complex.useStore();
  if (store.view === 'query') {
    return <QueryView />;
  }
  if (store.view === 'chat') {
    return <ChatView />;
  }
  return <Wall />;
}, 'Screen');

// —— Subcomponents ——

// The wall: filter + New-conversation + example chips, then both card kinds mixed, newest first.
const Wall = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  const [kind, setKind] = useState<'all' | 'query' | 'chat'>('all');
  const queries = store.savedLoader.result ?? [];
  const conversations = store.conversationsLoader.result ?? [];
  const loading = store.savedLoader.loading || store.conversationsLoader.loading;
  const cards = mergeCards(queries, conversations, kind);

  return (
    <main className="jx-screen">
      <div className="jx-screen-wallBar">
        <h1 className="jx-screen-wallTitle">{t('title')}</h1>
        <Segmented
          value={kind}
          onChange={(v) => setKind(v as typeof kind)}
          options={[
            { label: t('filter.all'), value: 'all' },
            { label: t('filter.query'), value: 'query' },
            { label: t('filter.chat'), value: 'chat' },
          ]}
        />
        <span className="jx-screen-wallSpacer" />
        <span className="jx-screen-examplesLabel">{t('examplesLabel')}</span>
        {EXAMPLE_SCREENS.map((example) => (
          <LoaderButton
            key={example.labelKey}
            size="small"
            action={() => store.openSpec(example.spec)}
          >
            {t(`example.${example.labelKey}`)}
          </LoaderButton>
        ))}
        <Button
          type="primary"
          icon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => store.newChat()}
        >
          {t('newChat')}
        </Button>
      </div>

      {loading && cards.length === 0 && (
        // Skeleton cards in the same grid — first paint and loaded wall share one layout, no swap jump.
        <div className="jx-screen-wall">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="jx-screen-card jx-screen-card--skeleton" />
          ))}
        </div>
      )}
      {!loading && cards.length === 0 && (
        <div className="jx-screen-wallEmpty">{t('wallEmpty')}</div>
      )}

      <div className="jx-screen-wall">
        {cards.map((card) =>
          card.kind === 'query' ? (
            <WallQueryCard key={`q-${card.query.id}`} meta={card.query} />
          ) : (
            <WallSessionCard key={`c-${card.conversation.id}`} meta={card.conversation} />
          ),
        )}
      </div>
    </main>
  );
}, 'Wall');

// A query card on the wall: a saved, re-runnable ScreenSpec.
const WallQueryCard = complex.component(({ meta }: { meta: SavedMeta }) => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  return (
    <div
      className="jx-screen-card jx-screen-card--query"
      onClick={() => void store.openSaved(meta.id)}
    >
      <div className="jx-screen-cardHead">
        <span className="jx-screen-cardKind">
          <FontAwesomeIcon icon={faFilter} /> {t('card.query')}
        </span>
        <Popconfirm
          title={t('card.deleteQuery')}
          onConfirm={() => store.removeSaved(meta.id)}
          onPopupClick={(e) => e.stopPropagation()}
        >
          <button className="jx-screen-cardDelete" onClick={(e) => e.stopPropagation()}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </Popconfirm>
      </div>
      <div className="jx-screen-cardTitle">{meta.name}</div>
      <div className="jx-screen-cardMeta">
        {t('card.updatedRerun', { day: formatDay(meta.updatedAt) })}
      </div>
    </div>
  );
}, 'WallQueryCard');

// A session card on the wall: an agent conversation to continue.
const WallSessionCard = complex.component(({ meta }: { meta: ScreenConversationMeta }) => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  return (
    <div
      className="jx-screen-card jx-screen-card--chat"
      onClick={() => void store.openConversation(meta.id)}
    >
      <div className="jx-screen-cardHead">
        <span className="jx-screen-cardKind jx-screen-cardKind--chat">
          <FontAwesomeIcon icon={faComments} /> {t('card.chat')}
        </span>
        <Popconfirm
          title={t('card.deleteChat')}
          onConfirm={() => store.removeConversation(meta.id)}
          onPopupClick={(e) => e.stopPropagation()}
        >
          <button className="jx-screen-cardDelete" onClick={(e) => e.stopPropagation()}>
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </Popconfirm>
      </div>
      <div className="jx-screen-cardTitle">{meta.title}</div>
      {meta.preview && <div className="jx-screen-cardPreview">{meta.preview}</div>}
      <div className="jx-screen-cardMeta">
        {meta.cardCount > 0 ? t('card.cardCount', { num: meta.cardCount }) : ''}
        {formatDay(meta.updatedAt)} · {t('card.continueChat')}
      </div>
    </div>
  );
}, 'WallSessionCard');

// Query view: an opened (or example) spec — editable chips + fresh result table + save-to-wall.
const QueryView = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('screen');
  const [name, setName] = useState(store.queryName);
  const result = store.result;
  return (
    <main className="jx-screen jx-screen-body">
      <div className="jx-screen-viewBar">
        <Button icon={<FontAwesomeIcon icon={faArrowLeft} />} onClick={() => store.showWall()}>
          {t('wall')}
        </Button>
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
    </main>
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
    <main className="jx-screen jx-screen-chat">
      <div className="jx-screen-viewBar">
        <Button icon={<FontAwesomeIcon icon={faArrowLeft} />} onClick={() => store.showWall()}>
          {t('wall')}
        </Button>
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
    </main>
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

// Chat bubbles (parts: text + query cards), auto-scrolled; a thinking row while a turn is in flight.
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, sending]);
  return (
    <div ref={ref} className="jx-screen-chatLog">
      {messages.map((message, index) => (
        <div
          key={index}
          className={classNames('jx-screen-bubble', `jx-screen-bubble--${message.role}`)}
        >
          <MessageParts message={message} cards={cards} />
          {traceOf(message) && <ToolTrace trace={traceOf(message)!} />}
        </div>
      ))}
      {sending && (
        <div className="jx-screen-bubble jx-screen-bubble--assistant jx-screen-bubble--thinking">
          <AgentPending stream={stream} />
        </div>
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
    <Input.TextArea
      className="jx-screen-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoSize={{ minRows: 1, maxRows: 6 }}
      variant="borderless"
    />
  );
}

// —— Helpers / config ——

type WallCard =
  | { kind: 'query'; updatedAt: string; query: SavedMeta }
  | { kind: 'chat'; updatedAt: string; conversation: ScreenConversationMeta };

/** Both card kinds on one wall, newest first, optionally filtered by kind. */
function mergeCards(
  queries: SavedMeta[],
  conversations: ScreenConversationMeta[],
  kind: 'all' | 'query' | 'chat',
): WallCard[] {
  const cards: WallCard[] = [
    ...(kind !== 'chat'
      ? queries.map((query): WallCard => ({ kind: 'query', updatedAt: query.updatedAt, query }))
      : []),
    ...(kind !== 'query'
      ? conversations.map(
          (conversation): WallCard => ({
            kind: 'chat',
            updatedAt: conversation.updatedAt,
            conversation,
          }),
        )
      : []),
  ];
  return cards.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

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
