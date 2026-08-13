import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
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
  Dropdown,
  Input,
  InputNumber,
  List,
  Modal,
  Popover,
  Radio,
  Segmented,
  Select,
  Splitter,
  Switch,
  Tag,
  Tabs,
  Tooltip,
} from 'antd';
import type {
  ChatMessage,
  FactorFreq,
  FactorKind,
  FactorMeta,
  FactorReport,
  FactorReportSummary,
  FactorResearchIntentV1,
  FactorResearchMetric,
  IcDecayPoint,
  FactorWeight,
  FactorOutlierMethod,
  FactorSampleStageKey,
  FactorCompositeDefinition,
  FactorAnalysisKind,
  FactorNeweyWestEstimateV1,
  FactorTimeSeriesReportV1,
  MacroRegimeFactorResearchSpecV1,
  PanelFactorResearchSpecV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import { factorResearchCriterionPassed } from '@jixie/shared';
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
  faLayerGroup,
  faPen,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { MessageParts } from '@src/components/message-parts';
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
import { TIME_SERIES_ASSET_OPTIONS } from './time-series-assets';
import './factor.css';

dayjs.extend(customParseFormat);
const DecileChart = lazy(() => import('./decile-chart'));
const IcDecayChart = lazy(() => import('./ic-decay-chart'));
const LsNavChart = lazy(() => import('./ls-nav-chart'));
const CorrelationHeatmap = lazy(() => import('./correlation-heatmap'));
const FactorEditor = lazy(() => import('./factor-editor'));
const TimeSeriesStateChart = lazy(() => import('./time-series-state-chart'));

type GuardDiscard = (action: () => void) => void;
type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

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
  const { t } = useTranslation('factor');
  const [tab, setTab] = useState('agent');
  const [newKind, setNewKind] = useState<EditableFactorAnalysisKind | null>(null);
  return (
    <div className="jx-factor-agent">
      <Tabs
        className="jx-factor-agentTabs"
        size="small"
        activeKey={tab}
        onChange={setTab}
        tabBarExtraContent={
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                { key: 'cross_sectional', label: t('newFactorCrossSectional') },
                { key: 'time_series', label: t('newFactorTimeSeries') },
                { key: 'panel', label: t('newFactorPanel') },
              ],
              onClick: ({ key }) => {
                guardDiscard(() => {
                  setNewKind(key === 'time_series' || key === 'panel' ? key : 'cross_sectional');
                });
              },
            }}
          >
            <Button size="small" type="text" icon={<FontAwesomeIcon icon={faPlus} />}>
              {t('newFactor')}
            </Button>
          </Dropdown>
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
      <NewFactorModal
        analysisKind={newKind}
        onClose={() => setNewKind(null)}
        onCreated={() => setTab('agent')}
      />
    </div>
  );
}, 'AgentPanel');

const NewFactorModal = complex.component(
  ({
    analysisKind,
    onClose,
    onCreated,
  }: {
    analysisKind: EditableFactorAnalysisKind | null;
    onClose: () => void;
    onCreated: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const { message } = App.useApp();
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (analysisKind) {
        setName('');
        setKey('');
      }
    }, [analysisKind]);

    const valid = name.trim().length > 0 && /^[a-z][a-z0-9_]{0,31}$/.test(key.trim());
    const create = async () => {
      if (!analysisKind || !valid || saving) {
        return;
      }
      setSaving(true);
      try {
        await store.newFactor(analysisKind, key.trim(), name.trim());
        message.success(t('factorCreated'));
        onCreated();
        onClose();
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('saveFailed'));
      } finally {
        setSaving(false);
      }
    };

    return (
      <Modal
        open={analysisKind !== null}
        title={t(
          analysisKind === 'time_series'
            ? 'newFactorTimeSeries'
            : analysisKind === 'panel'
              ? 'newFactorPanel'
              : 'newFactorCrossSectional',
        )}
        okText={t('create')}
        cancelText={t('cancel')}
        confirmLoading={saving}
        okButtonProps={{ disabled: !valid }}
        onOk={() => void create()}
        onCancel={onClose}
        data-testid="new-factor-modal"
      >
        <div className="jx-factor-createForm">
          <label className="jx-factor-createField">
            <span className="jx-factor-createLabel">{t('factorName')}</span>
            <Input
              value={name}
              maxLength={40}
              placeholder={t('factorNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              data-testid="new-factor-name"
            />
          </label>
          <label className="jx-factor-createField">
            <span className="jx-factor-createLabel">{t('strategyKey')}</span>
            <Input
              value={key}
              maxLength={32}
              placeholder={t('strategyKeyPlaceholder')}
              status={key && !/^[a-z][a-z0-9_]{0,31}$/.test(key) ? 'error' : undefined}
              onChange={(event) => setKey(event.target.value)}
              data-testid="new-factor-key"
            />
            <small className="jx-factor-createHint">{t('factorKeyCreateHint')}</small>
          </label>
        </div>
      </Modal>
    );
  },
  'NewFactorModal',
);

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
        emptyKey={
          qa
            ? store.isMacroRegime
              ? 'macroRegime.chatEmpty'
              : store.isPanel
                ? 'panel.chatEmpty'
                : store.isTimeSeries
                  ? store.selected?.kind === 'commodity'
                    ? store.selectedKey === 'commodity_warehouse_pressure_20'
                      ? 'timeSeries.commodityWarehouseChatEmpty'
                      : 'timeSeries.commodityCarryChatEmpty'
                    : 'timeSeries.chatEmpty'
                  : store.mode === 'composite'
                    ? 'chatEmptyComposite'
                    : 'chatEmptyQa'
            : store.isMacroRegime
              ? 'macroRegime.chatEmpty'
              : store.isPanel
                ? 'panel.chatEmptyAuthor'
                : store.isTimeSeries
                  ? 'timeSeries.chatEmptyAuthor'
                  : 'chatEmptyAuthor'
        }
        stream={store.turnStream}
      />
      <div className="jx-factor-chatInput">
        <PromptBox
          value={store.nlText}
          onChange={(v) => store.setNlText(v)}
          onSubmit={() => void store.sendAgent(store.nlText)}
          disabled={!qa && !store.selectedKey}
          placeholder={t(
            qa
              ? store.isMacroRegime
                ? 'macroRegime.placeholderQa'
                : store.isPanel
                  ? 'panel.placeholderQa'
                  : store.isTimeSeries
                    ? 'timeSeries.placeholderQa'
                    : store.mode === 'composite'
                      ? 'placeholderCompositeQa'
                      : 'placeholderQa'
              : store.isMacroRegime
                ? 'macroRegime.placeholderQa'
                : store.isPanel
                  ? 'panel.placeholderAuthor'
                  : store.isTimeSeries
                    ? 'timeSeries.placeholderAuthor'
                    : 'placeholderAuthor',
          )}
        />
      </div>
    </div>
  );
}, 'AgentChat');

// Chat bubbles, auto-scrolled to the latest; a thinking row while an Agent turn is in flight.
function ChatLog({
  messages,
  sending,
  emptyKey,
  stream,
}: {
  messages: ChatMessage[];
  sending: boolean;
  emptyKey:
    | 'chatEmptyQa'
    | 'chatEmptyComposite'
    | 'chatEmptyAuthor'
    | 'timeSeries.chatEmpty'
    | 'timeSeries.commodityCarryChatEmpty'
    | 'timeSeries.commodityWarehouseChatEmpty'
    | 'timeSeries.chatEmptyAuthor'
    | 'panel.chatEmpty'
    | 'panel.chatEmptyAuthor'
    | 'macroRegime.chatEmpty';
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
        <div className="jx-factor-chatEmpty">{t(emptyKey)}</div>
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
          <MessageParts message={message} />
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
    const [compositeOpen, setCompositeOpen] = useState(false);
    const [editingComposite, setEditingComposite] = useState<FactorMeta | null>(null);
    const list = store.catalogLoader.result ?? [];
    const presets = list.filter(
      (f) =>
        f.kind !== 'custom' &&
        f.kind !== 'composite' &&
        f.analysisKind !== 'time_series' &&
        f.analysisKind !== 'panel' &&
        f.analysisKind !== 'macro_regime',
    );
    const timeSeries = list.filter((f) => f.kind !== 'custom' && f.analysisKind === 'time_series');
    const panel = list.filter((f) => f.kind !== 'custom' && f.analysisKind === 'panel');
    const macroRegimes = list.filter(
      (factor) => factor.kind !== 'custom' && factor.analysisKind === 'macro_regime',
    );
    const custom = list.filter((f) => f.kind === 'custom');
    const composites = list.filter((f) => f.kind === 'composite');

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
    const askDeleteComposite = (id: string, name: string) =>
      modal.confirm({
        title: t('compositeDeleteTitle'),
        content: t('compositeDeleteContent', { name }),
        okText: t('deleteOk'),
        okButtonProps: { danger: true },
        cancelText: t('cancel'),
        onOk: () => store.removeComposite(id),
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
            <Button
              className="jx-factor-compositeTrigger"
              size="small"
              block
              icon={<FontAwesomeIcon icon={faLayerGroup} />}
              onClick={() => {
                setEditingComposite(null);
                setCompositeOpen(true);
              }}
            >
              {t('compositeCreate')}
            </Button>
            <CompositeModal
              open={compositeOpen}
              editing={editingComposite}
              onClose={() => setCompositeOpen(false)}
            />
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

            <div className="jx-factor-libGroup">{t('timeSeries.libraryGroup')}</div>
            {timeSeries.map((factor) => (
              <button
                key={factor.key}
                data-testid={`factor-template-${factor.key}`}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': factor.key === store.selectedKey,
                })}
                onClick={() => pick(factor.key, false)}
              >
                <span className="jx-factor-libName">{factorDisplayName(factor)}</span>
                <span className="jx-factor-methodBadge">{t('timeSeries.methodBadge')}</span>
                {factor.kind === 'commodity' && (
                  <span className="jx-factor-kind jx-factor-kind--commodity">
                    {t(KIND_KEY.commodity)}
                  </span>
                )}
              </button>
            ))}

            <div className="jx-factor-libGroup">{t('panel.libraryGroup')}</div>
            {panel.map((factor) => (
              <button
                key={factor.key}
                data-testid={`factor-template-${factor.key}`}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': factor.key === store.selectedKey,
                })}
                onClick={() => pick(factor.key, false)}
              >
                <span className="jx-factor-libName">{factorDisplayName(factor)}</span>
                <span className="jx-factor-methodBadge">{t('panel.methodBadge')}</span>
                {factor.kind === 'commodity' && (
                  <span className="jx-factor-kind jx-factor-kind--commodity">
                    {t(KIND_KEY.commodity)}
                  </span>
                )}
              </button>
            ))}

            <div className="jx-factor-libGroup">{t('macroRegime.libraryGroup')}</div>
            {macroRegimes.map((factor) => (
              <button
                key={factor.key}
                data-testid={`factor-template-${factor.key}`}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': factor.key === store.selectedKey,
                })}
                onClick={() => pick(factor.key, false)}
              >
                <span className="jx-factor-libName">{factorDisplayName(factor)}</span>
                <span className="jx-factor-methodBadge">{t('macroRegime.methodBadge')}</span>
              </button>
            ))}

            <div className="jx-factor-libGroup">{t('compositeGroup')}</div>
            {composites.length === 0 && (
              <div className="jx-factor-libEmpty">{t('compositeEmpty')}</div>
            )}
            {composites.map((factor) => (
              <div
                key={factor.key}
                role="button"
                tabIndex={0}
                className={classNames('jx-factor-libItem', {
                  'jx-factor-libItem--active': factor.key === store.selectedKey,
                })}
                onClick={() => pick(factor.key, false)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pick(factor.key, false);
                  }
                }}
              >
                <span className="jx-factor-libName">{factorDisplayName(factor)}</span>
                {factor.status === 'draft' && (
                  <span className="jx-factor-libActions">
                    <Tooltip title={t('edit')}>
                      <Button
                        type="text"
                        size="small"
                        className="jx-factor-libDel"
                        icon={<FontAwesomeIcon icon={faPen} />}
                        aria-label={t('edit')}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingComposite(factor);
                          setCompositeOpen(true);
                        }}
                      />
                    </Tooltip>
                    <Tooltip title={t('deleteTitle')}>
                      <Button
                        type="text"
                        size="small"
                        className="jx-factor-libDel"
                        icon={<FontAwesomeIcon icon={faTrash} />}
                        aria-label={t('deleteTitle')}
                        onClick={(event) => {
                          event.stopPropagation();
                          askDeleteComposite(factor.key, factor.label);
                        }}
                      />
                    </Tooltip>
                  </span>
                )}
              </div>
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
                <span className="jx-factor-libActions">
                  <span className="jx-factor-methodBadge">
                    {t(
                      f.analysisKind === 'time_series'
                        ? 'timeSeries.methodBadge'
                        : f.analysisKind === 'panel'
                          ? 'panel.methodBadge'
                          : 'crossSectional.methodBadge',
                    )}
                  </span>
                  <Tag>{t(`factorStatus.${f.status ?? 'draft'}`)}</Tag>
                  <span
                    role="button"
                    title={t('copy')}
                    className="jx-factor-libDel"
                    onClick={(event) => {
                      event.stopPropagation();
                      void store.copySelected(f.key);
                    }}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </span>
                  {(f.status ?? 'draft') === 'draft' && (
                    <span
                      role="button"
                      title={t('deleteTitle')}
                      className="jx-factor-libDel"
                      onClick={(event) => {
                        event.stopPropagation();
                        askDelete(f.key, f.label);
                      }}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </span>
                  )}
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

const CompositeModal = complex.component(
  ({
    open,
    editing,
    onClose,
  }: {
    open: boolean;
    editing: FactorMeta | null;
    onClose: () => void;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const { message } = App.useApp();
    const catalog = useMemo(() => store.catalogLoader.result ?? [], [store.catalogLoader.result]);
    const [definition, setDefinition] = useState<FactorCompositeDefinition>(() =>
      emptyCompositeDefinition(catalog, 'cross_sectional'),
    );
    const analysisKind = definition.version === 2 ? 'panel' : 'cross_sectional';
    const available = useMemo(
      () => compositeComponents(catalog, analysisKind),
      [catalog, analysisKind],
    );
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      if (!open) {
        return;
      }
      setDefinition(
        editing?.composite
          ? structuredClone(editing.composite)
          : emptyCompositeDefinition(catalog, 'cross_sectional'),
      );
    }, [open, editing, catalog]);

    const chosen = new Set(definition.components.map((component) => component.factor));
    const valid =
      definition.name.trim().length > 0 &&
      (definition.version === 1 || /^[a-z][a-z0-9_]{0,31}$/.test(definition.key)) &&
      definition.components.length >= 2 &&
      definition.components.length <= 5 &&
      definition.components.every((component) => component.factor) &&
      chosen.size === definition.components.length;
    const save = async () => {
      if (!valid || saving) {
        return;
      }
      setSaving(true);
      try {
        await store.saveComposite({ ...definition, name: definition.name.trim() }, editing?.key);
        void message.success(t(editing ? 'compositeUpdated' : 'compositeCreated'));
        onClose();
      } finally {
        setSaving(false);
      }
    };

    return (
      <Modal
        open={open}
        title={t(editing ? 'compositeEditTitle' : 'compositeCreateTitle')}
        okText={t('save')}
        cancelText={t('cancel')}
        confirmLoading={saving}
        okButtonProps={{ disabled: !valid }}
        onOk={save}
        onCancel={onClose}
        width={620}
      >
        <div className="jx-factor-compositeForm">
          <label>
            <span>{t('compositeName')}</span>
            <Input
              value={definition.name}
              maxLength={80}
              placeholder={t('compositeNamePlaceholder')}
              onChange={(event) => setDefinition({ ...definition, name: event.target.value })}
            />
          </label>
          {definition.version === 2 && (
            <label>
              <span>{t('compositeStrategyKey')}</span>
              <Input
                value={definition.key}
                maxLength={32}
                placeholder={t('compositeStrategyKeyPlaceholder')}
                disabled={!!editing}
                onChange={(event) => setDefinition({ ...definition, key: event.target.value })}
              />
            </label>
          )}
          <label>
            <span>{t('compositeResearchMethod')}</span>
            <Segmented
              value={analysisKind}
              options={[
                { value: 'cross_sectional', label: t('compositeResearchMethodEquity') },
                { value: 'panel', label: t('compositeResearchMethodPanel') },
              ]}
              onChange={(nextAnalysisKind) => {
                const next = emptyCompositeDefinition(
                  catalog,
                  nextAnalysisKind as 'cross_sectional' | 'panel',
                );
                setDefinition({ ...next, name: definition.name });
              }}
            />
          </label>
          <label>
            <span>{t('compositeStandardizationLabel')}</span>
            <Segmented
              value={definition.standardization}
              options={[
                { value: 'rank', label: t('compositeStandardization.rank') },
                { value: 'zscore', label: t('compositeStandardization.zscore') },
              ]}
              onChange={(standardization) =>
                setDefinition({
                  ...definition,
                  standardization: standardization as 'rank' | 'zscore',
                })
              }
            />
          </label>
          <div className="jx-factor-compositeFormHead">
            <span>{t('compositeComponents')}</span>
            <span>{t('compositeCount', { count: definition.components.length })}</span>
          </div>
          <div className="jx-factor-compositeRows">
            {definition.components.map((component, index) => (
              <div className="jx-factor-compositeRow" key={`${index}-${component.factor}`}>
                <Select
                  showSearch
                  value={component.factor || undefined}
                  placeholder={t('compositeFactorPlaceholder')}
                  optionFilterProp="label"
                  options={available.map((factor) => ({
                    value: factor.key,
                    label: factorDisplayName(factor),
                    disabled: factor.key !== component.factor && chosen.has(factor.key),
                  }))}
                  onChange={(factor) => {
                    const components = definition.components.slice();
                    components[index] = {
                      factor,
                      direction:
                        available.find((candidate) => candidate.key === factor)
                          ?.expectedDirection ?? components[index].direction,
                    };
                    setDefinition({ ...definition, components });
                  }}
                />
                <Select
                  value={component.direction}
                  options={[
                    { value: 'positive', label: t('compositeDirection.positive') },
                    { value: 'negative', label: t('compositeDirection.negative') },
                  ]}
                  onChange={(direction) => {
                    const components = definition.components.slice();
                    components[index] = { ...components[index], direction };
                    setDefinition({ ...definition, components });
                  }}
                />
                <Tooltip title={t('deleteTitle')}>
                  <Button
                    type="text"
                    icon={<FontAwesomeIcon icon={faTrash} />}
                    aria-label={t('deleteTitle')}
                    disabled={definition.components.length <= 2}
                    onClick={() =>
                      setDefinition({
                        ...definition,
                        components: definition.components.filter((_, item) => item !== index),
                      })
                    }
                  />
                </Tooltip>
              </div>
            ))}
          </div>
          <Button
            type="dashed"
            block
            icon={<FontAwesomeIcon icon={faPlus} />}
            disabled={definition.components.length >= 5 || available.length <= chosen.size}
            onClick={() =>
              setDefinition({
                ...definition,
                components: [
                  ...definition.components,
                  {
                    factor: available.find((factor) => !chosen.has(factor.key))?.key ?? '',
                    direction:
                      available.find((factor) => !chosen.has(factor.key))?.expectedDirection ??
                      'positive',
                  },
                ],
              })
            }
          >
            {t('compositeAddFactor')}
          </Button>
          <Alert type="info" showIcon title={t('compositeEqualOnlyHint')} />
        </div>
      </Modal>
    );
  },
  'CompositeModal',
);

// Correlation matrix (3.4): pick 2–8 factors → mean cross-sectional Spearman heatmap (+ a fixed size
// column). Uses the params bar's freq/range. Self-contained modal so it doesn't disturb the workbench.
const CorrelationModal = complex.component(
  ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const list = store.catalogLoader.result ?? [];
    const options = list
      .filter(
        (factor) =>
          factor.kind !== 'composite' &&
          factor.analysisKind !== 'time_series' &&
          factor.analysisKind !== 'panel',
      )
      .map((factor) => ({ value: factor.key, label: factorDisplayName(factor) }));
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
  if (store.mode === 'composite') {
    return <CompositeWorkspace />;
  }
  if (store.isMacroRegime) {
    return <MacroRegimeWorkspace />;
  }
  if (store.isTimeSeries || store.isPanel) {
    return <TimeSeriesWorkspace />;
  }
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
                    void store.copySelected();
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
                readOnly={preset || store.factorStatus !== 'draft'}
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

const TimeSeriesWorkspace = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const editable = store.mode === 'custom' && store.factorStatus === 'draft';
  const window = store.code.match(/\bwindow:\s*(\d+)/)?.[1] ?? '—';
  const inputs = factorV2Inputs(store.code)
    .map((input) => timeSeriesInputLabel(input, t))
    .join(t('timeSeries.inputSeparator'));
  return (
    <Splitter orientation="vertical">
      <Splitter.Panel min="20%">
        <section
          className="jx-factor-editor jx-factor-timeWorkspace"
          data-testid="time-series-workspace"
        >
          <div className="jx-factor-presetBar">
            <span className="jx-factor-presetNote">
              {!editable && <FontAwesomeIcon icon={faLock} />}{' '}
              {t(
                store.isPanel
                  ? editable
                    ? 'panel.codeEditable'
                    : 'panel.codeReadonly'
                  : editable
                    ? 'timeSeries.codeEditable'
                    : 'timeSeries.codeReadonly',
              )}
            </span>
            <Tag color="blue">Factor Definition V2</Tag>
          </div>
          {editable && store.selectedKey && <FactorIdentityBar />}
          {editable && store.pendingAgentCode !== null && (
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
          <div className="jx-factor-timeDefinitionAudit">
            <span>{t(store.isPanel ? 'panel.methodBadge' : 'timeSeries.methodBadge')}</span>
            <span>{t('timeSeries.inputAudit', { inputs: inputs || '—' })}</span>
            <span>{t('timeSeries.windowAudit', { value: window })}</span>
            <span>{t(store.isPanel ? 'panel.assetScopeAudit' : 'timeSeries.assetScopeAudit')}</span>
          </div>
          <div className="jx-factor-code">
            <Suspense fallback={<div className="jx-factor-codeEmpty">{t('editorLoading')}</div>}>
              <FactorEditor
                value={store.code}
                onChange={(value) => store.setCode(value)}
                readOnly={!editable}
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
}, 'TimeSeriesWorkspace');

const MacroRegimeWorkspace = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  return (
    <Splitter orientation="vertical">
      <Splitter.Panel min="20%">
        <section
          className="jx-factor-editor jx-factor-timeWorkspace"
          data-testid="macro-regime-workspace"
        >
          <div className="jx-factor-presetBar">
            <span className="jx-factor-presetNote">
              <FontAwesomeIcon icon={faLock} /> {t('macroRegime.codeReadonly')}
            </span>
            <Tag color="purple">{t('macroRegime.definitionTag')}</Tag>
          </div>
          <div className="jx-factor-timeDefinitionAudit">
            <span>{t('macroRegime.methodBadge')}</span>
            <span>{t('macroRegime.inputAudit')}</span>
            <span>{t('macroRegime.transformAudit')}</span>
            <span>{t('macroRegime.outputAudit')}</span>
          </div>
          <div className="jx-factor-code">
            <Suspense fallback={<div className="jx-factor-codeEmpty">{t('editorLoading')}</div>}>
              <FactorEditor value={store.code} onChange={() => {}} readOnly />
            </Suspense>
          </div>
        </section>
      </Splitter.Panel>
      <Splitter.Panel defaultSize="28%" min="6%" collapsible>
        <FactorDock />
      </Splitter.Panel>
    </Splitter>
  );
}, 'MacroRegimeWorkspace');

const CompositeWorkspace = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const [open, setOpen] = useState(false);
  const definition = store.compositeDefinition;
  const catalog = store.catalogLoader.result ?? [];
  if (!definition) {
    return <FactorDock />;
  }
  return (
    <Splitter orientation="vertical">
      <Splitter.Panel min="20%">
        <section className="jx-factor-compositeWorkspace">
          {definition.version === 2 && <FactorIdentityBar />}
          <div className="jx-factor-compositeHead">
            <div>
              <div className="jx-factor-compositeTitle">{definition.name}</div>
              <div className="jx-factor-compositeRule">
                {t(
                  definition.version === 2
                    ? 'compositeResearchMethodPanel'
                    : 'compositeResearchMethodEquity',
                )}{' '}
                · {t(`compositeStandardization.${definition.standardization}`)} ·{' '}
                {t('compositeEqualWeight')}
              </div>
            </div>
            <Tooltip title={t('edit')}>
              <Button
                type="text"
                icon={<FontAwesomeIcon icon={faPen} />}
                aria-label={t('edit')}
                disabled={store.factorStatus !== 'draft'}
                onClick={() => setOpen(true)}
              />
            </Tooltip>
          </div>
          <div className="jx-factor-compositeComponents">
            {definition.components.map((component, index) => {
              const factor = catalog.find((item) => item.key === component.factor);
              return (
                <div className="jx-factor-compositeComponent" key={component.factor}>
                  <span className="jx-factor-compositeIndex">{index + 1}</span>
                  <span>{factor ? factorDisplayName(factor) : component.factor}</span>
                  <span className="jx-factor-compositeDirection">
                    {t(`compositeDirection.${component.direction}`)}
                  </span>
                </div>
              );
            })}
          </div>
          <Alert
            type="info"
            showIcon
            title={t(definition.version === 2 ? 'compositePanelMethodHint' : 'compositeMethodHint')}
          />
        </section>
        <CompositeModal open={open} editing={store.selected} onClose={() => setOpen(false)} />
      </Splitter.Panel>
      <Splitter.Panel defaultSize="28%" min="6%" collapsible>
        <FactorDock />
      </Splitter.Panel>
    </Splitter>
  );
}, 'CompositeWorkspace');

const FactorIdentityBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  return (
    <div className="jx-factor-keyBar">
      <span className="jx-factor-keyLabel">{t('strategyKey')}</span>
      <code className="jx-factor-keyValue">{store.factorKey}</code>
      <span className="jx-factor-keyLocked">
        <FontAwesomeIcon icon={faLock} /> {t('strategyKeyLocked')}
      </span>
      <Tag color={store.factorStatus === 'published' ? 'green' : undefined}>
        {t(`factorStatus.${store.factorStatus}`)}
      </Tag>
      {store.factorStatus === 'draft' && (
        <span className="jx-factor-keyHint">
          {store.saveLoader.loading ? t('saving') : store.edited ? t('savePending') : t('saved')}
        </span>
      )}
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
      <LogView
        lines={store.logs}
        emptyText={
          store.queuePosition
            ? t('queuePosition', { position: store.queuePosition })
            : t('logEmpty')
        }
      />
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
      <ResearchDisciplineBar />
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
      <Alert type="warning" showIcon title={message} />
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
  const universe = t(`evaluationUniverse.${store.evaluationUniverse}`);
  const ranking = t(`evaluationRanking.${store.evaluationScope.rankingScope}`);
  const summary = store.isMacroRegime
    ? t('macroRegime.paramsSummary', {
        assets: store.timeSeriesAssets.length,
        horizon: store.timeSeriesHorizon,
        start: dayjs(store.start, 'YYYYMMDD').format('YYYY-MM-DD'),
        end: dayjs(store.end, 'YYYYMMDD').format('YYYY-MM-DD'),
      })
    : store.isPanel
      ? t('panel.paramsSummary', {
          assets: store.panelAssets.length,
          horizon: store.timeSeriesHorizon,
          start: dayjs(store.start, 'YYYYMMDD').format('YYYY-MM-DD'),
          end: dayjs(store.end, 'YYYYMMDD').format('YYYY-MM-DD'),
        })
      : store.isTimeSeries
        ? t('timeSeries.paramsSummary', {
            assets: store.timeSeriesAssets.length,
            horizon: store.timeSeriesHorizon,
            start: dayjs(store.start, 'YYYYMMDD').format('YYYY-MM-DD'),
            end: dayjs(store.end, 'YYYYMMDD').format('YYYY-MM-DD'),
          })
        : t('paramsSummary', {
            frequency,
            start: dayjs(store.start, 'YYYYMMDD').format('YYYY-MM-DD'),
            end: dayjs(store.end, 'YYYYMMDD').format('YYYY-MM-DD'),
            neutral,
            universe,
            ranking,
          });

  return (
    <div className="jx-factor-params">
      <Tooltip title={summary}>
        <span className="jx-factor-paramSummary">{summary}</span>
      </Tooltip>
      <div className="jx-factor-paramActions">
        <ReportHistory />
        <ResearchRunButton className="jx-factor-runButton" size="small" disabled={runningSameDraft}>
          {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
        </ResearchRunButton>
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

  if (store.isMacroRegime) {
    return <MacroRegimeParamsPopover runningSameDraft={runningSameDraft} />;
  }
  if (store.isPanel) {
    return <PanelParamsPopover runningSameDraft={runningSameDraft} />;
  }
  if (store.isTimeSeries) {
    return <TimeSeriesParamsPopover runningSameDraft={runningSameDraft} />;
  }

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
        {store.mode !== 'composite' && (
          <>
            <div className="jx-factor-paramField">
              <span className="jx-factor-paramLabel">{t('evaluationUniverseLabel')}</span>
              <Select
                className="jx-factor-neutralSelect"
                value={store.evaluationUniverse}
                onChange={(value) => store.setEvaluationUniverse(value)}
                options={[
                  { value: 'cn_a', label: t('evaluationUniverse.cn_a') },
                  { value: '000300.SH', label: t('evaluationUniverse.000300.SH') },
                  { value: '000905.SH', label: t('evaluationUniverse.000905.SH') },
                  { value: '000852.SH', label: t('evaluationUniverse.000852.SH') },
                ]}
              />
            </div>
            <div className="jx-factor-paramField">
              <span className="jx-factor-paramLabel">{t('evaluationRankingLabel')}</span>
              <Select
                className="jx-factor-neutralSelect"
                value={store.evaluationScope.rankingScope}
                onChange={(value) => store.setEvaluationRankingScope(value)}
                options={[
                  { value: 'global', label: t('evaluationRanking.global') },
                  {
                    value: 'within_industry',
                    label: t('evaluationRanking.within_industry'),
                  },
                ]}
              />
            </div>
            <div className="jx-factor-paramField">
              <span className="jx-factor-paramLabel">{t('evaluationDiagnosticsLabel')}</span>
              <div className="jx-factor-diagnosticChoices">
                {(['industry', 'size_bucket', 'liquidity_bucket'] as const).map((diagnostic) => (
                  <label key={diagnostic}>
                    <input
                      type="checkbox"
                      checked={store.evaluationScope.diagnostics.includes(diagnostic)}
                      onChange={() => store.toggleEvaluationDiagnostic(diagnostic)}
                    />
                    {t(`evaluationDiagnostics.${diagnostic}`)}
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="jx-factor-paramSectionTitle">{t('methodologyUniverse')}</div>
        <div className="jx-factor-paramGrid">
          <label>
            <span>{t('minimumListingDays')}</span>
            <InputNumber
              min={0}
              max={3650}
              value={store.methodology.universe.minimumListingDays}
              onChange={(value) => store.setUniverseParameter('minimumListingDays', value ?? 0)}
            />
          </label>
          <label>
            <span>{t('liquidityDropPercent')}</span>
            <InputNumber
              min={0}
              max={90}
              suffix="%"
              value={store.methodology.universe.liquidityDropFraction * 100}
              onChange={(value) =>
                store.setUniverseParameter('liquidityDropFraction', (value ?? 0) / 100)
              }
            />
          </label>
          <label>
            <span>{t('minimumCandidates')}</span>
            <InputNumber
              min={20}
              max={5000}
              value={store.methodology.universe.minimumCandidates}
              onChange={(value) => store.setUniverseParameter('minimumCandidates', value ?? 20)}
            />
          </label>
          <label>
            <span>{t('minimumWindowCoverage')}</span>
            <InputNumber
              min={10}
              max={100}
              suffix="%"
              value={Math.round(store.methodology.missing.minimumWindowCoverage * 100)}
              onChange={(value) => store.setMinimumWindowCoverage((value ?? 10) / 100)}
            />
          </label>
          <label>
            <span>{t('excludeRiskWarnings')}</span>
            <Switch
              checked={store.methodology.universe.excludeRiskWarnings}
              onChange={(checked) => store.setUniverseParameter('excludeRiskWarnings', checked)}
            />
          </label>
          <label>
            <span>{t('excludePendingDelisting')}</span>
            <Switch
              checked={store.methodology.universe.excludePendingDelisting}
              onChange={(checked) => store.setUniverseParameter('excludePendingDelisting', checked)}
            />
          </label>
        </div>
        <div className="jx-factor-paramSectionTitle">{t('methodologyOutliers')}</div>
        <div className="jx-factor-paramGrid">
          <label>
            <span>{t('factorExposureOutlier')}</span>
            <Select
              value={store.methodology.outliers.factorExposure.method}
              onChange={(value: FactorOutlierMethod) =>
                store.setOutlierMethod('factorExposure', value)
              }
              options={outlierOptions(t)}
            />
          </label>
          <label>
            <span>{t('forwardReturnOutlier')}</span>
            <Select
              value={store.methodology.outliers.forwardReturn.method}
              onChange={(value: FactorOutlierMethod) =>
                store.setOutlierMethod('forwardReturn', value)
              }
              options={outlierOptions(t)}
            />
          </label>
        </div>
        <div className="jx-factor-paramSectionTitle">{t('methodologyCosts')}</div>
        <div className="jx-factor-paramGrid">
          {(
            [
              ['commissionPerSide', 'commissionPerSide'],
              ['stampDutySellSide', 'stampDutySellSide'],
              ['slippagePerSide', 'slippagePerSide'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <span>{t(label)}</span>
              <InputNumber
                min={0}
                max={500}
                suffix="bp"
                value={store.methodology.costs[key] * 10000}
                onChange={(value) => store.setCostParameter(key, (value ?? 0) / 10000)}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="jx-factor-paramPopoverActions">
        <ResearchRunButton disabled={runningSameDraft}>
          {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
        </ResearchRunButton>
      </div>
    </div>
  );
}, 'ParamsPopover');

const TimeSeriesParamsPopover = complex.component(
  ({ runningSameDraft }: { runningSameDraft: boolean }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const allowedAssets = new Set(store.timeSeriesAllowedAssets);
    const unavailableReasons = Object.entries(store.selected?.unavailableAssetReasons ?? {});
    return (
      <div className="jx-factor-paramPopover jx-factor-timeParams">
        <div className="jx-factor-paramPopoverTitle">{t('paramsSettings')}</div>
        <div className="jx-factor-paramPopoverBody">
          <div className="jx-factor-paramField jx-factor-paramField--stacked">
            <span className="jx-factor-paramLabel">{t('timeSeries.assets')}</span>
            <Select
              mode="multiple"
              data-testid="time-series-assets"
              value={store.timeSeriesAssets}
              placeholder={t('timeSeries.assetsPlaceholder')}
              onChange={(values) => store.setTimeSeriesAssets(values)}
              options={TIME_SERIES_ASSET_OPTIONS.map((asset) => {
                const reason = store.selected?.unavailableAssetReasons?.[asset.code];
                const unavailable = !allowedAssets.has(asset.code);
                return {
                  value: asset.code,
                  disabled: unavailable,
                  label: `${t(`timeSeries.assetNames.${asset.code}`)} · ${asset.code}${
                    unavailable ? ` — ${reason ?? t('timeSeries.assetUnsupported')}` : ''
                  }`,
                };
              })}
            />
            {unavailableReasons.length > 0 && (
              <Alert
                data-testid="time-series-asset-restriction"
                type="info"
                showIcon
                title={t('timeSeries.assetRestrictionTitle')}
                description={
                  <span className="jx-factor-assetRestrictionText">
                    {unavailableReasons
                      .map(
                        ([assetId, reason]) =>
                          `${t(`timeSeries.assetNames.${assetId}`)} · ${assetId}: ${reason}`,
                      )
                      .join('; ')}
                  </span>
                }
              />
            )}
          </div>
          <div className="jx-factor-paramField">
            <span className="jx-factor-paramLabel">{t('timeSeries.horizon')}</span>
            <Segmented
              data-testid="time-series-horizon"
              value={store.timeSeriesHorizon}
              options={[5, 20, 60].map((value) => ({
                value,
                label: t('timeSeries.horizonOption', { value }),
              }))}
              onChange={(value) => store.setTimeSeriesHorizon(value as 5 | 20 | 60)}
            />
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
          <div className="jx-factor-timeFixed">
            <span>{t('timeSeries.dailyFrequency')}</span>
            <span>{t('timeSeries.neweyWestAuto')}</span>
            <span>{t('timeSeries.disciplinedResearch')}</span>
          </div>
        </div>
        <div className="jx-factor-paramPopoverActions">
          <ResearchRunButton disabled={runningSameDraft || store.timeSeriesAssets.length === 0}>
            {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
          </ResearchRunButton>
        </div>
      </div>
    );
  },
  'TimeSeriesParamsPopover',
);

const PanelParamsPopover = complex.component(
  ({ runningSameDraft }: { runningSameDraft: boolean }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    return (
      <div className="jx-factor-paramPopover jx-factor-timeParams">
        <div className="jx-factor-paramPopoverTitle">{t('paramsSettings')}</div>
        <div className="jx-factor-paramPopoverBody">
          <div className="jx-factor-paramField jx-factor-paramField--stacked">
            <span className="jx-factor-paramLabel">{t('panel.universe')}</span>
            <div className="jx-factor-timeFixed" data-testid="panel-universe">
              {store.panelAssets.map((asset) => (
                <span key={asset.assetId}>
                  {t(`panel.assetNames.${asset.assetId}`)} · {asset.assetId}
                </span>
              ))}
            </div>
          </div>
          <div className="jx-factor-paramField">
            <span className="jx-factor-paramLabel">{t('panel.horizon')}</span>
            <Segmented
              data-testid="panel-horizon"
              value={store.timeSeriesHorizon}
              options={[5, 20, 60].map((value) => ({
                value,
                label: t('timeSeries.horizonOption', { value }),
              }))}
              onChange={(value) => store.setTimeSeriesHorizon(value as 5 | 20 | 60)}
            />
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
          <div className="jx-factor-timeFixed">
            <span>{t('panel.monthlyFrequency')}</span>
            <span>{t('panel.portfolioRule')}</span>
            <span>{t('panel.costRule')}</span>
          </div>
        </div>
        <div className="jx-factor-paramPopoverActions">
          <ResearchRunButton disabled={runningSameDraft}>
            {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
          </ResearchRunButton>
        </div>
      </div>
    );
  },
  'PanelParamsPopover',
);

const MacroRegimeParamsPopover = complex.component(
  ({ runningSameDraft }: { runningSameDraft: boolean }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    return (
      <div className="jx-factor-paramPopover jx-factor-timeParams">
        <div className="jx-factor-paramPopoverTitle">{t('paramsSettings')}</div>
        <div className="jx-factor-paramPopoverBody">
          <div className="jx-factor-paramField jx-factor-paramField--stacked">
            <span className="jx-factor-paramLabel">{t('macroRegime.assets')}</span>
            <Select
              mode="multiple"
              data-testid="macro-regime-assets"
              value={store.timeSeriesAssets}
              placeholder={t('timeSeries.assetsPlaceholder')}
              onChange={(values) => store.setTimeSeriesAssets(values)}
              options={TIME_SERIES_ASSET_OPTIONS.map((asset) => ({
                value: asset.code,
                label: `${t(`timeSeries.assetNames.${asset.code}`)} · ${asset.code}`,
              }))}
            />
          </div>
          <div className="jx-factor-paramField">
            <span className="jx-factor-paramLabel">{t('macroRegime.horizon')}</span>
            <Segmented
              data-testid="macro-regime-horizon"
              value={store.timeSeriesHorizon}
              options={[5, 20, 60].map((value) => ({
                value,
                label: t('timeSeries.horizonOption', { value }),
              }))}
              onChange={(value) => store.setTimeSeriesHorizon(value as 5 | 20 | 60)}
            />
          </div>
          <div className="jx-factor-paramField">
            <span className="jx-factor-paramLabel">{t('macroRegime.revisionPolicy')}</span>
            <Select
              data-testid="macro-regime-revision-policy"
              value={store.macroRevisionPolicy}
              onChange={(value) => store.setMacroRevisionPolicy(value)}
              options={[
                { value: 'latest_vintage', label: t('macroRegime.latestVintage') },
                { value: 'as_available', label: t('macroRegime.asAvailable') },
              ]}
            />
          </div>
          <Alert
            type={store.macroRevisionPolicy === 'latest_vintage' ? 'warning' : 'info'}
            showIcon
            title={t(
              store.macroRevisionPolicy === 'latest_vintage'
                ? 'macroRegime.latestVintageHint'
                : 'macroRegime.asAvailableHint',
            )}
          />
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
          <div className="jx-factor-timeFixed">
            <span>{t('macroRegime.monthlyFrequency')}</span>
            <span>{t('macroRegime.fourStateModel')}</span>
            <span>{t('macroRegime.exploratoryMode')}</span>
          </div>
        </div>
        <div className="jx-factor-paramPopoverActions">
          <ResearchRunButton disabled={runningSameDraft || store.timeSeriesAssets.length === 0}>
            {runningSameDraft ? t('running') : t(store.reportOutdated ? 'rerunShort' : 'run')}
          </ResearchRunButton>
        </div>
      </div>
    );
  },
  'MacroRegimeParamsPopover',
);

function outlierOptions(t: TFunction<'factor'>) {
  return [
    { value: 'none', label: t('outlierNone') },
    { value: 'winsor', label: t('outlierWinsor') },
    { value: 'mad', label: t('outlierMad') },
  ];
}

const ResearchDisciplineBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const counts = store.researchSummaryLoader.result?.factor;
  const detail = store.reportDetail;
  const holdout = detail?.holdout;
  // Only completed explore reports surface an ineligibility reason; other phases are natural states.
  const ineligibleReason =
    !store.isMacroRegime &&
    detail?.phase === 'explore' &&
    detail.status === 'done' &&
    holdout &&
    !holdout.eligible
      ? holdout.reason
      : undefined;
  if (!counts && !holdout?.eligible && !ineligibleReason) {
    return null;
  }
  const intent = detail?.researchIntent;
  const criterion = intent?.primaryCriterion;
  const editorCodeChanged =
    !!detail?.factorCodeSnapshot && !!store.code && store.code !== detail.factorCodeSnapshot;

  return (
    <div className="jx-factor-researchBar">
      {counts && (
        <Tooltip title={t('researchSummaryHelp')}>
          <span className="jx-factor-researchHint">
            {t('researchSummary', {
              tests: counts.exploreTestCount,
              reports: counts.exploreRunCount,
              falsePositives: counts.expectedFalsePositivesAtFivePercent.toFixed(2),
            })}
          </span>
        </Tooltip>
      )}
      {holdout?.eligible && (
        <Button
          size="small"
          onClick={() =>
            Modal.confirm({
              title: t('holdoutConfirmTitle'),
              content: (
                <div className="jx-factor-holdoutConfirm">
                  <div>
                    {t('holdoutConfirmContent', {
                      start: formatTradeDate(holdout.window!.holdoutStart),
                      end: formatTradeDate(holdout.window!.holdoutEnd),
                    })}
                  </div>
                  <div className="jx-factor-holdoutMeta">
                    {detail?.factorCodeHash && (
                      <span>
                        {t('holdoutFrozenCode', { hash: detail.factorCodeHash.slice(0, 12) })}
                      </span>
                    )}
                    {criterion && (
                      <span>
                        {t('holdoutPreset', {
                          direction: t(
                            intent!.expectedDirection === 'positive'
                              ? 'directionPositive'
                              : 'directionNegative',
                          ),
                          criterion: `${criterionMetricLabel(t, criterion.metric)} ${
                            criterion.operator === 'gt' ? '>' : '<'
                          } ${criterion.value}`,
                        })}
                      </span>
                    )}
                  </div>
                  {editorCodeChanged && (
                    <Alert type="warning" showIcon title={t('holdoutCodeChanged')} />
                  )}
                </div>
              ),
              okText: t('runHoldout'),
              cancelText: t('cancel'),
              onOk: () => store.runHoldout(),
            })
          }
        >
          {t('runHoldout')}
        </Button>
      )}
      {ineligibleReason && (
        <span className="jx-factor-researchReason">{t(`holdoutReason.${ineligibleReason}`)}</span>
      )}
    </div>
  );
}, 'ResearchDisciplineBar');

const ResearchRunButton = complex.component(
  ({
    children,
    className,
    size,
    disabled,
  }: {
    children: ReactNode;
    className?: string;
    size?: 'small' | 'middle' | 'large';
    disabled?: boolean;
  }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const previous = store.reportDetail?.researchIntent;
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'hypothesis' | 'exploratory'>(
      store.isMacroRegime ? 'exploratory' : (previous?.mode ?? 'hypothesis'),
    );
    const [hypothesis, setHypothesis] = useState(previous?.hypothesis ?? '');
    const [rationale, setRationale] = useState(previous?.rationale ?? '');
    const [direction, setDirection] = useState<'positive' | 'negative' | 'unknown'>(
      previous?.expectedDirection ?? 'positive',
    );
    const [metric, setMetric] = useState<FactorResearchMetric>(
      previous?.primaryCriterion?.metric ??
        (store.isPanel
          ? 'panel_rank_ic_mean'
          : store.isTimeSeries
            ? 'time_series_median_newey_west_t'
            : 'rank_ic_mean'),
    );
    const [operator, setOperator] = useState<'gt' | 'lt'>(
      previous?.primaryCriterion?.operator ?? 'gt',
    );
    const [value, setValue] = useState(
      previous?.primaryCriterion?.value ?? (store.isTimeSeries ? 1.96 : 0.02),
    );
    const researchKind = store.isMacroRegime
      ? 'macro_regime'
      : store.isPanel
        ? 'panel'
        : store.isTimeSeries
          ? 'time_series'
          : 'cross_sectional';
    useEffect(() => {
      if (researchKind === 'macro_regime') {
        setMode('exploratory');
        return;
      }
      const metricKind = metric.startsWith('time_series_')
        ? 'time_series'
        : metric.startsWith('panel_')
          ? 'panel'
          : 'cross_sectional';
      if (metricKind === researchKind) {
        return;
      }
      setMetric(
        researchKind === 'panel'
          ? 'panel_rank_ic_mean'
          : researchKind === 'time_series'
            ? 'time_series_median_newey_west_t'
            : 'rank_ic_mean',
      );
      setValue(researchKind === 'time_series' ? 1.96 : 0.02);
    }, [metric, researchKind]);
    const metricOptions: Array<{ value: FactorResearchMetric; label: string }> =
      researchKind === 'time_series'
        ? [
            {
              value: 'time_series_median_newey_west_t',
              label: t('criterionTimeSeriesMedianT'),
            },
            {
              value: 'time_series_mean_direction_hit_rate',
              label: t('criterionTimeSeriesMeanHitRate'),
            },
          ]
        : researchKind === 'panel'
          ? [
              { value: 'panel_rank_ic_mean', label: t('criterionPanelRankIc') },
              {
                value: 'panel_net_long_short_annualized',
                label: t('criterionPanelNetLs'),
              },
            ]
          : [
              { value: 'rank_ic_mean', label: t('criterionRankIc') },
              { value: 'rank_icir_annual', label: t('criterionIcir') },
              { value: 'net_long_short_annualized', label: t('criterionNetLs') },
            ];
    const effectiveMode = researchKind === 'macro_regime' ? 'exploratory' : mode;
    const valid =
      effectiveMode === 'exploratory' ||
      (!!hypothesis.trim() && direction !== 'unknown' && Number.isFinite(value));
    const submit = async () => {
      const intent: FactorResearchIntentV1 =
        effectiveMode === 'exploratory'
          ? { version: 1, mode: effectiveMode, expectedDirection: 'unknown' }
          : {
              version: 1,
              mode: effectiveMode,
              hypothesis: hypothesis.trim(),
              rationale: rationale.trim() || undefined,
              expectedDirection: direction,
              primaryCriterion: { metric, operator, value },
            };
      setOpen(false);
      await store.runAnalysis(intent);
    };

    return (
      <>
        <Button
          className={className}
          type="primary"
          size={size}
          disabled={disabled}
          loading={store.reportLoader.loading}
          onClick={() => setOpen(true)}
        >
          {children}
        </Button>
        <Modal
          className="jx-factor-researchModal"
          open={open}
          title={t('researchCardTitle')}
          okText={t('confirmRun')}
          cancelText={t('cancel')}
          okButtonProps={{ disabled: !valid }}
          onOk={submit}
          onCancel={() => setOpen(false)}
        >
          <div className="jx-factor-researchForm">
            {researchKind === 'macro_regime' ? (
              <Alert type="info" showIcon title={t('macroRegime.researchCardNotice')} />
            ) : (
              <Radio.Group value={mode} onChange={(event) => setMode(event.target.value)}>
                <Radio.Button value="hypothesis">{t('researchModeHypothesis')}</Radio.Button>
                <Radio.Button value="exploratory">{t('researchModeExploratory')}</Radio.Button>
              </Radio.Group>
            )}
            {effectiveMode === 'hypothesis' ? (
              <>
                <Input.TextArea
                  value={hypothesis}
                  maxLength={500}
                  showCount
                  placeholder={t('hypothesisPlaceholder')}
                  onChange={(event) => setHypothesis(event.target.value)}
                />
                <Input.TextArea
                  value={rationale}
                  maxLength={1000}
                  placeholder={t('rationalePlaceholder')}
                  onChange={(event) => setRationale(event.target.value)}
                />
                <div className="jx-factor-researchRow">
                  <Select
                    value={direction}
                    onChange={(next) => {
                      setDirection(next);
                      setOperator(next === 'negative' ? 'lt' : 'gt');
                    }}
                    options={[
                      { value: 'positive', label: t('directionPositive') },
                      { value: 'negative', label: t('directionNegative') },
                    ]}
                  />
                  <Select
                    value={metric}
                    onChange={(next) => {
                      setMetric(next);
                      setValue(
                        next === 'time_series_median_newey_west_t'
                          ? 1.96
                          : next === 'time_series_mean_direction_hit_rate'
                            ? 0.55
                            : next === 'panel_net_long_short_annualized'
                              ? 0.03
                              : next === 'rank_icir_annual'
                                ? 0.5
                                : 0.02,
                      );
                    }}
                    options={metricOptions}
                  />
                  <Select
                    value={operator}
                    onChange={setOperator}
                    options={[
                      { value: 'gt', label: '>' },
                      { value: 'lt', label: '<' },
                    ]}
                  />
                  <InputNumber value={value} step={0.01} onChange={(next) => setValue(next ?? 0)} />
                </div>
              </>
            ) : (
              <Alert type="info" showIcon title={t('exploratoryNotice')} />
            )}
          </div>
        </Modal>
      </>
    );
  },
  'ResearchRunButton',
);

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
                    <span className="jx-factor-historyPhase">
                      {t(
                        `phase.${report.phase}${report.phase === 'holdout' ? (report.sealed ? 'Sealed' : 'Revealed') : ''}`,
                      )}
                    </span>
                    {active && <FontAwesomeIcon icon={faCheck} />}
                  </span>
                  <span className="jx-factor-historyParams">{reportParamsLabel(report, t)}</span>
                  {report.metrics?.rankIc != null && (
                    <span className="jx-factor-historyMetric">
                      {t('historyRankIc', { value: report.metrics.rankIc.toFixed(4) })}
                    </span>
                  )}
                  {report.metrics?.medianNeweyWestT != null && (
                    <span className="jx-factor-historyMetric">
                      {t('historyMedianT', {
                        value: report.metrics.medianNeweyWestT.toFixed(2),
                      })}
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
        <ResearchRunButton>{t('rerun')}</ResearchRunButton>
      </div>
    );
  }
  const runPrompt = () => <Placeholder icon={faPlay} text={t('runPrompt')} />;
  if (loader.initial) {
    return runPrompt();
  }
  if (detail?.sealed) {
    return (
      <div className="jx-factor-sealed">
        <Placeholder icon={faLock} text={t('holdoutSealed')} />
        {detail.canReveal && (
          <Button
            type="primary"
            onClick={() =>
              modalConfirmReveal(t, () => {
                void store.revealHoldout();
              })
            }
          >
            {t('revealHoldout')}
          </Button>
        )}
      </div>
    );
  }
  return (
    <LoadingArea loader={loader} empty={runPrompt}>
      {() =>
        store.reportDetail?.analysisKind === 'macro_regime' ? (
          <MacroRegimeReportBody />
        ) : store.reportDetail?.analysisKind === 'panel' ? (
          <PanelReportBody />
        ) : store.reportDetail?.analysisKind === 'time_series' ? (
          <TimeSeriesReportBody />
        ) : (
          <ReportBody />
        )
      }
    </LoadingArea>
  );
}, 'FactorResult');

const MacroRegimeReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const report = store.macroRegimeReport;
  const researchSpec = store.reportDetail?.researchSpec;
  const spec =
    researchSpec?.analysisKind === 'macro_regime'
      ? (researchSpec as MacroRegimeFactorResearchSpecV1)
      : null;
  if (!report || !spec) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }

  return (
    <div className="jx-factor-timeReport" data-testid="macro-regime-report">
      <Alert type="info" showIcon title={t('macroRegime.reportNotice')} />
      <Alert
        data-testid="macro-regime-pit-status"
        type={report.pointInTimeEligible ? 'success' : 'warning'}
        showIcon
        title={t(
          report.pointInTimeEligible
            ? 'macroRegime.pointInTimeEligible'
            : 'macroRegime.pointInTimeIneligible',
          { rows: report.futureVintageRows },
        )}
      />
      <div className="jx-factor-timeAudit">
        <Metric label={t('macroRegime.researchType')} value={t('macroRegime.methodBadge')} />
        <Metric
          label={t('macroRegime.target')}
          value={t('macroRegime.targetValue', { horizon: spec.target.horizon })}
        />
        <Metric label={t('macroRegime.periods')} value={String(report.periods)} />
        <Metric
          label={t('macroRegime.observations')}
          value={report.observations.toLocaleString()}
        />
        <Metric label={t('macroRegime.transitions')} value={String(report.stateTransitions)} />
        <Metric label={t('macroRegime.skippedPeriods')} value={String(report.skippedPeriods)} />
        <Metric
          label={t('macroRegime.revisionPolicy')}
          value={t(
            report.revisionPolicy === 'as_available'
              ? 'macroRegime.asAvailable'
              : 'macroRegime.latestVintage',
          )}
        />
        <Metric
          label={t('timeSeries.dataCutoffLabel')}
          value={formatTradeDate(spec.dataPolicy.dataCutoff ?? spec.end)}
        />
      </div>

      <div className="jx-factor-sectionTitle">{t('macroRegime.stateEvidenceTitle')}</div>
      <div className="jx-factor-macroStates">
        {report.states.map((state) => (
          <section className="jx-factor-macroStateCard" key={state.key}>
            <div className="jx-factor-macroStateHead">
              <strong>{t(`macroRegime.states.${state.key}`)}</strong>
              <span>{pct(state.frequency)}</span>
            </div>
            <div className="jx-factor-macroStateMeta">
              <span>{t('macroRegime.statePeriods', { value: state.periods })}</span>
              <span>{t('macroRegime.stateEpisodes', { value: state.episodes })}</span>
              <span>
                {t('macroRegime.averageDuration', {
                  value: state.averageDurationPeriods?.toFixed(1) ?? '—',
                })}
              </span>
              <span>
                {t('macroRegime.maximumDuration', { value: state.maximumDurationPeriods })}
              </span>
            </div>
            <div className="jx-factor-macroAssets">
              {state.byAsset.map((asset) => (
                <div className="jx-factor-macroAsset" key={asset.assetId}>
                  <span className="jx-factor-macroAssetName">
                    <strong>{t(`timeSeries.assetNames.${asset.assetId}`)}</strong>
                    <small>{asset.assetId}</small>
                  </span>
                  <span>
                    <small>{t('macroRegime.meanForwardReturn')}</small>
                    <strong>{optionalPct(asset.meanForwardReturn)}</strong>
                  </span>
                  <span>
                    <small>{t('macroRegime.neweyWestT')}</small>
                    <strong>{optionalFixed(asset.neweyWestMeanTStat, 2)}</strong>
                  </span>
                  <span>
                    <small>{t('macroRegime.positiveRate')}</small>
                    <strong>{optionalPct(asset.positiveRate)}</strong>
                  </span>
                  <span>
                    <small>{t('macroRegime.laggedMeanReturn')}</small>
                    <strong>{optionalPct(asset.onePeriodLagMeanForwardReturn)}</strong>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="jx-factor-chartCap">{t('macroRegime.stateEvidenceCap')}</div>
    </div>
  );
}, 'MacroRegimeReportBody');

const TimeSeriesReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const report = store.timeSeriesReport;
  const researchSpec = store.reportDetail?.researchSpec;
  const spec =
    researchSpec?.analysisKind === 'time_series'
      ? (researchSpec as TimeSeriesFactorResearchSpecV1)
      : null;
  const isCommodityCarry =
    store.reportDetail?.factorCodeSnapshot?.includes('commodity.futures.annualizedLogCarry') ??
    false;
  const isCommodityWarehouse =
    store.reportDetail?.factorCodeSnapshot?.includes('commodity.warehouseReceipt.volume') ?? false;
  if (!report || !spec) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }
  return (
    <div className="jx-factor-timeReport" data-testid="time-series-report">
      {store.reportDetail?.phase === 'holdout' && store.reportDetail.revealedAt && (
        <Alert
          type={
            store.reportDetail.researchPayload &&
            factorResearchCriterionPassed(
              store.reportDetail.researchPayload,
              store.reportDetail.researchIntent,
            )
              ? 'success'
              : 'warning'
          }
          showIcon
          title={t(
            store.reportDetail.researchPayload &&
              factorResearchCriterionPassed(
                store.reportDetail.researchPayload,
                store.reportDetail.researchIntent,
              )
              ? 'holdoutCriterionPassed'
              : 'holdoutCriterionMissed',
            { time: dayjs(store.reportDetail.revealedAt).format('YYYY-MM-DD HH:mm') },
          )}
        />
      )}
      <Alert
        type="info"
        showIcon
        title={t(
          isCommodityCarry
            ? 'timeSeries.commodityCarryReportNotice'
            : isCommodityWarehouse
              ? 'timeSeries.commodityWarehouseReportNotice'
              : 'timeSeries.reportNotice',
        )}
      />
      {store.reportDetail?.factorCodeSnapshot?.includes('rates.cgb.yield.') && (
        <Alert
          type="info"
          showIcon
          title={t('timeSeries.curveSourceTitle')}
          description={t('timeSeries.curveSourceDescription')}
        />
      )}
      <div className="jx-factor-timeAudit">
        <Metric label={t('timeSeries.researchType')} value={t('timeSeries.methodBadge')} />
        <Metric
          label={t('timeSeries.target')}
          value={t('timeSeries.targetValue', { horizon: spec.target.horizon })}
        />
        <Metric label={t('timeSeries.assetCount')} value={String(report.assets.length)} />
        <Metric label={t('timeSeries.observations')} value={report.observations.toLocaleString()} />
        <Metric
          label={t('timeSeries.dataCutoffLabel')}
          value={formatTradeDate(spec.dataPolicy.dataCutoff ?? spec.end)}
        />
      </div>

      <FactorPublicationCard />

      <div className="jx-factor-sectionTitle">{t('timeSeries.comparisonTitle')}</div>
      <div className="jx-factor-timeAssetList">
        {report.byAsset.map((row) => (
          <div className="jx-factor-timeAssetCard" key={row.assetId}>
            <div className="jx-factor-timeAssetHead">
              <span>
                <strong>{t(`timeSeries.assetNames.${row.assetId}`)}</strong>
                <small>{row.assetId}</small>
              </span>
              <span>
                {t('timeSeries.observationValue', { value: row.observations.toLocaleString() })}
              </span>
            </div>
            <div className="jx-factor-timeAssetMetrics">
              <span>
                <small>{t('timeSeries.correlation')}</small>
                <strong>{row.correlation.toFixed(3)}</strong>
              </span>
              <span>
                <small>{t('timeSeries.slope')}</small>
                <strong>{row.regressionSlope.toFixed(4)}</strong>
              </span>
              <span>
                <small>{t('timeSeries.tStat')}</small>
                <strong>{row.neweyWestTStat.toFixed(2)}</strong>
                <em>{t('timeSeries.lagValue', { lag: row.neweyWestLag })}</em>
              </span>
              <span>
                <small>{t('timeSeries.hitRate')}</small>
                <strong>{pct(row.directionHitRate)}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="jx-factor-sectionTitle">{t('timeSeries.stateReturnsTitle')}</div>
      <Suspense fallback={<div className="jx-factor-chart" />}>
        <TimeSeriesStateChart report={report as FactorTimeSeriesReportV1} />
      </Suspense>
      <div className="jx-factor-chartCap">{t('timeSeries.stateChartCap')}</div>
    </div>
  );
}, 'TimeSeriesReportBody');

const PanelReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const report = store.panelReport;
  const researchSpec = store.reportDetail?.researchSpec;
  const spec =
    researchSpec?.analysisKind === 'panel' ? (researchSpec as PanelFactorResearchSpecV1) : null;
  const revealedHoldout =
    store.reportDetail?.phase === 'holdout' && !!store.reportDetail.revealedAt;
  const holdoutCriterionPassed =
    revealedHoldout && !!store.reportDetail?.researchPayload
      ? factorResearchCriterionPassed(
          store.reportDetail.researchPayload,
          store.reportDetail.researchIntent,
        )
      : false;
  const isCommodityCarry =
    store.reportDetail?.factorCodeSnapshot?.includes('commodity.futures.annualizedLogCarry') ??
    false;
  if (!report || !spec) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }
  return (
    <div className="jx-factor-timeReport" data-testid="panel-report">
      {revealedHoldout && (
        <Alert
          data-testid="panel-holdout-result"
          type={holdoutCriterionPassed ? 'success' : 'warning'}
          showIcon
          title={t(holdoutCriterionPassed ? 'holdoutCriterionPassed' : 'holdoutCriterionMissed', {
            time: dayjs(store.reportDetail.revealedAt).format('YYYY-MM-DD HH:mm'),
          })}
        />
      )}
      <Alert
        type="info"
        showIcon
        title={t(isCommodityCarry ? 'panel.commodityCarryReportNotice' : 'panel.reportNotice')}
      />
      <div className="jx-factor-timeAudit">
        <Metric label={t('panel.researchType')} value={t('panel.methodBadge')} />
        <Metric
          label={t('panel.target')}
          value={t('panel.targetValue', { horizon: spec.target.horizon })}
        />
        <Metric label={t('panel.periods')} value={String(report.periods)} />
        <Metric label={t('panel.observations')} value={report.observations.toLocaleString()} />
        <Metric
          label={t('timeSeries.dataCutoffLabel')}
          value={formatTradeDate(spec.dataPolicy.dataCutoff ?? spec.end)}
        />
      </div>

      <FactorPublicationCard />

      <div className="jx-factor-sectionTitle">{t('panel.evidenceTitle')}</div>
      <div className="jx-factor-timeAudit">
        <Metric label={t('panel.rankIcMean')} value={report.rankIcMean.toFixed(3)} />
        <Metric label={t('panel.rankIcir')} value={report.rankIcirAnnual.toFixed(2)} />
        <Metric label={t('panel.positiveRate')} value={pct(report.rankIcPositiveRate)} />
        <Metric label={t('panel.equalWeight')} value={pct(report.equalWeightAnnualized)} />
        <Metric label={t('panel.netLongShort')} value={pct(report.longShortNetAnnualized)} />
        <Metric label={t('panel.turnover')} value={pct(report.averageOneWayTurnover)} />
      </div>

      {report.normalizationDiagnostics && (
        <>
          <div className="jx-factor-sectionTitle">{t('panel.normalizationTitle')}</div>
          <Alert type="info" showIcon title={t('panel.normalizationNotice')} />
          <div className="jx-factor-timeAudit" data-testid="panel-normalization-diagnostics">
            <Metric
              label={t('panel.withinClassRankIc')}
              value={
                report.normalizationDiagnostics.withinClassRankIcMean == null
                  ? '—'
                  : report.normalizationDiagnostics.withinClassRankIcMean.toFixed(3)
              }
            />
            <Metric
              label={t('panel.withinClassComparisons')}
              value={String(report.normalizationDiagnostics.withinClassComparisons)}
            />
            <Metric
              label={t('panel.betweenClassRankIc')}
              value={
                report.normalizationDiagnostics.betweenClassRankIcMean == null
                  ? '—'
                  : report.normalizationDiagnostics.betweenClassRankIcMean.toFixed(3)
              }
            />
            <Metric
              label={t('panel.betweenClassPeriods')}
              value={String(report.normalizationDiagnostics.betweenClassPeriods)}
            />
            <Metric
              label={t('panel.betweenClassNet')}
              value={pct(report.normalizationDiagnostics.betweenClassLongShortNetAnnualized)}
            />
            <Metric
              label={t('panel.betweenClassTurnover')}
              value={pct(report.normalizationDiagnostics.betweenClassAverageOneWayTurnover)}
            />
          </div>
          <div className="jx-factor-sectionTitle">{t('panel.classDiagnosticsTitle')}</div>
          <div className="jx-factor-timeAssetList">
            {report.byAssetClass.map((row) => (
              <div className="jx-factor-timeAssetCard" key={row.assetClass}>
                <div className="jx-factor-timeAssetHead">
                  <strong>{t(`panel.assetClasses.${row.assetClass}`)}</strong>
                </div>
                <div className="jx-factor-timeAssetMetrics">
                  <span>
                    <small>{t('panel.meanForwardReturn')}</small>
                    <strong>{pct(row.meanForwardReturn)}</strong>
                  </span>
                  <span>
                    <small>{t('panel.topSelectionRate')}</small>
                    <strong>
                      {pct(row.observations ? row.topSelections / row.observations : 0)}
                    </strong>
                  </span>
                  <span>
                    <small>{t('panel.bottomSelectionRate')}</small>
                    <strong>
                      {pct(row.observations ? row.bottomSelections / row.observations : 0)}
                    </strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="jx-factor-sectionTitle">{t('panel.coverageTitle')}</div>
      <div className="jx-factor-timeAssetList">
        {report.coverage.byAsset.map((row) => (
          <div className="jx-factor-timeAssetCard" key={row.assetId}>
            <div className="jx-factor-timeAssetHead">
              <span>
                <strong>{t(`panel.assetNames.${row.assetId}`)}</strong>
                <small>{row.assetId}</small>
              </span>
              <Tag>{t(`panel.assetClasses.${row.assetClass}`)}</Tag>
            </div>
            <div className="jx-factor-timeAssetMetrics">
              <span>
                <small>{t('panel.observations')}</small>
                <strong>{row.observations}</strong>
              </span>
              <span>
                <small>{t('panel.firstObservation')}</small>
                <strong>{row.firstAsOfDate ? formatTradeDate(row.firstAsOfDate) : '—'}</strong>
              </span>
              <span>
                <small>{t('panel.lastObservation')}</small>
                <strong>{row.lastAsOfDate ? formatTradeDate(row.lastAsOfDate) : '—'}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="jx-factor-chartCap">
        {t('panel.coverageCap', {
          min: report.coverage.minimumAssets,
          median: report.coverage.medianAssets,
          skipped: report.skippedPeriods,
        })}
      </div>
    </div>
  );
}, 'PanelReportBody');

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
      {store.reportDetail?.phase === 'holdout' && store.reportDetail.revealedAt && (
        <Alert
          type={criterionPassed(r, store.reportDetail.researchIntent) ? 'success' : 'warning'}
          showIcon
          title={t(
            criterionPassed(r, store.reportDetail.researchIntent)
              ? 'holdoutCriterionPassed'
              : 'holdoutCriterionMissed',
            { time: dayjs(store.reportDetail.revealedAt).format('YYYY-MM-DD HH:mm') },
          )}
        />
      )}
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

      <MethodologyCard />
      <FactorPublicationCard />

      {r.diagnostics?.length ? (
        <div className="jx-factor-diagnostics">
          <div className="jx-factor-sectionTitle">{t('diagnosticsTitle')}</div>
          <div className="jx-factor-diagnosticsTableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('diagnosticsSlice')}</th>
                  <th>{t('diagnosticsPeriods')}</th>
                  <th>{t('diagnosticsObservations')}</th>
                  <th>{t('diagnosticsIc')}</th>
                  <th>{t('diagnosticsIcir')}</th>
                  <th>{t('diagnosticsPositive')}</th>
                </tr>
              </thead>
              <tbody>
                {r.diagnostics.map((slice) => (
                  <tr key={`${slice.dimension}:${slice.key}`}>
                    <td>
                      {t('diagnosticsSliceLabel', {
                        dimension: t(`evaluationDiagnostics.${slice.dimension}`),
                        key: t(`diagnosticKey.${slice.key}`, { defaultValue: slice.key }),
                      })}
                    </td>
                    <td>{slice.periods}</td>
                    <td>{slice.observations.toLocaleString()}</td>
                    <td>{slice.rankIcMean.toFixed(3)}</td>
                    <td>{slice.rankIcirAnnual.toFixed(2)}</td>
                    <td>{pct(slice.rankIcPositiveRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="jx-factor-chartCap">{t('diagnosticsCap')}</div>
        </div>
      ) : null}

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

      {r.robustInference && (
        <RobustInferenceCard inference={r.robustInference} useMktcap={useMktcap} />
      )}

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

function RobustInferenceCard({
  inference,
  useMktcap,
}: {
  inference: NonNullable<FactorReport['robustInference']>;
  useMktcap: boolean;
}) {
  const { t } = useTranslation('factor');
  const gross = useMktcap ? inference.longShort.mktcapGross : inference.longShort.equalGross;
  const net = useMktcap ? inference.longShort.mktcapNet : inference.longShort.equalNet;
  const famaMacbeth = inference.famaMacbeth;
  const rows: Array<{
    key: string;
    label: string;
    estimate?: FactorNeweyWestEstimateV1;
    percent: boolean;
  }> = [
    { key: 'rank-ic', label: t('robustRankIc'), estimate: inference.rankIc, percent: false },
    { key: 'gross', label: t('robustLongShortGross'), estimate: gross, percent: true },
    { key: 'net', label: t('robustLongShortNet'), estimate: net, percent: true },
    {
      key: 'fama-macbeth',
      label: t('robustFamaMacbethCoefficient'),
      estimate: famaMacbeth.candidateCoefficient,
      percent: true,
    },
  ];
  const formatEstimate = (value: number, percent: boolean) =>
    percent ? pct(value) : value.toFixed(4);

  return (
    <div className="jx-factor-robust" data-testid="factor-robust-inference">
      <div className="jx-factor-sectionTitle">{t('robustInferenceTitle')}</div>
      <div className="jx-factor-robustTableWrap">
        <table>
          <thead>
            <tr>
              <th>{t('robustMetric')}</th>
              <th>{t('robustEstimate')}</th>
              <th>{t('robustTStatistic')}</th>
              <th>{t('robustConfidenceInterval')}</th>
              <th>{t('robustObservationsLag')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {row.estimate ? (
                  <>
                    <td>{formatEstimate(row.estimate.estimate, row.percent)}</td>
                    <td>{row.estimate.tStatistic.toFixed(2)}</td>
                    <td>
                      {formatEstimate(row.estimate.confidenceInterval.lower, row.percent)} –{' '}
                      {formatEstimate(row.estimate.confidenceInterval.upper, row.percent)}
                    </td>
                    <td>
                      {row.estimate.observations} / {row.estimate.lag}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="jx-factor-robustUnavailable">
                    {row.key === 'fama-macbeth'
                      ? t(
                          `robustUnavailable.${famaMacbeth.unavailableReason ?? 'insufficient_periods'}`,
                        )
                      : t('notAvailable')}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="jx-factor-chartCap">
        {t('robustInferenceCap', {
          weighting: t(useMktcap ? 'weightMktcap' : 'weightEqual'),
          periods: famaMacbeth.periodsEstimated,
          considered: famaMacbeth.periodsConsidered,
          observations: Math.round(famaMacbeth.averageObservations),
        })}
      </div>
      <div className="jx-factor-chartCap">{t('robustControlsCap')}</div>
    </div>
  );
}

const MethodologyCard = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const detail = store.reportDetail;
  const methodology = store.report?.methodology;
  if (!detail || !methodology) {
    return null;
  }
  const spec = detail.spec;
  const stageLabels: Record<FactorSampleStageKey, string> = {
    factor_value: t('stageFactorValue'),
    formation_and_forward_quote: t('stageQuotes'),
    evaluation_universe: t('stageEvaluationUniverse'),
    ranking_scope: t('stageRankingScope'),
    listing_age: t('stageListingAge'),
    risk_warning: t('stageRiskWarning'),
    pending_delisting: t('stagePendingDelisting'),
    liquidity: t('stageLiquidity'),
  };
  const unavailable = methodology.unavailableHistoricalFilters.map((key) =>
    t(`unavailableFilter.${key}`),
  );

  return (
    <div className="jx-factor-methodology">
      <div className="jx-factor-methodologyHead">
        <span>{t('methodologyTitle')}</span>
        <code>v{methodology.specVersion}</code>
      </div>
      <div className="jx-factor-methodologyMeta">
        <span>{t('dataCutoff', { date: formatTradeDate(methodology.dataCutoff) })}</span>
        <span>
          {t('reproducibilityHash', {
            hash: detail.factorCodeHash?.slice(0, 12) ?? t('notAvailable'),
          })}
        </span>
        <span>
          {t('periodCoverage', {
            analyzed: methodology.periodsAnalyzed,
            considered: methodology.periodsConsidered,
          })}
        </span>
      </div>
      <div className="jx-factor-methodologyStages">
        {methodology.stages.map((stage) => (
          <span key={stage.key}>
            {stageLabels[stage.key]} <b>{stage.before.toLocaleString()}</b> →{' '}
            <b>{stage.after.toLocaleString()}</b>
          </span>
        ))}
      </div>
      {spec.version !== 1 && (
        <div className="jx-factor-methodologySpec">
          {(spec.version === 5 || spec.version === 6) && (
            <>
              <span>
                {t('evaluationUniverseSpec', {
                  universe: t(
                    `evaluationUniverse.${
                      spec.evaluationScope.universe.kind === 'market'
                        ? 'cn_a'
                        : spec.evaluationScope.universe.indexCode
                    }`,
                  ),
                })}
              </span>
              <span>
                {t('evaluationRankingSpec', {
                  ranking: t(`evaluationRanking.${spec.evaluationScope.rankingScope}`),
                })}
              </span>
              {methodology.ranking?.kind === 'within_industry_percentile' && (
                <span>
                  {t('evaluationRankingAudit', {
                    groups: methodology.ranking.groupsEvaluated,
                    missing: methodology.ranking.missingClassification,
                    small: methodology.ranking.undersizedGroup,
                    minimum: methodology.ranking.minimumGroupSize,
                  })}
                </span>
              )}
            </>
          )}
          <span>
            {t('universeSpec', {
              days: spec.universe.minimumListingDays,
              liquidity: Math.round(spec.universe.liquidityDropFraction * 100),
              candidates: spec.universe.minimumCandidates,
            })}
          </span>
          <span>
            {t('outlierSpec', {
              exposure: t(`outlier.${spec.outliers.factorExposure.method}`),
              returns: t(`outlier.${spec.outliers.forwardReturn.method}`),
            })}
          </span>
          <span>
            {t('costSpec', {
              commission: (spec.costs.commissionPerSide * 10000).toFixed(1),
              stamp: (spec.costs.stampDutySellSide * 10000).toFixed(1),
              slippage: (spec.costs.slippagePerSide * 10000).toFixed(1),
            })}
          </span>
          {'excludeRiskWarnings' in spec.universe && (
            <span>
              {t('historicalStatusSpec', {
                risk: spec.universe.excludeRiskWarnings ? t('enabled') : t('disabled'),
                delisting: spec.universe.excludePendingDelisting ? t('enabled') : t('disabled'),
              })}
            </span>
          )}
          {(spec.version === 4 || (spec.version === 6 && spec.composite)) && (
            <span>
              {t('compositeMethodologySpec', {
                count: spec.composite.components.length,
                standardization: t(`compositeStandardization.${spec.composite.standardization}`),
              })}
            </span>
          )}
        </div>
      )}
      {methodology.windowCoverage && (
        <div className="jx-factor-methodologyCoverage">
          {t('windowCoverageAudit', {
            window: methodology.windowCoverage.declaredWindowDays,
            minimum: pctInt(methodology.windowCoverage.minimumCoverage),
            mean: pctInt(methodology.windowCoverage.meanCoverage),
            dropped: methodology.windowCoverage.droppedForCoverage,
          })}
        </div>
      )}
      {unavailable.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={t('historicalFiltersUnavailable', { filters: unavailable.join('、') })}
        />
      )}
    </div>
  );
}, 'MethodologyCard');

const FactorPublicationCard = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const { message, modal } = App.useApp();
  const detail = store.reportDetail;
  if (!detail) {
    return null;
  }
  if (store.selected?.builtin && !store.selected.strategyKey) {
    return null;
  }
  const ownedFactor =
    store.mode === 'custom' ||
    (store.mode === 'composite' && store.compositeDefinition?.version === 2);
  if (!store.factorKey && !ownedFactor) {
    return null;
  }

  const publish = () => {
    modal.confirm({
      title: t('publication.publishTitle'),
      content: t('publication.publishContent', { key: store.factorKey }),
      okText: t('publication.publish'),
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await store.publishSelectedReport();
          message.success(t('publication.published'));
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('publication.publishFailed'));
          throw error;
        }
      },
    });
  };
  const archive = () => {
    modal.confirm({
      title: t('publication.archiveTitle'),
      content: t('publication.archiveContent'),
      okText: t('publication.archive'),
      okButtonProps: { danger: true },
      cancelText: t('cancel'),
      onOk: async () => {
        try {
          await store.archiveSelected();
          message.success(t('publication.archived'));
        } catch (error) {
          message.error(error instanceof Error ? error.message : t('publication.archiveFailed'));
          throw error;
        }
      },
    });
  };

  return (
    <div className="jx-factor-publication" data-testid="factor-publication-card">
      <div className="jx-factor-publicationHead">
        <div>
          <div className="jx-factor-publicationTitle">{t('publication.title')}</div>
          <div className="jx-factor-publicationHint">
            {t(`publication.hint.${store.factorStatus}`)}
          </div>
        </div>
        <div className="jx-factor-publicationActions">
          {store.factorStatus === 'draft' && ownedFactor ? (
            <Button
              size="small"
              type="primary"
              icon={<FontAwesomeIcon icon={faLock} />}
              loading={store.publishLoader.loading}
              disabled={
                detail.status !== 'done' || store.reportOutdated || store.sending || store.edited
              }
              onClick={publish}
              data-testid="factor-publish"
            >
              {t('publication.publish')}
            </Button>
          ) : (
            <>
              {store.factorStatus === 'published' && (
                <Button
                  size="small"
                  href={`/lab?new=1&factorKey=${encodeURIComponent(store.factorKey)}`}
                  data-testid="factor-use-in-lab"
                >
                  {t('publication.useInLab')}
                </Button>
              )}
              <Button
                size="small"
                icon={<FontAwesomeIcon icon={faCopy} />}
                onClick={() => void store.copySelected()}
              >
                {t('copy')}
              </Button>
              {store.factorStatus === 'published' && ownedFactor && (
                <Button size="small" danger loading={store.archiveLoader.loading} onClick={archive}>
                  {t('publication.archive')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="jx-factor-publicationLineage">
        <code>{store.factorKey}</code>
        <span>←</span>
        <code>{t('publication.reportRef', { id: detail.id.slice(-8) })}</code>
        <span>·</span>
        <code>{t('publication.codeRef', { hash: detail.factorCodeHash?.slice(0, 12) })}</code>
      </div>
      {store.factorStatus === 'draft' && store.reportOutdated && (
        <Alert type="warning" showIcon title={t('publication.outdated')} />
      )}
    </div>
  );
}, 'FactorPublicationCard');

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
  if (report.researchSpec.analysisKind === 'time_series') {
    const spec = report.researchSpec;
    return t('timeSeries.historyParams', {
      assets: spec.assets.length,
      horizon: spec.target.horizon,
      start: dayjs(spec.start, 'YYYYMMDD').format('YYYY-MM-DD'),
      end: dayjs(spec.end, 'YYYYMMDD').format('YYYY-MM-DD'),
    });
  }
  if (report.researchSpec.analysisKind === 'panel') {
    const spec = report.researchSpec;
    return t('panel.historyParams', {
      assets: spec.assets.length,
      horizon: spec.target.horizon,
      start: dayjs(spec.start, 'YYYYMMDD').format('YYYY-MM-DD'),
      end: dayjs(spec.end, 'YYYYMMDD').format('YYYY-MM-DD'),
    });
  }
  if (report.researchSpec.analysisKind === 'macro_regime') {
    const spec = report.researchSpec;
    return t('macroRegime.historyParams', {
      assets: spec.targetAssets.length,
      horizon: spec.target.horizon,
      start: dayjs(spec.start, 'YYYYMMDD').format('YYYY-MM-DD'),
      end: dayjs(spec.end, 'YYYYMMDD').format('YYYY-MM-DD'),
    });
  }
  const spec = report.spec;
  if (!spec) {
    return t('timeSeries.unsupportedReport');
  }
  const frequency = t(spec.freq === 'week' ? 'unitWeek' : 'unitMonth');
  const neutral = t(
    spec.neutral === 'size'
      ? 'neutralSize'
      : spec.neutral === 'size_industry'
        ? 'neutralSizeIndustry'
        : 'neutralNone',
  );
  const universe =
    spec.version === 5 || spec.version === 6
      ? t(
          `evaluationUniverse.${
            spec.evaluationScope.universe.kind === 'market'
              ? 'cn_a'
              : spec.evaluationScope.universe.indexCode
          }`,
        )
      : t('evaluationUniverse.cn_a');
  const ranking =
    spec.version === 5 || spec.version === 6
      ? t(`evaluationRanking.${spec.evaluationScope.rankingScope}`)
      : t('evaluationRanking.global');
  return `${frequency} · ${dayjs(spec.start, 'YYYYMMDD').format('YYYY-MM-DD')} – ${dayjs(spec.end, 'YYYYMMDD').format('YYYY-MM-DD')} · ${universe} · ${ranking} · ${neutral}`;
}

// Cursor-style chat input — Enter sends, Shift+Enter newline, IME-safe.
function PromptBox({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
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
      disabled={disabled}
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
function compositeComponents(
  factors: FactorMeta[],
  analysisKind: 'cross_sectional' | 'panel',
): FactorMeta[] {
  return factors.filter(
    (factor) =>
      factor.kind !== 'composite' &&
      !(analysisKind === 'panel' && factor.builtin && !factor.strategyKey) &&
      (analysisKind === 'panel'
        ? factor.analysisKind === 'panel'
        : factor.analysisKind !== 'time_series' && factor.analysisKind !== 'panel'),
  );
}

function emptyCompositeDefinition(
  factors: FactorMeta[],
  analysisKind: 'cross_sectional' | 'panel',
): FactorCompositeDefinition {
  const available = compositeComponents(factors, analysisKind);
  const components = available.slice(0, 2).map((factor) => ({
    factor: factor.key,
    direction: factor.expectedDirection ?? ('positive' as const),
  }));
  while (components.length < 2) {
    components.push({ factor: '', direction: 'positive' });
  }
  return analysisKind === 'panel'
    ? {
        version: 2,
        key: '',
        name: '',
        analysisKind: 'panel',
        standardization: 'rank',
        weighting: 'equal',
        components,
      }
    : {
        version: 1,
        name: '',
        standardization: 'rank',
        weighting: 'equal',
        components,
      };
}

const KIND_KEY: Record<FactorKind, string> = {
  price: 'kindPrice',
  fundamental: 'kindFundamental',
  moneyflow: 'kindMoneyflow',
  rates: 'kindRates',
  commodity: 'kindCommodity',
  macro: 'kindMacro',
  custom: 'kindCustom',
  composite: 'kindComposite',
};

function factorV2Inputs(source: string): string[] {
  const declaration = source.match(/\binputs\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...declaration.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function timeSeriesInputLabel(input: string, t: TFunction<'factor'>): string {
  const keys: Record<string, string> = {
    'etf.adjustedClose': 'timeSeries.inputFields.etfAdjustedClose',
    'rates.cgb.yield.2y': 'timeSeries.inputFields.cgbYield2y',
    'rates.cgb.yield.5y': 'timeSeries.inputFields.cgbYield5y',
    'rates.cgb.yield.10y': 'timeSeries.inputFields.cgbYield10y',
    'rates.cgb.yield.30y': 'timeSeries.inputFields.cgbYield30y',
    'commodity.futures.annualizedLogCarry': 'timeSeries.inputFields.commodityAnnualizedCarry',
    'commodity.warehouseReceipt.volume': 'timeSeries.inputFields.commodityWarehouseReceiptVolume',
  };
  return t(keys[input] ?? 'timeSeries.inputFields.unknown');
}

// Display name for a catalog item: a built-in preset shows its localized name (keyed by slug); a custom
// factor keeps the user-given name unchanged.
function factorDisplayName(factor: FactorMeta): string {
  return factor.builtin && i18n.exists(`factor:builtin.${factor.key}`)
    ? i18n.t(`factor:builtin.${factor.key}`)
    : factor.label;
}

function formatTradeDate(value: string): string {
  return dayjs(value, 'YYYYMMDD').format('YYYY-MM-DD');
}

function modalConfirmReveal(t: TFunction<'factor'>, onOk: () => void): void {
  Modal.confirm({
    title: t('revealConfirmTitle'),
    content: t('revealConfirmContent'),
    okText: t('revealHoldout'),
    cancelText: t('cancel'),
    onOk,
  });
}

function criterionPassed(report: FactorReport, intent?: FactorResearchIntentV1): boolean {
  const criterion = intent?.primaryCriterion;
  if (!criterion) {
    return false;
  }
  const metric = {
    rank_ic_mean: report.icMean,
    rank_icir_annual: report.icirAnnual,
    net_long_short_annualized: report.longShortNet?.annReturn ?? Number.NaN,
    time_series_median_newey_west_t: Number.NaN,
    time_series_mean_direction_hit_rate: Number.NaN,
    panel_rank_ic_mean: Number.NaN,
    panel_net_long_short_annualized: Number.NaN,
  }[criterion.metric];
  return criterion.operator === 'gt' ? metric > criterion.value : metric < criterion.value;
}

function criterionMetricLabel(t: TFunction, metric: FactorResearchMetric): string {
  const labelKey: Record<FactorResearchMetric, string> = {
    rank_ic_mean: 'criterionRankIc',
    rank_icir_annual: 'criterionIcir',
    net_long_short_annualized: 'criterionNetLs',
    time_series_median_newey_west_t: 'criterionTimeSeriesMedianT',
    time_series_mean_direction_hit_rate: 'criterionTimeSeriesMeanHitRate',
    panel_rank_ic_mean: 'criterionPanelRankIc',
    panel_net_long_short_annualized: 'criterionPanelNetLs',
  };

  return t(labelKey[metric]);
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pctInt = (v: number) => `${(v * 100).toFixed(0)}%`;
const optionalPct = (value: number | null) => (value == null ? '—' : pct(value));
const optionalFixed = (value: number | null, digits: number) =>
  value == null ? '—' : value.toFixed(digits);

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
