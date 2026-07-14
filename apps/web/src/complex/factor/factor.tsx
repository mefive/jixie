import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { useBlocker, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  App,
  Alert,
  Button,
  DatePicker,
  Input,
  List,
  Modal,
  Popover,
  Radio,
  Segmented,
  Select,
  Splitter,
  Tabs,
  Tooltip,
} from 'antd';
import type {
  ChatMessage,
  FactorFreq,
  FactorKind,
  FactorMeta,
  FactorReportSummary,
  IcDecayPoint,
  FactorWeight,
} from '@jixie/shared';
import {
  faSpinner,
  faPlay,
  faPlus,
  faTrash,
  faLock,
  faCopy,
  faEllipsis,
  faClockRotateLeft,
  faCheck,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { MessageParts } from '@src/components/message-parts';
import type { QueryCardResults } from '@src/components/query-card-model';
import { ToolTrace } from '@src/components/tool-trace';
import { AgentPending } from '@src/components/agent-pending';
import { AgentTrace } from '@src/components/agent-trace';
import type { AgentTurnStream } from '@src/components/agent-turn-stream';
import type { AgentToolTraceItem } from '@src/api/client';
import i18n from '@src/i18n';
import { LoadingArea } from '@src/components/loading-area';
import { LogView } from '@src/components/log-view';
import { QuantileHeatmap } from './quantile-heatmap';
import { complex } from './complex';
import './factor.css';

dayjs.extend(customParseFormat);
const DecileChart = lazy(() => import('./decile-chart'));
const IcDecayChart = lazy(() => import('./ic-decay-chart'));
const LsNavChart = lazy(() => import('./ls-nav-chart'));
const CorrelationHeatmap = lazy(() => import('./correlation-heatmap'));
const FactorEditor = lazy(() => import('./factor-editor'));

type GuardDiscard = (action: () => void) => void;

/**
 * Factor research — Agent-authored, IDE-style (aligned with the strategy workbench). 3-column Splitter: an Agent
 * panel (a chat that writes the custom factor's defineFactor code, + a factor-library tab of presets & custom
 * factors) | the code editor over a collapsible log dock (a preset shows a greyed note — no code) | the
 * analysis params + result (deciles + Rank IC + long-short + heatmap). Preset factors skip the editor and
 * go straight to analysis; custom factors are authored by the Agent and persisted on a run.
 */
export const Factor = complex.component(() => {
  const store = complex.useStore();
  const { modal } = App.useApp();
  const { t } = useTranslation('factor');

  // Refresh/tab close uses the browser's native warning; in-app route changes use the same strong
  // confirmation as factor switching. Search-param sync within this workbench is never blocked.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (store.hasDraftChanges) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      store.hasDraftChanges && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') {
      return;
    }
    modal.confirm({
      title: t('discardConfirmTitle'),
      content: t('discardConfirmContent'),
      okText: t('discardConfirmOk'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: () => blocker.proceed(),
      onCancel: () => blocker.reset(),
    });
  }, [blocker, modal, t]);

  const guardDiscard = useCallback<GuardDiscard>(
    (action) => {
      if (!store.hasDraftChanges) {
        action();
        return;
      }
      modal.confirm({
        title: t('discardConfirmTitle'),
        content: t('discardConfirmContent'),
        okText: t('discardConfirmOk'),
        okButtonProps: { danger: true },
        cancelText: t('cancel'),
        onOk: action,
      });
    },
    [modal, store, t],
  );

  // A stable report id, rather than its parameter tuple, is the page identity.
  const [, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!store.selectedKey) {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams(
      {
        factor: store.selectedKey,
        ...(store.selectedReportId ? { report: store.selectedReportId } : {}),
      },
      { replace: true },
    );
  }, [store.selectedKey, store.selectedReportId, setSearchParams]);

  // The Splitter renders on the FIRST paint (not gated on the catalog) so it mounts once, early, and its
  // layout-measure reflow happens while the panels are still empty — invisible. Catalog loading is scoped
  // to the factor-library list (a small region), not the whole workbench, so nothing pops in from blank.
  const [panelDefaults] = useState(() => splitterDefaults(340));
  return (
    <div className="jx-factor">
      <Splitter className="jx-factor-body">
        <Splitter.Panel defaultSize={panelDefaults.left} min={280} max={520} collapsible>
          <AgentPanel guardDiscard={guardDiscard} />
        </Splitter.Panel>
        <Splitter.Panel defaultSize={panelDefaults.rest} min="22%">
          <MiddleColumn guardDiscard={guardDiscard} />
        </Splitter.Panel>
        <Splitter.Panel defaultSize={panelDefaults.rest} min="26%">
          <ResultColumn />
        </Splitter.Panel>
      </Splitter>
    </div>
  );
}, 'Factor');

// —— Subcomponents ——

// Left column: Agent (chat authors the factor) | factor library (presets + custom, to select).
const AgentPanel = complex.component(({ guardDiscard }: { guardDiscard: GuardDiscard }) => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const [tab, setTab] = useState('agent');
  return (
    <div className="jx-factor-agent">
      <Tabs
        className="jx-factor-agentTabs"
        size="small"
        activeKey={tab}
        onChange={setTab}
        tabBarExtraContent={
          <Button
            size="small"
            type="text"
            icon={<FontAwesomeIcon icon={faPlus} />}
            onClick={() => {
              guardDiscard(() => {
                store.newFactor();
                setTab('agent');
              });
            }}
          >
            {t('newFactor')}
          </Button>
        }
        items={[
          { key: 'agent', label: t('agentLabel'), children: <AgentChat /> },
          {
            // Picking a custom factor jumps to Agent (to edit/chat); a preset stays here (analysis-only).
            key: 'library',
            label: t('libraryTab'),
            children: (
              <FactorLibrary onPickCustom={() => setTab('agent')} guardDiscard={guardDiscard} />
            ),
          },
        ]}
      />
    </div>
  );
}, 'AgentPanel');

// Agent tab: a chat that writes / iterates the custom factor code, over a Cursor-style composer.
const AgentChat = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const qa = store.qaMode;
  const f = store.selected;
  const name = f
    ? factorDisplayName(f)
    : t(store.mode === 'custom' ? 'unnamedNew' : 'noneSelected');
  return (
    <div className="jx-factor-chat">
      <div className="jx-factor-agentIdentity">
        <div className="jx-factor-agentName">
          <span className="jx-factor-agentNameText">{name}</span>
          {f && (
            <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>
              {t(KIND_KEY[f.kind])}
            </span>
          )}
        </div>
        {store.description && <div className="jx-factor-agentDescription">{store.description}</div>}
      </div>
      <ChatLog
        messages={store.chatMessages}
        sending={store.sending}
        qa={qa}
        cards={store.cardResults}
        stream={store.turnStream}
      />
      <div className="jx-factor-chatInput">
        <PromptBox
          value={store.nlText}
          onChange={(v) => store.setNlText(v)}
          onSubmit={() => void store.sendAgent(store.nlText)}
          placeholder={t(qa ? 'placeholderQa' : 'placeholderAuthor')}
        />
      </div>
    </div>
  );
}, 'AgentChat');

// Chat bubbles, auto-scrolled to the latest; a thinking row while an Agent turn is in flight.
function ChatLog({
  messages,
  sending,
  qa,
  cards,
  stream,
}: {
  messages: ChatMessage[];
  sending: boolean;
  qa: boolean;
  cards: QueryCardResults;
  stream: AgentTurnStream;
}) {
  const { t } = useTranslation('factor');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, sending]);
  return (
    <div ref={ref} className="jx-factor-chatLog">
      {messages.length === 0 && !sending && (
        <div className="jx-factor-chatEmpty">{t(qa ? 'chatEmptyQa' : 'chatEmptyAuthor')}</div>
      )}
      {messages.map((message, index) => (
        <div
          key={index}
          className={classNames('jx-factor-bubble', `jx-factor-bubble--${message.role}`)}
        >
          {message.role === 'assistant' && message.turnId ? (
            <AgentTrace turnId={message.turnId} />
          ) : (
            traceOf(message) && <ToolTrace trace={traceOf(message)!} />
          )}
          <MessageParts message={message} cards={cards} />
        </div>
      ))}
      {sending && (
        <div className="jx-factor-bubble jx-factor-bubble--assistant jx-factor-bubble--thinking">
          <AgentPending stream={stream} />
        </div>
      )}
    </div>
  );
}

// factor-library tab: presets grouped by kind + this user's custom factors. Click to select (→ analyze); custom
// rows have a delete affordance. Picking one jumps back to the Agent tab.
const FactorLibrary = complex.component(
  ({ onPickCustom, guardDiscard }: { onPickCustom: () => void; guardDiscard: GuardDiscard }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const { modal } = App.useApp();
    const [corrOpen, setCorrOpen] = useState(false);
    const list = store.catalogLoader.result ?? [];
    const presets = list.filter((f) => f.kind !== 'custom');
    const custom = list.filter((f) => f.kind === 'custom');

    // A custom factor → jump to Agent (edit/chat); a preset stays here (select → analyze, no code).
    const pick = (key: string, isCustom: boolean) => {
      if (key === store.selectedKey) {
        if (isCustom) {
          onPickCustom();
        }
        return;
      }
      guardDiscard(() => {
        void store.selectFactor(key);
        if (isCustom) {
          onPickCustom();
        }
      });
    };
    const askDelete = (id: string, name: string) =>
      modal.confirm({
        title: t('deleteConfirmTitle'),
        content: t('deleteConfirmContent', { name }),
        okText: t('deleteOk'),
        okButtonProps: { danger: true },
        cancelText: t('cancel'),
        onOk: () => store.removeFactor(id),
      });

    // Catalog loading is scoped here (a small region) with a delayed spinner — not the whole workbench.
    return (
      <LoadingArea loader={store.catalogLoader}>
        {() => (
          <div className="jx-factor-library">
            <Button
              className="jx-factor-corrTrigger"
              size="small"
              block
              onClick={() => setCorrOpen(true)}
            >
              {t('corrTrigger')}
            </Button>
            <CorrelationModal open={corrOpen} onClose={() => setCorrOpen(false)} />
            <div className="jx-factor-libGroup">{t('presetGroup')}</div>
            {presets.map((f) => (
              <button
                key={f.key}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': f.key === store.selectedKey,
                })}
                onClick={() => pick(f.key, false)}
              >
                <span className="jx-factor-libName">{factorDisplayName(f)}</span>
                <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>
                  {t(KIND_KEY[f.kind])}
                </span>
              </button>
            ))}

            <div className="jx-factor-libGroup">{t('customGroup')}</div>
            {custom.length === 0 && <div className="jx-factor-libEmpty">{t('customEmpty')}</div>}
            {custom.map((f) => (
              <button
                key={f.key}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': f.key === store.selectedKey,
                })}
                onClick={() => pick(f.key, true)}
              >
                <span className="jx-factor-libName">{factorDisplayName(f)}</span>
                <span
                  role="button"
                  title={t('deleteTitle')}
                  className="jx-factor-libDel"
                  onClick={(e) => {
                    e.stopPropagation();
                    askDelete(f.key, f.label);
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </span>
              </button>
            ))}
          </div>
        )}
      </LoadingArea>
    );
  },
  'FactorLibrary',
);

// Correlation matrix (3.4): pick 2–8 factors → mean cross-sectional Spearman heatmap (+ a fixed size
// column). Uses the params bar's freq/range. Self-contained modal so it doesn't disturb the workbench.
const CorrelationModal = complex.component(
  ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const list = store.catalogLoader.result ?? [];
    const options = list.map((f) => ({ value: f.key, label: factorDisplayName(f) }));
    const per = t(store.freq === 'week' ? 'unitWeek' : 'unitMonth');

    // Re-attach to a running correlation job when the modal opens (survives a refresh).
    useEffect(() => {
      if (open) {
        void store.reattachCorrelation();
      }
    }, [open, store]);

    const corr = store.correlation;
    const canRun = store.corrKeys.length >= 2 && !store.corrRunning;
    return (
      <Modal
        open={open}
        onCancel={onClose}
        footer={null}
        width={680}
        title={t('corrTitle')}
        className="jx-factor-corrModal"
      >
        <div className="jx-factor-corrControls">
          <Select
            mode="multiple"
            size="small"
            className="jx-factor-corrSelect"
            placeholder={t('corrSelectPlaceholder')}
            value={store.corrKeys}
            onChange={(v) => store.setCorrKeys(v)}
            options={options}
            maxCount={8}
          />
          <LoaderButton
            type="primary"
            size="small"
            loader={store.correlationLoader}
            disabled={!canRun}
            action={() => store.runCorrelation()}
          >
            {t('corrRun')}
          </LoaderButton>
        </div>
        <div className="jx-factor-corrHint">
          {t('corrHint', {
            per,
            startYear: store.start.slice(0, 4),
            endYear: store.end.slice(0, 4),
          })}
        </div>

        {store.corrRunning && (
          <div className="jx-factor-corrProgress">
            <FontAwesomeIcon icon={faSpinner} spin /> {t('corrRunning')}
          </div>
        )}
        {!store.corrRunning && corr && (
          <>
            <Suspense fallback={<div className="jx-factor-corrChart" />}>
              <CorrelationHeatmap data={corr} />
            </Suspense>
            <div className="jx-factor-chartCap">{t('corrCap', { periods: corr.periods, per })}</div>
          </>
        )}
        {!store.corrRunning && !corr && store.corrKeys.length < 2 && (
          <div className="jx-factor-corrEmpty">{t('corrEmpty')}</div>
        )}
      </Modal>
    );
  },
  'CorrelationModal',
);

// Middle column: the Monaco editor over a collapsible log dock. A preset is a seeded READ-ONLY code
// row — shown in the same editor with a lock bar + copy-as-custom (fork), instead of being hidden.
const MiddleColumn = complex.component(({ guardDiscard }: { guardDiscard: GuardDiscard }) => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const preset = store.mode === 'preset';
  if (preset && !store.code) {
    return <FactorDock />; // nothing selected yet (or the preset row failed to load)
  }
  return (
    <Splitter orientation="vertical">
      <Splitter.Panel min="20%">
        <section className="jx-factor-editor">
          {preset && (
            <div className="jx-factor-presetBar">
              <span className="jx-factor-presetNote">
                <FontAwesomeIcon icon={faLock} /> {t('presetReadonly')}
              </span>
              <LoaderButton
                size="small"
                icon={<FontAwesomeIcon icon={faCopy} />}
                action={() =>
                  guardDiscard(() => {
                    void store.forkSelected();
                  })
                }
              >
                {t('forkToCustom')}
              </LoaderButton>
            </div>
          )}
          {!preset && store.selectedKey && <FactorIdentityBar />}
          {store.pendingAgentCode !== null && (
            <div className="jx-factor-agentCodeConflict">
              <span>
                <FontAwesomeIcon icon={faTriangleExclamation} /> {t('agentCodeConflict')}
              </span>
              <span className="jx-factor-agentCodeConflictActions">
                <Button size="small" onClick={() => store.dismissPendingAgentCode()}>
                  {t('keepMyCode')}
                </Button>
                <Button size="small" type="primary" onClick={() => store.applyPendingAgentCode()}>
                  {t('applyAgentCode')}
                </Button>
              </span>
            </div>
          )}
          <div className="jx-factor-code">
            <Suspense fallback={<div className="jx-factor-codeEmpty">{t('editorLoading')}</div>}>
              <FactorEditor
                value={store.code}
                onChange={(v) => store.setCode(v)}
                readOnly={preset}
              />
            </Suspense>
          </div>
        </section>
      </Splitter.Panel>
      <Splitter.Panel defaultSize="28%" min="6%" collapsible>
        <FactorDock />
      </Splitter.Panel>
    </Splitter>
  );
}, 'MiddleColumn');

const FactorIdentityBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const valid = /^[a-z][a-z0-9_]{0,31}$/.test(store.keyDraft);
  if (store.strategyKey) {
    return (
      <div className="jx-factor-keyBar">
        <span className="jx-factor-keyLabel">{t('strategyKey')}</span>
        <code className="jx-factor-keyValue">{store.strategyKey}</code>
        <span className="jx-factor-keyLocked">
          <FontAwesomeIcon icon={faLock} /> {t('strategyKeyLocked')}
        </span>
      </div>
    );
  }
  return (
    <div className="jx-factor-keyBar jx-factor-keyBar--draft">
      <span className="jx-factor-keyLabel">{t('strategyKey')}</span>
      <Input
        className="jx-factor-keyInput"
        size="small"
        addonBefore="custom:"
        value={store.keyDraft}
        placeholder={t('strategyKeyPlaceholder')}
        status={store.keyDraft && !valid ? 'error' : undefined}
        onChange={(event) => store.setKeyDraft(event.target.value)}
      />
      <LoaderButton
        size="small"
        type="primary"
        icon={<FontAwesomeIcon icon={faLock} />}
        loader={store.keyLoader}
        disabled={!valid}
        confirm={t('strategyKeyConfirm', { key: `custom:${store.keyDraft}` })}
        action={() => store.finalizeKey()}
        successMessage={t('strategyKeyFinalized')}
      >
        {t('strategyKeyFinalize')}
      </LoaderButton>
      <span className="jx-factor-keyHint">
        {store.keyDraft && !valid ? t('strategyKeyInvalid') : t('strategyKeyDraftHint')}
      </span>
    </div>
  );
}, 'FactorIdentityBar');

// Middle-bottom: the run's streamed log (system progress + custom-factor console.*).
const FactorDock = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  return (
    <div className="jx-factor-dock">
      <div className="jx-factor-dockHead">
        {store.jobRunning && <FontAwesomeIcon icon={faSpinner} spin />}
        {t('log')}
      </div>
      <LogView lines={store.logs} emptyText={t('logEmpty')} />
    </div>
  );
}, 'FactorDock');

// Right column: sticky analysis params and report history over the scrollable result.
const ResultColumn = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const active = store.selectedKey || store.mode === 'custom';
  if (!active) {
    return <div className="jx-factor-resultCol jx-factor-empty">{t('pickPrompt')}</div>;
  }
  return (
    <div className="jx-factor-resultCol">
      <div className="jx-factor-paramBar">
        <ParamsBar />
      </div>
      <ReportOutdatedWarning />
      <div className="jx-factor-result">
        <FactorResult />
      </div>
    </div>
  );
}, 'ResultColumn');

const ReportOutdatedWarning = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  if (!store.reportOutdated) {
    return null;
  }
  const message = store.codeModifiedSinceReport
    ? t(store.paramsModified ? 'reportOutdatedBoth' : 'reportOutdatedCode')
    : t('reportOutdatedParams');
  return (
    <div className="jx-factor-reportWarning">
      <Alert type="warning" showIcon message={message} />
    </div>
  );
}, 'ReportOutdatedWarning');

// Frequency + date range + run. Every terminal run creates a new report.
const ParamsBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const runningSameDraft = store.reportDetail?.status === 'running' && !store.reportOutdated;
  const frequency = store.freq === 'month' ? t('unitMonth') : t('unitWeek');
  const neutral = {
    none: t('neutralNone'),
    size: t('neutralSize'),
    size_industry: t('neutralSizeIndustry'),
  }[store.neutral];
  const summary = t('paramsSummary', {
    frequency,
    start: dayjs(store.start, 'YYYYMMDD').format('YYYY-MM-DD'),
    end: dayjs(store.end, 'YYYYMMDD').format('YYYY-MM-DD'),
    neutral,
  });

  return (
    <div className="jx-factor-params">
      <Tooltip title={summary}>
        <span className="jx-factor-paramSummary">{summary}</span>
      </Tooltip>
      <div className="jx-factor-paramActions">
        <ReportHistory />
        <LoaderButton
          className="jx-factor-runButton"
          type="primary"
          size="small"
          loader={store.reportLoader}
          disabled={runningSameDraft}
          action={() => store.runAnalysis()}
        >
          {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
        </LoaderButton>
        <Popover
          content={<ParamsPopover />}
          trigger="click"
          placement="bottomRight"
          styles={{
            container: {
              borderRadius: 8,
              boxShadow: '0 8px 24px rgb(17 24 39 / 0.12)',
              padding: 0,
            },
            content: { padding: 0 },
          }}
        >
          <Tooltip title={t('paramsMore')}>
            <Button
              size="small"
              aria-label={t('paramsMore')}
              icon={<FontAwesomeIcon icon={faEllipsis} />}
            />
          </Tooltip>
        </Popover>
      </div>
    </div>
  );
}, 'ParamsBar');

const ParamsPopover = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const runningSameDraft = store.reportDetail?.status === 'running' && !store.reportOutdated;

  return (
    <div className="jx-factor-paramPopover">
      <div className="jx-factor-paramPopoverTitle">{t('paramsSettings')}</div>
      <div className="jx-factor-paramPopoverBody">
        <div className="jx-factor-paramField">
          <span className="jx-factor-paramLabel">{t('freq')}</span>
          <Radio.Group
            value={store.freq}
            onChange={(event) => store.setFreq(event.target.value as FactorFreq)}
          >
            <Radio.Button value="month">{t('unitMonth')}</Radio.Button>
            <Radio.Button value="week">{t('unitWeek')}</Radio.Button>
          </Radio.Group>
        </div>
        <div className="jx-factor-paramField">
          <span className="jx-factor-paramLabel">{t('range')}</span>
          <DatePicker.RangePicker
            className="jx-factor-dateRange"
            value={[dayjs(store.start, 'YYYYMMDD'), dayjs(store.end, 'YYYYMMDD')]}
            onChange={(dates) => {
              if (dates?.[0] && dates[1]) {
                store.setStart(dates[0].format('YYYYMMDD'));
                store.setEnd(dates[1].format('YYYYMMDD'));
              }
            }}
            allowClear={false}
          />
        </div>
        <div className="jx-factor-paramField">
          <span className="jx-factor-paramLabel">{t('neutralLabel')}</span>
          <Select
            className="jx-factor-neutralSelect"
            value={store.neutral}
            onChange={(value) => store.setNeutral(value)}
            options={[
              { value: 'none', label: t('neutralNone') },
              { value: 'size', label: t('neutralSize') },
              { value: 'size_industry', label: t('neutralSizeIndustry') },
            ]}
          />
        </div>
      </div>
      <div className="jx-factor-paramPopoverActions">
        <LoaderButton
          type="primary"
          loader={store.reportLoader}
          disabled={runningSameDraft}
          action={() => store.runAnalysis()}
        >
          {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
        </LoaderButton>
      </div>
    </div>
  );
}, 'ParamsPopover');

// A quiet secondary action opens immutable reports in a modal list.
const ReportHistory = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const { modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const reports = store.reportsLoader.result?.items ?? [];
  if (!reports.length) {
    return null;
  }
  return (
    <>
      <Button
        className="jx-factor-historyTrigger"
        size="small"
        icon={<FontAwesomeIcon icon={faClockRotateLeft} />}
        onClick={() => setOpen(true)}
      >
        {t('historyButton')}
      </Button>
      <Modal
        className="jx-factor-historyModal"
        open={open}
        title={t('historyTitle')}
        footer={null}
        width={620}
        onCancel={() => setOpen(false)}
      >
        <List
          className="jx-factor-historyList"
          dataSource={reports}
          locale={{ emptyText: t('historyEmpty') }}
          renderItem={(report) => {
            const active = report.id === store.selectedReportId;
            return (
              <List.Item>
                <button
                  className={classNames('jx-factor-historyItem', {
                    'jx-factor-historyItem--active': active,
                  })}
                  onClick={() => {
                    const openReport = () => {
                      setOpen(false);
                      void store.openReport(report.id);
                    };
                    if (!store.paramsModified) {
                      openReport();
                      return;
                    }
                    modal.confirm({
                      title: t('historyDiscardTitle'),
                      content: t('historyDiscardContent'),
                      okText: t('historyDiscardOk'),
                      okButtonProps: { danger: true },
                      cancelText: t('cancel'),
                      onOk: openReport,
                    });
                  }}
                >
                  <span className="jx-factor-historyItemHead">
                    <span className="jx-factor-historyDate">
                      {dayjs(report.createdAt).format('YYYY-MM-DD HH:mm')}
                    </span>
                    <span
                      className={`jx-factor-historyStatus jx-factor-historyStatus--${report.status}`}
                    >
                      {t(`status.${report.status}`)}
                    </span>
                    {active && <FontAwesomeIcon icon={faCheck} />}
                  </span>
                  <span className="jx-factor-historyParams">{reportParamsLabel(report, t)}</span>
                  {report.metrics?.rankIc != null && (
                    <span className="jx-factor-historyMetric">
                      {t('historyRankIc', { value: report.metrics.rankIc.toFixed(4) })}
                    </span>
                  )}
                  {report.error && <span className="jx-factor-historyError">{report.error}</span>}
                </button>
              </List.Item>
            );
          }}
        />
      </Modal>
    </>
  );
}, 'ReportHistory');

// Result: running / loading / error / prompt-to-run / the report. The live log streams in the dock.
// Thin wrapper: jobRunning shows a running placeholder; a never-run factor shows a run prompt; otherwise
// LoadingArea drives the cached-report load with a DELAYED spinner (so a fast reload doesn't flash it).
const FactorResult = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const loader = store.reportLoader;
  const detail = store.reportDetail;
  if (store.jobRunning || detail?.status === 'running') {
    return <Placeholder icon={faSpinner} spin text={t('computing')} />;
  }
  if (detail?.status === 'error' || detail?.status === 'stale') {
    return (
      <div className="jx-factor-reportError">
        <Placeholder
          icon={faPlay}
          text={
            detail.status === 'stale'
              ? t('analysisInterrupted')
              : detail.error || t('analysisFailed')
          }
        />
        <Button type="primary" onClick={() => void store.runAnalysis()}>
          {t('rerun')}
        </Button>
      </div>
    );
  }
  const runPrompt = () => <Placeholder icon={faPlay} text={t('runPrompt')} />;
  if (loader.initial) {
    return runPrompt();
  }
  return (
    <LoadingArea loader={loader} empty={runPrompt}>
      {() => <ReportBody />}
    </LoadingArea>
  );
}, 'FactorResult');

// The report render (decile chart + metrics + IC decay + heatmap) for the loaded analysis.
const ReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const [weight, setWeight] = useState<FactorWeight>('equal'); // quantile-return weighting: equal / market-cap (view toggle)
  const r = store.report;
  if (!r) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }

  const n = r.buckets.length;
  const dir = direction(r.icMean);
  const per = t(r.freq === 'week' ? 'unitWeek' : 'unitMonth');
  // Weight is a view toggle over precomputed data (equal-weight always present; cap-weighted on newer reports).
  const hasMktcap = !!r.bucketsMktcap;
  const useMktcap = weight === 'mktcap' && hasMktcap;
  const buckets = useMktcap ? r.bucketsMktcap! : r.buckets;
  const longShort = useMktcap ? r.longShortMktcap! : r.longShort;
  return (
    <>
      <div className="jx-factor-resultHead">
        <span className="jx-factor-sample">
          {t('sample', {
            periods: r.periods,
            per,
            startYear: r.start.slice(0, 4),
            endYear: r.end.slice(0, 4),
          })}
        </span>
        {hasMktcap && (
          <Segmented
            size="small"
            value={weight}
            onChange={(v) => setWeight(v as FactorWeight)}
            options={[
              { label: t('weightEqual'), value: 'equal' },
              { label: t('weightMktcap'), value: 'mktcap' },
            ]}
          />
        )}
        <span className={classNames('jx-factor-dir', `jx-factor-dir--${dir.kind}`)}>
          {t(dir.textKey)}
        </span>
      </div>

      <Suspense fallback={<div className="jx-factor-chart" />}>
        <DecileChart buckets={buckets} />
      </Suspense>
      <div className="jx-factor-chartCap">
        {t('decileCap', { n, per })}
        {hasMktcap && t('decileCapMktcap')}
      </div>

      <div className="jx-factor-metrics">
        <Metric
          label={t('metricIcMean')}
          value={r.icMean.toFixed(4)}
          hint={t('metricIcMeanHint')}
        />
        <Metric
          label={t('metricIcir')}
          value={r.icirAnnual.toFixed(2)}
          hint={t('metricIcirHint')}
        />
        <Metric
          label={t('metricIcPos')}
          value={pct(r.icPosRate)}
          hint={t('metricIcPosHint', { per })}
        />
        <Metric
          label={t('metricLsAnn', { n })}
          value={pct(longShort.annReturn)}
          hint={t('metricLsAnnHint')}
        />
        <Metric label={t('metricLsSharpe')} value={longShort.sharpe.toFixed(2)} />
        <Metric label={t('metricLsMdd')} value={pct(longShort.maxDrawdown)} />
        <Metric
          label={t('metricTopTurnover', { per })}
          value={pctInt(r.topTurnover)}
          hint={t('metricTopTurnoverHint')}
        />
      </div>

      {r.lsNav && r.longShortNet && (
        <>
          <div className="jx-factor-sectionTitle">{t('lsNavTitle')}</div>
          <Suspense fallback={<div className="jx-factor-chart" />}>
            <LsNavChart nav={r.lsNav} />
          </Suspense>
          <div className="jx-factor-chartCap">{t('lsNavCap')}</div>
          <div className="jx-factor-metrics">
            <Metric
              label={t('metricLsNetAnn', { n })}
              value={pct(r.longShortNet.annReturn)}
              hint={t('metricLsNetAnnHint')}
            />
            <Metric label={t('metricLsNetSharpe')} value={r.longShortNet.sharpe.toFixed(2)} />
            <Metric label={t('metricLsNetMdd')} value={pct(r.longShortNet.maxDrawdown)} />
          </div>
        </>
      )}

      {r.icDecay?.length > 0 && (
        <>
          <div className="jx-factor-sectionTitle">{t('icDecayTitle')}</div>
          <Suspense fallback={<div className="jx-factor-chart" />}>
            <IcDecayChart points={r.icDecay} />
          </Suspense>
          <div className="jx-factor-chartCap">
            {t('icDecayCap', { hint: decayHint(r.icDecay) })}
          </div>
        </>
      )}

      {r.quantileHorizons?.length ? (
        <>
          <div className="jx-factor-sectionTitle">{t('heatmapTitle')}</div>
          <QuantileHeatmap rows={r.quantileHorizons} weight={useMktcap ? 'mktcap' : 'equal'} />
          <div className="jx-factor-chartCap">{t('heatmapCap', { n })}</div>
        </>
      ) : null}
    </>
  );
}, 'ReportBody');

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="jx-factor-metric">
      <span className="jx-factor-metricLabel">{label}</span>
      <span className="jx-factor-metricValue">{value}</span>
      {hint && <span className="jx-factor-metricHint">{hint}</span>}
    </div>
  );
}

function reportParamsLabel(report: FactorReportSummary, t: TFunction<'factor'>): string {
  const spec = report.spec;
  const frequency = t(spec.freq === 'week' ? 'unitWeek' : 'unitMonth');
  const neutral = t(
    spec.neutral === 'size'
      ? 'neutralSize'
      : spec.neutral === 'size_industry'
        ? 'neutralSizeIndustry'
        : 'neutralNone',
  );
  return `${frequency} · ${dayjs(spec.start, 'YYYYMMDD').format('YYYY-MM-DD')} – ${dayjs(spec.end, 'YYYYMMDD').format('YYYY-MM-DD')} · ${neutral}`;
}

// Cursor-style chat input — Enter sends, Shift+Enter newline, IME-safe.
function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };
  return (
    <Input.TextArea
      className="jx-factor-chatBox"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      autoSize={{ minRows: 3, maxRows: 10 }}
      variant="borderless"
    />
  );
}

// —— Helpers / config ——

/** The turn's ephemeral tool trace (display only — absent once a conversation is reloaded). */
function traceOf(message: ChatMessage): AgentToolTraceItem[] | undefined {
  const trace = (message as ChatMessage & { toolTrace?: AgentToolTraceItem[] }).toolTrace;
  return trace?.length ? trace : undefined;
}

// FactorKind → its i18n label key (in the 'factor' namespace).
const KIND_KEY: Record<FactorKind, string> = {
  price: 'kindPrice',
  fundamental: 'kindFundamental',
  moneyflow: 'kindMoneyflow',
  custom: 'kindCustom',
};

// Display name for a catalog item: a built-in preset shows its localized name (keyed by slug); a custom
// factor keeps the user-given name unchanged.
function factorDisplayName(factor: FactorMeta): string {
  return factor.builtin && i18n.exists(`factor:builtin.${factor.key}`)
    ? i18n.t(`factor:builtin.${factor.key}`)
    : factor.label;
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pctInt = (v: number) => `${(v * 100).toFixed(0)}%`;

// Direction from the IC sign: positive → long the top decile (momentum-like); negative → long the
// bottom decile (reversal-like); near-zero → no edge.
function direction(icMean: number): { kind: 'up' | 'down' | 'flat'; textKey: string } {
  if (icMean > 0.01) {
    return { kind: 'up', textKey: 'dirUp' };
  }
  if (icMean < -0.01) {
    return { kind: 'down', textKey: 'dirDown' };
  }
  return { kind: 'flat', textKey: 'dirFlat' };
}

// Interpret the IC-decay shape: where |IC| peaks (natural holding period) + whether it rises (slow
// factor, hold long) or fades from the short end (fast factor, hold short).
function decayHint(points: IcDecayPoint[]): string {
  if (!points.length) {
    return '';
  }
  const peak = points.reduce((a, b) => (Math.abs(b.icMean) > Math.abs(a.icMean) ? b : a));
  const rising = Math.abs(points.at(-1)!.icMean) > Math.abs(points[0].icMean);
  const trend = i18n.t(rising ? 'factor:decayTrendSlow' : 'factor:decayTrendFast');
  return i18n.t('factor:decayPeak', { days: peak.horizonDays, trend });
}

// antd Splitter only learns its container width from a ResizeObserver, one frame AFTER the first
// paint — so a px defaultSize (and the size-less panels around it) render frame one with
// content-driven widths and visibly jump to the computed widths on frame two. Percentage
// defaultSizes are applied as flex-basis on frame one, so pre-convert "left = leftPx, the other
// two split the rest" into percentages of the viewport (the splitter spans the full app width).
function splitterDefaults(leftPx: number): { left: string; rest: string } {
  const viewportWidth = document.documentElement.clientWidth || 1440;
  const leftFraction = leftPx / viewportWidth;
  const restFraction = (1 - leftFraction) / 2;
  return {
    left: `${(leftFraction * 100).toFixed(4)}%`,
    rest: `${(restFraction * 100).toFixed(4)}%`,
  };
}
