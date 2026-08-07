import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChatMessage, StrategyLanguage } from '@jixie/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import {
  Button,
  DatePicker,
  Input,
  InputNumber,
  Modal,
  Popover,
  Segmented,
  Splitter,
  Tabs,
  Tooltip,
} from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  faPaperPlane,
  faPen,
  faPlay,
  faPlus,
  faRocket,
  faPause,
  faSpinner,
  faTriangleExclamation,
  faUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { LogView } from '@src/components/log-view';
import { MessageParts } from '@src/components/message-parts';
import type { QueryCardResults } from '@src/components/query-card-model';
import { ToolTrace } from '@src/components/tool-trace';
import { AgentPending } from '@src/components/agent-pending';
import { AgentTrace } from '@src/components/agent-trace';
import type { AgentTurnStream } from '@src/components/agent-turn-stream';
import type { AgentToolTraceItem } from '@src/api/client';
import { complex } from './complex';
import { MonthlyReturns } from './monthly-returns';
import { ParameterScanButton, ParameterScanPanel } from './parameter-scan';
import { StrategyCardView } from './strategy-card';
import { readRecents } from './recents';
import './lab.css';

// Our dates are 'YYYYMMDD' strings; enable dayjs to parse that format for the DatePicker.
dayjs.extend(customParseFormat);
const ymd = (s: string) => (s ? dayjs(s, 'YYYYMMDD') : null);
const formatYmd = (date: string) =>
  date ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : '—';

const NavChart = lazy(() => import('./nav-chart'));
const CodeEditor = lazy(() => import('./code-editor'));
const TradeDetail = lazy(() => import('./trade-detail'));

/**
 * Backtest workbench — code-first, IDE-style. A first-time visit (no recents) opens a focused prompt
 * hero; otherwise New pops a prompt modal over the workbench. The workbench is a 3-column Splitter: an
 * Agent panel (a chat that iterates on the strategy code, plus a History tab) | the code editor over a
 * collapsible log dock | a right column with the run summary/actions over Results-overview /
 * Trade-detail tabs. All regions are drag-resizable.
 */
export const Lab = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const [heroDismissed, setHeroDismissed] = useState(false); // "write code directly" escape from the new-strategy hero
  const [newModalOpen, setNewModalOpen] = useState(false); // New → prompt modal (not the full hero)
  const [panelDefaults] = useState(() => splitterDefaults(380)); // percentage sizes = no first-frame jitter
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null); // dirty → confirm before discarding
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Warn on refresh / tab-close when there are unrun edits vs. the persisted config (`edited`, not
  // `dirty` — a just-opened never-run strategy is dirty-but-not-edited and must not false-warn).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (store.edited) {
        e.preventDefault();
        e.returnValue = ''; // required for the browser's native "leave?" prompt
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guard an in-app action that would discard unrun edits (New / switching strategy): confirm when edited.
  const tryLeave = (action: () => void) => {
    if (store.edited) {
      setPendingLeave(() => action);
    } else {
      action();
    }
  };
  const skipFirstUrlSync = useRef(true);

  // store → URL: reflect the loaded strategy as ?id (replace — an auto-save/open shouldn't spam history).
  // This fires after run()/openSaved set savedId; a plain re-render, no remount.
  useEffect(() => {
    const savedId = store.savedId ?? '';
    if (savedId && (searchParams.get('id') ?? '') !== savedId) {
      setSearchParams({ id: savedId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.savedId]);

  // URL → store: external navigation (a recent-visit card, My strategies, browser back/forward) loads into the SAME
  // store instance — no remount, no flash. Skip the mount run (setup already resolved the initial URL).
  useEffect(() => {
    if (skipFirstUrlSync.current) {
      skipFirstUrlSync.current = false;
      return;
    }
    const id = searchParams.get('id') ?? '';
    const savedId = store.savedId ?? '';
    if (searchParams.has('new')) {
      if (savedId) {
        store.newStrategy();
      }
      return;
    }
    if (id) {
      if (id !== savedId) {
        void store.openSaved(id);
      }
      return;
    }
    // bare /lab (e.g. the backtest-workbench nav): re-open the most recent, else go blank.
    const recent = readRecents()[0] ?? '';
    if (recent && recent !== savedId) {
      void store.openSaved(recent);
    } else if (!recent && savedId) {
      store.newStrategy();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // New → a prompt Modal (not the full new-strategy view). Guard unrun edits (chat saves in real time, but
  // code/params only commit on a run — New or switching away would drop them).
  const openNewModal = () => tryLeave(() => setNewModalOpen(true));
  // Open a saved strategy (from History) — same unrun-edit guard.
  const onOpenStrategy = (id: string) => tryLeave(() => navigate(`/lab?id=${id}`));
  // From the modal: start a new strategy with a first Agent message, or a blank one to hand-write. Both
  // reset to a fresh strategy and clear the URL (?new=1 keeps the URL sync from auto-opening a recent).
  const startNew = (text: string, language: StrategyLanguage) => {
    setHeroDismissed(true);
    setNewModalOpen(false);
    store.newStrategy(language);
    void store.sendAgent(text);
    navigate('/lab?new=1', { replace: true });
  };
  const startBlank = (language: StrategyLanguage) => {
    setHeroDismissed(true);
    setNewModalOpen(false);
    store.newStrategy(language);
    navigate('/lab?new=1', { replace: true });
  };

  // The full-page new-strategy view (hero) shows only on a genuine first visit with nothing recent to auto-open;
  // never while the initial strategy is still loading (that async gap would flash the hero before
  // openSaved resolved). Otherwise New pops the prompt modal over the workbench.
  const showHero =
    !store.initializing && store.isFresh && !heroDismissed && readRecents().length === 0;

  // While the initial strategy loads (`initializing`) the workbench shell renders anyway — panel
  // chrome paints on the first frame and Monaco's lazy chunk starts downloading in parallel with
  // the strategy fetch. A full-page spinner here reads as a flash (spinner → shell → editor pops),
  // and it also serialized the two waits.
  return (
    <div className="jx-lab">
      {showHero ? (
        <StrategyHero
          onSubmit={(text, language) => {
            store.newStrategy(language);
            setHeroDismissed(true);
            void store.sendAgent(text);
          }}
          onSkip={(language) => {
            store.newStrategy(language);
            setHeroDismissed(true);
          }}
        />
      ) : (
        // IDE layout: Agent | (editor over log dock) | right column of Results / Trade-detail tabs — all drag-resizable.
        <Splitter className="jx-lab-body">
          <Splitter.Panel defaultSize={panelDefaults.left} min={300} max={620} collapsible>
            <AgentPanel onNew={openNewModal} onOpenStrategy={onOpenStrategy} />
          </Splitter.Panel>
          <Splitter.Panel defaultSize={panelDefaults.rest} min="22%">
            <Splitter orientation="vertical">
              <Splitter.Panel min="20%">
                <section className="jx-lab-editor">
                  <StrategyCode />
                </section>
              </Splitter.Panel>
              <Splitter.Panel defaultSize="28%" min="6%" collapsible>
                <LogDock />
              </Splitter.Panel>
            </Splitter>
          </Splitter.Panel>
          <Splitter.Panel defaultSize={panelDefaults.rest} min="24%">
            <ResultTabs />
          </Splitter.Panel>
        </Splitter>
      )}

      <NewStrategyModal
        open={newModalOpen}
        onSubmit={startNew}
        onBlank={startBlank}
        onCancel={() => setNewModalOpen(false)}
      />

      <Modal
        open={!!pendingLeave}
        title={t('unrunTitle')}
        onCancel={() => setPendingLeave(null)}
        okText={t('discardChanges')}
        okButtonProps={{ danger: true }}
        cancelText={t('cancel')}
        onOk={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          action?.();
        }}
      >
        <p>{t('unrunBody')}</p>
      </Modal>
    </div>
  );
}, 'Lab');

// —— Subcomponents ——

// New-strategy hero: the full-page new-strategy view, shown only on a first visit with no recents. Describe the
// strategy → the Agent writes it → the workbench takes over. Below the prompt, Recent visits tiles the
// last-opened strategies for one-click reopen.
const StrategyHero = complex.component(
  ({
    onSubmit,
    onSkip,
  }: {
    onSubmit: (text: string, language: StrategyLanguage) => void;
    onSkip: (language: StrategyLanguage) => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('lab');
    const navigate = useNavigate();
    // Snapshot the recent-id order on mount; the card data (name/snapshot) comes from the saved list.
    const [recentIds, setRecentIds] = useState(() => readRecents());
    const cards = store.savedLoader.result ?? [];
    const recentCards = recentIds
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is NonNullable<typeof card> => !!card)
      .slice(0, 6);

    return (
      <main className="jx-lab-hero">
        <div className="jx-lab-heroInner">
          <h1 className="jx-lab-heroTitle">{t('heroTitle')}</h1>
          <p className="jx-lab-heroHint">{t('heroHint')}</p>

          <NewStrategyPrompt
            onSubmit={onSubmit}
            onSkip={onSkip}
            initialText={store.nlText}
            autoFocus
          />

          {recentCards.length > 0 && (
            <div className="jx-lab-recents">
              <span className="jx-lab-recentsLabel">{t('recentVisits')}</span>
              <div className="jx-lab-recentsGrid">
                {recentCards.map((card) => (
                  <StrategyCardView
                    key={card.id}
                    card={card}
                    onOpen={(id) => navigate(`/lab?id=${id}`)}
                    onDelete={(id) => {
                      store.removeSaved(id);
                      setRecentIds((ids) => ids.filter((existing) => existing !== id));
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    );
  },
  'StrategyHero',
);

// The shared prompt block (hero + New modal): a prompt box + example chips + a "write code directly" escape.
// Local draft (not the store's chat draft) so the modal opens clean. onSubmit fires the first Agent turn.
const NewStrategyPrompt = complex.component(
  ({
    onSubmit,
    onSkip,
    initialText,
    autoFocus,
  }: {
    onSubmit: (text: string, language: StrategyLanguage) => void;
    onSkip: (language: StrategyLanguage) => void;
    initialText?: string;
    autoFocus?: boolean;
  }) => {
    const { t } = useTranslation('lab');
    const [text, setText] = useState(initialText ?? '');
    const [language, setLanguage] = useState<StrategyLanguage>('typescript');
    useEffect(() => {
      if (initialText) {
        // Factor-release prefill arrives asynchronously after the hero's first paint. Preserve any
        // text the user has already entered instead of replacing an in-progress draft.
        setText((current) => current || initialText);
      }
    }, [initialText]);
    const submit = () => {
      const trimmed = text.trim();
      if (trimmed) {
        onSubmit(trimmed, language);
      }
    };
    return (
      <>
        <div className="jx-lab-newLanguage">
          <span>{t('strategyLanguage')}</span>
          <Segmented
            size="small"
            value={language}
            options={[
              { label: 'TypeScript', value: 'typescript' },
              { label: 'Python', value: 'python' },
            ]}
            onChange={(value) => setLanguage(value as StrategyLanguage)}
          />
        </div>
        <div className="jx-lab-heroBox">
          <PromptBox
            className="jx-lab-heroInput"
            value={text}
            onChange={setText}
            onSubmit={submit}
            placeholder={t('promptPlaceholder')}
            variant="borderless"
            autoFocus={autoFocus}
          />
          <Button
            type="primary"
            shape="circle"
            className="jx-lab-heroSend"
            icon={<FontAwesomeIcon icon={faPaperPlane} />}
            disabled={!text.trim()}
            onClick={submit}
          />
        </div>

        <div className="jx-lab-examples">
          <span className="jx-lab-examplesLabel">{t('examplesLabel')}</span>
          {EXAMPLE_PROMPTS.map((ex) => (
            <Button
              key={ex.labelKey}
              size="small"
              onClick={() => onSubmit(t(ex.promptKey), language)}
            >
              {t(ex.labelKey)}
            </Button>
          ))}
        </div>

        <div className="jx-lab-heroLinks">
          <button type="button" className="jx-lab-heroSkip" onClick={() => onSkip(language)}>
            {t('writeCodeDirectly')}
          </button>
        </div>
      </>
    );
  },
  'NewStrategyPrompt',
);

// New → a prompt modal (ported from the hero) over the workbench, instead of the full new-strategy view.
function NewStrategyModal({
  open,
  onSubmit,
  onBlank,
  onCancel,
}: {
  open: boolean;
  onSubmit: (text: string, language: StrategyLanguage) => void;
  onBlank: (language: StrategyLanguage) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('lab');
  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      title={t('heroTitle')}
      width={620}
      destroyOnHidden
    >
      <div className="jx-lab-newModal">
        <p className="jx-lab-heroHint">{t('newModalHint')}</p>
        <NewStrategyPrompt onSubmit={onSubmit} onSkip={onBlank} autoFocus />
      </div>
    </Modal>
  );
}

// —— Agent panel (left column) —— a chat that iterates on the strategy, over a sticky run-config; plus a
// History tab to switch strategies. The agent edits the code in the middle editor; the user can still hand-edit.
const AgentPanel = complex.component(
  ({ onNew, onOpenStrategy }: { onNew: () => void; onOpenStrategy: (id: string) => void }) => {
    const { t } = useTranslation('lab');
    const [tab, setTab] = useState('agent');
    return (
      <div className="jx-lab-agent">
        <Tabs
          className="jx-lab-agentTabs"
          size="small"
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            <Button
              size="small"
              type="text"
              icon={<FontAwesomeIcon icon={faPlus} />}
              onClick={onNew}
            >
              {t('newButton')}
            </Button>
          }
          items={[
            { key: 'agent', label: 'Agent', children: <AgentChat /> },
            {
              key: 'history',
              label: t('historyTab'),
              children: <HistoryList onOpen={onOpenStrategy} />,
            },
          ]}
        />
      </div>
    );
  },
  'AgentPanel',
);

// Agent tab: the strategy name over a scrollable chat log + a Cursor-style composer (a bordered box, no
// button — Enter sends; the box stays multi-row rather than collapsing to one line). The run-config
// (date/capital + Run-backtest) lives atop the results column, next to the output it produces.
const AgentChat = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  return (
    <div className="jx-lab-chat">
      <div className="jx-lab-agentName">{store.name || t('agentUnsavedName')}</div>
      <ChatLog
        messages={store.chatMessages}
        sending={store.sending}
        quiet={store.initializing}
        cards={store.cardResults}
        stream={store.turnStream}
      />
      <div className="jx-lab-chatInput">
        <PromptBox
          className="jx-lab-chatBox"
          value={store.nlText}
          onChange={(v) => store.setField('nlText', v)}
          onSubmit={() => void store.sendAgent(store.nlText)}
          placeholder={t('chatPlaceholder')}
          variant="borderless"
          autoSize={{ minRows: 3, maxRows: 10 }}
        />
      </div>
    </div>
  );
}, 'AgentChat');

// Run bar atop the results column: a compact read-only summary + primary Run action. The edit trigger
// opens the less-frequent start/end/capital controls without making the result header look like a form.
const RunConfig = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const releaseDeploymentBlocked = store.result?.factorReleases?.some(
    (release) => release.maturity !== 'production',
  );
  return (
    <div className="jx-lab-runConfig">
      <span className="jx-lab-runSummary">
        {t('runSummary', {
          start: formatYmd(store.start),
          end: formatYmd(store.end),
          capital: (store.initialCash / 10000).toLocaleString(),
        })}
      </span>
      <Tooltip
        title={store.dirty ? t('runBacktest') : `${t('runBacktest')} · ${t('runDisabledHint')}`}
      >
        <LoaderButton
          type="text"
          size="small"
          className="jx-lab-runBtn"
          icon={<FontAwesomeIcon icon={faPlay} />}
          loading={store.running}
          disabled={!store.dirty}
          aria-label={t('runBacktest')}
          action={() => store.run()}
        />
      </Tooltip>
      {store.language === 'typescript' && <ParameterScanButton />}
      {store.language === 'typescript' &&
        (store.deployment ? (
          <Tooltip
            title={
              store.deploymentCurrent
                ? t('deploymentPause')
                : `${t('deploymentRedeployNeeded')} · ${t('deploymentOutdated')}`
            }
          >
            <Button
              type="text"
              size="small"
              danger
              loading={store.deploymentActionLoader.loading}
              icon={<FontAwesomeIcon icon={faPause} />}
              onClick={() => void store.pauseDeployment()}
              aria-label={
                store.deploymentCurrent ? t('deploymentPause') : t('deploymentRedeployNeeded')
              }
            />
          </Tooltip>
        ) : (
          <Tooltip
            title={
              store.dirty
                ? `${t('deploymentAction')} · ${t('deploymentRunFirst')}`
                : !store.result
                  ? `${t('deploymentAction')} · ${t('deploymentNeedsResult')}`
                  : releaseDeploymentBlocked
                    ? `${t('deploymentAction')} · ${t('deploymentFactorReleaseBlocked')}`
                    : t('deploymentAction')
            }
          >
            <Button
              type="text"
              size="small"
              loading={store.deploymentActionLoader.loading}
              disabled={
                !store.savedId ||
                !store.result ||
                store.dirty ||
                store.running ||
                releaseDeploymentBlocked
              }
              icon={<FontAwesomeIcon icon={faRocket} />}
              onClick={() => void store.deploy()}
              aria-label={t('deploymentAction')}
            />
          </Tooltip>
        ))}
      {store.deploymentError && (
        <span className="jx-lab-deploymentError" title={store.deploymentError}>
          <FontAwesomeIcon icon={faTriangleExclamation} />
          {store.deploymentError}
        </span>
      )}
      <Popover
        placement="bottomRight"
        trigger="click"
        content={
          <div className="jx-lab-runPanel">
            <div className="jx-lab-runPanelTitle">{t('runParameters')}</div>
            <label className="jx-lab-runPanelField">
              <span className="jx-lab-runLabel">{t('runStart')}</span>
              <DatePicker
                size="small"
                className="jx-lab-runPanelControl"
                value={ymd(store.start)}
                format="YYYY-MM-DD"
                allowClear={false}
                onChange={(date) => store.setField('start', date ? date.format('YYYYMMDD') : '')}
              />
            </label>
            <label className="jx-lab-runPanelField">
              <span className="jx-lab-runLabel">{t('runSlippageBps')}</span>
              <InputNumber
                size="small"
                className="jx-lab-runPanelControl"
                value={store.cost.slippageBps}
                min={0}
                max={10_000}
                step={1}
                addonAfter="bp"
                onChange={(value) => store.setCostField('slippageBps', value ?? 0)}
              />
            </label>
            <label className="jx-lab-runPanelField">
              <span className="jx-lab-runLabel">{t('runImpactCoef')}</span>
              <InputNumber
                size="small"
                className="jx-lab-runPanelControl"
                value={store.cost.impactCoef}
                min={0}
                max={10}
                step={0.05}
                onChange={(value) => store.setCostField('impactCoef', value ?? 0)}
              />
            </label>
            <label className="jx-lab-runPanelField">
              <span className="jx-lab-runLabel">{t('runEnd')}</span>
              <DatePicker
                size="small"
                className="jx-lab-runPanelControl"
                value={ymd(store.end)}
                format="YYYY-MM-DD"
                allowClear={false}
                onChange={(date) => store.setField('end', date ? date.format('YYYYMMDD') : '')}
              />
            </label>
            <label className="jx-lab-runPanelField">
              <span className="jx-lab-runLabel">{t('runCapital')}</span>
              <InputNumber
                size="small"
                className="jx-lab-runPanelControl"
                addonAfter={t('unitWan')}
                value={store.initialCash / 10000}
                min={1}
                step={10}
                formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(value) => Number((value ?? '').replace(/,/g, ''))}
                onChange={(value) => store.setField('initialCash', (value ?? 0) * 10000)}
              />
            </label>
          </div>
        }
      >
        <Tooltip title={t('runEditParameters')}>
          <Button
            type="text"
            size="small"
            className="jx-lab-runEditBtn"
            icon={<FontAwesomeIcon icon={faPen} />}
            aria-label={t('runEditParameters')}
          />
        </Tooltip>
      </Popover>
    </div>
  );
}, 'RunConfig');

// Chat bubbles, auto-scrolled to the latest; a thinking row while an Agent turn is in flight.
// `quiet` suppresses the empty-state hint while the initial strategy is still loading — the real
// messages land ~100ms later and the hint would flash-swap into them.
function ChatLog({
  messages,
  sending,
  quiet,
  cards,
  stream,
}: {
  messages: ChatMessage[];
  sending: boolean;
  quiet?: boolean;
  cards: QueryCardResults;
  stream: AgentTurnStream;
}) {
  const { t } = useTranslation('lab');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, sending]);
  return (
    <div ref={ref} className="jx-lab-chatLog">
      {messages.length === 0 && !sending && !quiet && (
        <div className="jx-lab-chatEmpty">{t('chatEmpty')}</div>
      )}
      {messages.map((message, index) => (
        <div key={index} className={classNames('jx-lab-bubble', `jx-lab-bubble--${message.role}`)}>
          {message.role === 'assistant' && message.turnId ? (
            <AgentTrace turnId={message.turnId} />
          ) : (
            traceOf(message) && <ToolTrace trace={traceOf(message)!} />
          )}
          <MessageParts message={message} cards={cards} />
        </div>
      ))}
      {sending && (
        <div className="jx-lab-bubble jx-lab-bubble--assistant jx-lab-bubble--thinking">
          <AgentPending stream={stream} />
        </div>
      )}
    </div>
  );
}

// History tab: this user's strategies as vertical cards — open loads the strategy + its conversation.
const HistoryList = complex.component(({ onOpen }: { onOpen: (id: string) => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const cards = store.savedLoader.result ?? [];
  if (store.savedLoader.loading && cards.length === 0) {
    return (
      <div className="jx-lab-placeholder">
        <FontAwesomeIcon icon={faSpinner} spin />
      </div>
    );
  }
  if (cards.length === 0) {
    return <div className="jx-lab-placeholder">{t('historyEmpty')}</div>;
  }
  return (
    <div className="jx-lab-history">
      {cards.map((card) => (
        <StrategyCardView
          key={card.id}
          card={card}
          active={card.id === store.savedId}
          onOpen={onOpen}
          onDelete={(id) => store.removeSaved(id)}
        />
      ))}
    </div>
  );
}, 'HistoryList');

// NL prompt textarea — Enter sends, Shift+Space / Shift+Enter newline, IME-safe (mirrors the screener page).
function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  autoFocus,
  className,
  variant,
  autoSize,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  autoFocus?: boolean;
  className?: string;
  variant?: 'borderless' | 'outlined';
  autoSize?: { minRows: number; maxRows: number };
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoSize={autoSize ?? { minRows: 1, maxRows: 6 }}
      variant={variant}
    />
  );
}

// The strategy code editor — Monaco with SDK autocomplete/types, lazy-loaded into its own chunk.
const StrategyCode = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  return (
    <div className="jx-lab-codeShell">
      <div className="jx-lab-codeToolbar">
        <Segmented
          size="small"
          value={store.language}
          options={[
            { label: 'TypeScript', value: 'typescript' },
            { label: 'Python', value: 'python' },
          ]}
          onChange={(language) => {
            Modal.confirm({
              title: t('languageSwitchTitle'),
              content: t('languageSwitchBody'),
              okText: t('languageSwitchConfirm'),
              cancelText: t('cancel'),
              onOk: () => store.changeLanguage(language as StrategyLanguage),
            });
          }}
        />
        {store.language === 'python' && (
          <span className="jx-lab-runtimeBadge">py-v1 · {t('pythonRuntimeHint')}</span>
        )}
      </div>
      <div className="jx-lab-code">
        <Suspense fallback={<div className="jx-lab-placeholder">{t('loadingEditor')}</div>}>
          <CodeEditor
            value={store.code}
            language={store.language}
            onChange={(value) => store.setField('code', value)}
          />
        </Suspense>
      </div>
    </div>
  );
}, 'StrategyCode');

// Results overview — metrics + equity curve + monthly returns. Logs and Trade-detail live in the dock below (ResultDock), so this
// panel no longer swaps to a log view while running; it shows a running placeholder and lets the log
// stream in the dock.
const ResultPanel = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');

  if (store.running) {
    return (
      <div className="jx-lab-placeholder">
        <FontAwesomeIcon icon={faSpinner} spin />
        {t('runningCalc')}
      </div>
    );
  }
  if (store.error) {
    return (
      <div className="jx-lab-placeholder jx-lab-placeholder--error">
        {t('runFailed', { error: store.error })}
      </div>
    );
  }
  const r = store.result; // a finished run, or the saved last-result loaded on reopen
  if (!r) {
    // While the initial strategy (and its saved result) is still loading, stay blank — the
    // "write your strategy" hint would flash-swap into the loaded result a few frames later.
    if (store.initializing) {
      return <div className="jx-lab-placeholder" />;
    }
    return <div className="jx-lab-placeholder">{t('resultEmpty')}</div>;
  }

  const up = r.totalReturn >= 0;
  const optPct = (v?: number) => (v == null ? '—' : pct(v));
  const optNum = (v?: number) => (v == null ? '—' : v.toFixed(2));
  const metrics: Metric[] = [
    {
      label: t('metricAnnReturn'),
      value: pct(r.annReturn),
      tone: r.annReturn >= 0 ? 'up' : 'down',
    },
    { label: t('metricTotalReturn'), value: pct(r.totalReturn), tone: up ? 'up' : 'down' },
    {
      label: t('metricExcessReturn'),
      value: optPct(r.excessReturn),
      tone: r.excessReturn == null ? undefined : r.excessReturn >= 0 ? 'up' : 'down',
    },
    { label: 'Sharpe', value: r.sharpe.toFixed(2) },
    { label: t('metricInfoRatio'), value: optNum(r.informationRatio) },
    { label: t('metricMaxDrawdown'), value: pct(r.maxDrawdown), tone: 'down' },
    { label: 'Calmar', value: optNum(r.calmar) },
    { label: t('metricWinRate'), value: optPct(r.winRate) },
    {
      label: t('metricProfitFactor'),
      value:
        r.profitFactor == null ? '—' : r.profitFactor >= 99 ? '99+' : r.profitFactor.toFixed(2),
    },
    { label: t('metricTurnover'), value: r.turnover == null ? '—' : `${r.turnover.toFixed(1)}×` },
    { label: t('metricFinalValue'), value: Math.round(r.finalValue).toLocaleString() },
    { label: t('metricTrades'), value: r.trades.toLocaleString() },
  ];
  if (r.totalFees != null || r.totalSlippage != null) {
    metrics.push(
      {
        label: t('metricFees'),
        value: r.totalFees == null ? '—' : Math.round(r.totalFees).toLocaleString(),
      },
      {
        label: t('metricSlippage'),
        value: r.totalSlippage == null ? '—' : Math.round(r.totalSlippage).toLocaleString(),
      },
    );
  }
  const finalSleeves = r.sleeveNav?.at(-1);
  if (finalSleeves && finalSleeves.stockValue > 0 && finalSleeves.futureValue > 0) {
    metrics.push(
      {
        label: t('metricStockSleeve'),
        value: Math.round(finalSleeves.stockValue).toLocaleString(),
      },
      {
        label: t('metricFutureSleeve'),
        value: Math.round(finalSleeves.futureValue).toLocaleString(),
      },
      {
        label: t('metricFutureMargin'),
        value: Math.round(finalSleeves.futureMargin).toLocaleString(),
      },
      {
        label: t('metricNetExposure'),
        value: Math.round(finalSleeves.netExposure).toLocaleString(),
      },
    );
  }

  return (
    <>
      {r.factorReleases?.length ? (
        <div className="jx-lab-factorReleases" data-testid="strategy-factor-releases">
          <div className="jx-lab-factorReleasesHead">
            <strong>{t('factorReleasesTitle')}</strong>
            <span>{t('factorReleasesFrozen')}</span>
          </div>
          <div className="jx-lab-factorReleaseList">
            {r.factorReleases.map((release) => (
              <a
                key={release.releaseId}
                href={`/factors?factor=${encodeURIComponent(release.sourceId)}&report=${encodeURIComponent(release.approvedReportId)}`}
                target="_blank"
                rel="noreferrer"
                className="jx-lab-factorRelease"
              >
                <span>
                  <b>
                    {release.releaseKey}@v{release.version}
                  </b>
                  <code>{release.codeHash.slice(0, 12)}</code>
                </span>
                <span>{t(`factorReleaseMaturity.${release.maturity}`)}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <div className="jx-lab-metrics">
        {metrics.map((m) => (
          <div className="jx-lab-metric" key={m.label}>
            <div className="jx-lab-metricLabel">{m.label}</div>
            <div
              className={classNames('jx-lab-metricValue', {
                'text-up': m.tone === 'up',
                'text-down': m.tone === 'down',
              })}
            >
              {m.value}
            </div>
          </div>
        ))}
      </div>
      <Suspense fallback={<div className="jx-lab-placeholder">{t('loadingChart')}</div>}>
        <NavChart
          nav={r.nav}
          up={up}
          benchmarks={store.benchmarkLoader.result ?? {}}
          benchmarksLoading={store.benchmarkLoader.loading}
        />
      </Suspense>
      {r.monthly?.length ? <MonthlyReturns monthly={r.monthly} /> : null}
    </>
  );
}, 'ResultPanel');

// The bottom dock — a collapsible IDE-style panel with streamed system + user console output.
const LogDock = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const emptyText = store.running ? t('logStarting') : t('logEmpty');
  return (
    <div className="jx-lab-dock">
      <div className="jx-lab-dockHead">
        {store.running && <FontAwesomeIcon icon={faSpinner} spin />}
        {t('logTab')}
      </div>
      <LogView lines={store.logLines} emptyText={emptyText} />
    </div>
  );
}, 'LogDock');

// Right column: Results-overview (metrics + performance chart + monthly returns) / portfolio-level
// execution detail as tabs. Trade-detail appears only once a run has trades.
const ResultTabs = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('lab');
  const [active, setActive] = useState('overview');
  const result = store.result;
  const hasTrades = (result?.tradeLog?.length ?? 0) > 0;

  const items = [
    {
      key: 'overview',
      label: t('tabOverview'),
      children: (
        <div className="jx-lab-result">
          <ResultPanel />
        </div>
      ),
    },
  ];
  if (hasTrades && result) {
    items.push({
      key: 'trades',
      label: t('tabTradeDetail', { count: result.trades.toLocaleString() }),
      children: (
        <div className="jx-lab-tradesTab">
          <Suspense fallback={<div className="jx-lab-placeholder">{t('loadingTrades')}</div>}>
            <TradeDetail tradeLog={result.tradeLog ?? []} />
          </Suspense>
        </div>
      ),
    });
  }
  if (store.savedId) {
    items.push({
      key: 'scan',
      label: t('scanTab'),
      children: <ParameterScanPanel />,
    });
  }

  // A tab may vanish (a rerun with no trades) — fall back to Results-overview so the panel never blanks.
  const activeKey =
    (active === 'trades' && !hasTrades) || (active === 'scan' && !store.savedId)
      ? 'overview'
      : active;

  return (
    <div className="jx-lab-resultTabs">
      <RunConfig />
      <Tabs
        className="jx-lab-resultTabsInner"
        size="small"
        activeKey={activeKey}
        onChange={setActive}
        items={items}
        tabBarExtraContent={
          hasTrades && store.savedId ? (
            <Button
              size="small"
              type="text"
              icon={<FontAwesomeIcon icon={faUpRightFromSquare} />}
              onClick={() => window.open(`/trades?id=${store.savedId}`, '_blank')}
            >
              {t('openInPage')}
            </Button>
          ) : null
        }
      />
    </div>
  );
}, 'ResultTabs');

// —— Helpers / config ——

/** The turn's ephemeral tool trace (display only — absent once a conversation is reloaded). */
function traceOf(message: ChatMessage): AgentToolTraceItem[] | undefined {
  const trace = (message as ChatMessage & { toolTrace?: AgentToolTraceItem[] }).toolTrace;
  return trace?.length ? trace : undefined;
}

// Starter prompts for the new-strategy hero — short chip label + the full sentence sent to NL→code.
// Both resolve through i18n at render time (see NewStrategyPrompt).
const EXAMPLE_PROMPTS = [
  { labelKey: 'exampleHighDivLabel', promptKey: 'exampleHighDivPrompt' },
  { labelKey: 'exampleLowValLabel', promptKey: 'exampleLowValPrompt' },
  { labelKey: 'exampleMomentumLabel', promptKey: 'exampleMomentumPrompt' },
  { labelKey: 'exampleEtfRotationLabel', promptKey: 'exampleEtfRotationPrompt' },
] as const;

interface Metric {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}

function pct(x: number): string {
  return (x * 100).toFixed(2) + '%';
}

// antd Splitter only learns its container width from a ResizeObserver, one frame AFTER the first
// paint — a px defaultSize (and the size-less panels around it) render frame one with
// content-driven widths and visibly jump on frame two. Percentage defaultSizes land as flex-basis
// on frame one, so pre-convert "left = leftPx, the other two split the rest" into percentages of
// the viewport (the splitter spans the full app width). Same fix as factor.tsx.
function splitterDefaults(leftPx: number): { left: string; rest: string } {
  const viewportWidth = document.documentElement.clientWidth || 1440;
  const leftFraction = leftPx / viewportWidth;
  const restFraction = (1 - leftFraction) / 2;
  return {
    left: `${(leftFraction * 100).toFixed(4)}%`,
    rest: `${(restFraction * 100).toFixed(4)}%`,
  };
}
