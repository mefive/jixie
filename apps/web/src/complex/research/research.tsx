import { useEffect, useRef, useState } from 'react';
import { Button, Input, Popconfirm, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import type { ChatMessage, ResearchConversationMeta } from '@jixie/shared';
import {
  faArrowDown,
  faClockRotateLeft,
  faFlask,
  faPaperPlane,
  faPen,
  faPlus,
  faTrash,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { AgentPending } from '@src/components/agent-pending';
import { AgentTrace } from '@src/components/agent-trace';
import { MessageParts } from '@src/components/message-parts';
import { LoadingArea } from '@src/components/loading-area';
import { complex } from './complex';
import { ResearchCuratorDrawer } from './research-curator-drawer';
import './research.css';

const EXAMPLE_KEYS = ['indexRelationship', 'ratesAndStocks', 'goldAndStocks'] as const;

export const Research = complex.component(() => {
  const { t } = useTranslation('research');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [curatorOpen, setCuratorOpen] = useState(false);
  return (
    <main className="jx-research">
      <ResearchSidebar
        mobileOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onOpenCurator={() => setCuratorOpen(true)}
      />
      {historyOpen && (
        <button
          className="jx-research-sidebarBackdrop"
          onClick={() => setHistoryOpen(false)}
          aria-label={t('closeHistory')}
        />
      )}
      <ResearchWorkspace onOpenHistory={() => setHistoryOpen(true)} />
      <ResearchCuratorDrawer open={curatorOpen} onClose={() => setCuratorOpen(false)} />
    </main>
  );
}, 'Research');

const ResearchSidebar = complex.component(
  ({
    mobileOpen,
    onClose,
    onOpenCurator,
  }: {
    mobileOpen: boolean;
    onClose: () => void;
    onOpenCurator: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    const conversations = store.conversationsLoader.result ?? [];

    return (
      <aside
        className={classNames('jx-research-sidebar', {
          'jx-research-sidebar--open': mobileOpen,
        })}
      >
        <div className="jx-research-sidebarHead">
          <h1 className="jx-research-sidebarTitle">
            <FontAwesomeIcon icon={faFlask} /> {t('title')}
          </h1>
          <Button
            icon={<FontAwesomeIcon icon={faPlus} />}
            onClick={() => {
              store.newChat();
              onClose();
            }}
          >
            {t('newChat')}
          </Button>
          <Button
            icon={<FontAwesomeIcon icon={faWandMagicSparkles} />}
            onClick={() => {
              onOpenCurator();
              onClose();
            }}
          >
            {t('curator.open')}
          </Button>
        </div>
        <div className="jx-research-sidebarScroll">
          <h2 className="jx-research-sidebarLabel">{t('history')}</h2>
          <LoadingArea
            loader={store.conversationsLoader}
            isEmpty={conversations.length === 0}
            showDelay={0}
            minimumVisibleDuration={200}
            loading={() => (
              <div className="jx-research-sidebarSkeleton">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} active paragraph={{ rows: 1 }} title={false} />
                ))}
              </div>
            )}
          >
            {conversations.length === 0 ? (
              <p className="jx-research-sidebarEmpty">{t('emptyHistory')}</p>
            ) : (
              conversations.map((conversation) => (
                <ConversationItem key={conversation.id} meta={conversation} onSelect={onClose} />
              ))
            )}
          </LoadingArea>
        </div>
      </aside>
    );
  },
  'ResearchSidebar',
);

const ConversationItem = complex.component(
  ({ meta, onSelect }: { meta: ResearchConversationMeta; onSelect: () => void }) => {
    const store = complex.useStore();
    const { t } = useTranslation('research');
    return (
      <div
        className={classNames('jx-research-historyItem', {
          'jx-research-historyItem--active': store.conversationId === meta.id,
        })}
        onClick={() => {
          void store.openConversation(meta.id);
          onSelect();
        }}
      >
        <div className="jx-research-historyText">
          <div className="jx-research-historyTitle">{meta.title}</div>
          <div className="jx-research-historyPreview">
            {meta.preview || formatDay(meta.updatedAt)}
          </div>
        </div>
        <Popconfirm
          title={t('deleteChat')}
          onConfirm={() => store.removeConversation(meta.id)}
          onPopupClick={(event) => event.stopPropagation()}
        >
          <button
            className="jx-research-historyDelete"
            onClick={(event) => event.stopPropagation()}
            aria-label={t('deleteChat')}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </Popconfirm>
      </div>
    );
  },
  'ConversationItem',
);

const ResearchWorkspace = complex.component(({ onOpenHistory }: { onOpenHistory: () => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const commitTitle = () => {
    setEditingTitle(false);
    void store.renameConversation(title);
  };

  return (
    <section className="jx-research-workspace">
      <header className="jx-research-header">
        <Button
          className="jx-research-mobileHistory"
          size="small"
          icon={<FontAwesomeIcon icon={faClockRotateLeft} />}
          onClick={onOpenHistory}
        >
          {t('history')}
        </Button>
        {editingTitle ? (
          <Input
            className="jx-research-titleInput"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onBlur={commitTitle}
            onPressEnter={commitTitle}
          />
        ) : (
          <span className="jx-research-chatTitle">
            {store.conversationTitle || t('chatTitleFallback')}
            {store.conversationId && (
              <button
                className="jx-research-titleEdit"
                onClick={() => {
                  setTitle(store.conversationTitle);
                  setEditingTitle(true);
                }}
                aria-label="rename"
              >
                <FontAwesomeIcon icon={faPen} />
              </button>
            )}
          </span>
        )}
      </header>

      {store.chatMessages.length === 0 && !store.sending ? (
        <div className="jx-research-hero">
          <div className="jx-research-heroIcon">
            <FontAwesomeIcon icon={faFlask} />
          </div>
          <h2>{t('heroTitle')}</h2>
          <p>{t('heroHint')}</p>
          <Composer hero />
          <div className="jx-research-examples">
            <span>{t('examplesLabel')}</span>
            {EXAMPLE_KEYS.map((key) => (
              <Button
                key={key}
                size="small"
                onClick={() => void store.send(t(`chatExample.${key}`))}
              >
                {t(`chatExample.${key}`)}
              </Button>
            ))}
          </div>
          <small>{t('heroKbd')}</small>
        </div>
      ) : (
        <>
          <ResearchChatLog messages={store.chatMessages} />
          <Composer />
        </>
      )}
    </section>
  );
}, 'ResearchWorkspace');

const ResearchChatLog = complex.component(({ messages }: { messages: ChatMessage[] }) => {
  const store = complex.useStore();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [showDown, setShowDown] = useState(false);

  const recompute = () => {
    const scroller = scrollerRef.current;
    if (scroller) {
      setShowDown(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 96);
    }
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) {
      return;
    }
    const observer = new ResizeObserver(recompute);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="jx-research-chatLogWrap">
      <div ref={scrollerRef} className="jx-research-chatLog" onScroll={recompute}>
        <div className="jx-research-chatThread">
          {messages.map((message, index) => (
            <div
              key={message.id ?? index}
              className={classNames('jx-research-bubble', `jx-research-bubble--${message.role}`)}
            >
              {message.role === 'assistant' && message.turnId && (
                <AgentTrace turnId={message.turnId} />
              )}
              <MessageParts message={message} />
            </div>
          ))}
          {store.sending && (
            <div className="jx-research-bubble jx-research-bubble--assistant">
              <AgentPending stream={store.turnStream} autoScroll={false} />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      {showDown && (
        <button
          className="jx-research-scrollDown"
          onClick={() => endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })}
          aria-label="scroll to bottom"
        >
          <FontAwesomeIcon icon={faArrowDown} />
        </button>
      )}
    </div>
  );
}, 'ResearchChatLog');

const Composer = complex.component(({ hero }: { hero?: boolean }) => {
  const store = complex.useStore();
  const { t } = useTranslation('research');
  const submit = (): void => {
    void store.send(store.prompt);
  };
  return (
    <div className={classNames('jx-research-composer', { 'jx-research-composer--hero': hero })}>
      <div className="jx-research-inputWrap">
        <Input.TextArea
          className="jx-research-input"
          value={store.prompt}
          onChange={(event) => store.setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          autoFocus
          autoSize={{ minRows: 1, maxRows: 6 }}
          variant="borderless"
        />
        {!store.prompt && <div className="jx-research-inputHint">{t('composerPlaceholder')}</div>}
      </div>
      <Button
        type="primary"
        shape="circle"
        icon={<FontAwesomeIcon icon={faPaperPlane} />}
        disabled={!store.prompt.trim() || store.sending}
        onClick={submit}
      />
    </div>
  );
}, 'Composer');

function formatDay(iso: string): string {
  return iso.slice(0, 10);
}
