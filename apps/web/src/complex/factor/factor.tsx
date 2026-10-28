import type { ResearchDataReferenceV1 } from '@jixie/shared';
import { EmbeddedAnalysisToolbar } from '@src/components/embedded-analysis/embedded-analysis-toolbar';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
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
  IcDecayPoint,
  FactorWeight,
  FactorOutlierMethod,
  FactorSampleStageKey,
  FactorAnalysisKind,
  FactorNeweyWestEstimateV1,
  FactorTimeSeriesReportV1,
  PanelFactorResearchSpecV1,
  TimeSeriesFactorResearchSpecV1,
} from '@jixie/shared';
import {
  faSpinner,
  faPlay,
  faLock,
  faPlus,
  faTrash,
  faCopy,
  faEllipsis,
  faClockRotateLeft,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { MessageParts } from '@src/components/message-parts';
import { FactorQuestionContext } from './factor-question-context';
import { ToolTrace } from '@src/components/tool-trace';
import { AgentPending } from '@src/components/agent-pending';
import { AgentTrace } from '@src/components/agent-trace';
import type { AgentTurnStream } from '@src/components/agent-turn-stream';
import type { AgentToolTraceItem } from '@src/api/agent';
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
const FactorEditor = lazy(() => import('./factor-editor'));
const TimeSeriesStateChart = lazy(() => import('./time-series-state-chart'));

type GuardDiscard = (action: () => void) => void;
type EditableFactorAnalysisKind = Extract<
  FactorAnalysisKind,
  'cross_sectional' | 'time_series' | 'panel'
>;

/**
 * 整合因子目录、编辑器、研究参数、报告和 Agent 面板，形成完整工作台。
 *
 * Compose the factor catalog, editor, research settings, reports and agent workspace.
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

/**
 * 展示因子作者或只读问答面板，连接持久会话与当前上下文。
 *
 * Render factor authoring or read-only Q&A with persistent conversations and context.
 */
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

/**
 * 按因子种类和语言收集创建输入，再交由 store 创建草稿。
 *
 * Collect factor kind and language before creating a draft through the store.
 */
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

    /**
     * 校验因子创建表单并先创建持久化草稿。
     *
     * Validate the factor form and create its persisted draft.
     */
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

/**
 * 渲染因子消息、问答上下文及输入状态，协调发送与重连。
 *
 * Render factor messages, Q&A context and input state with send and reconnect controls.
 */
const AgentChat = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const qa = store.qaMode;
  const [includeReport, setIncludeReport] = useState(true);
  const [references, setReferences] = useState<ResearchDataReferenceV1[]>([]);
  useEffect(() => {
    setReferences([]);
    setIncludeReport(true);
  }, [store.selectedKey]);
  const reportId =
    store.reportLoader.result?.status === 'done' ? store.selectedReportId : undefined;
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
      {qa && (
        <div className="jx-factorQuestion-toolbar">
          <span>{t('questions.privateHistory')}</span>
          {reportId && (
            <Radio.Group
              value={includeReport}
              onChange={(event) => setIncludeReport(event.target.value)}
              options={[
                { label: t('questions.selectedReport'), value: true },
                { label: t('questions.definitionOnly'), value: false },
              ]}
            />
          )}
          {includeReport && reportId && (
            <span>{t('questions.report', { id: store.selectedReportId })}</span>
          )}
          {store.questionsLoader.loading && <span>{t('questions.loading')}</span>}
          {(store.questionsLoader.error || store.questionStreamError) && (
            <>
              <Alert
                type="warning"
                showIcon
                message={store.questionsLoader.errorObject?.message ?? store.questionStreamError}
              />
              <Button
                size="small"
                loading={store.questionsLoader.loading}
                onClick={() => void store.restoreQuestions()}
              >
                {t('questions.reconnect')}
              </Button>
            </>
          )}
          {store.questionSubmitLoader.error && (
            <Alert
              type="warning"
              showIcon
              message={store.questionSubmitLoader.errorObject?.message}
            />
          )}
          {store.questionNextBefore !== null && (
            <Button
              size="small"
              loading={store.earlierQuestionsLoader.loading}
              onClick={() => void store.loadEarlierQuestions()}
            >
              {t('questions.loadEarlier')}
            </Button>
          )}
          {store.earlierQuestionsLoader.error && (
            <Alert type="warning" message={store.earlierQuestionsLoader.errorObject?.message} />
          )}
        </div>
      )}
      <ChatLog
        currentCode={store.code}
        currentLanguage={store.language}
        onAcceptCodeChange={(proposal) => store.acceptCodeChange(proposal)}
        codeChangeBusy={store.codeChangeLoader.loading}
        codeChangeError={store.codeChangeLoader.errorObject?.message}
        messages={store.chatMessages}
        selectedReportId={store.selectedReportId}
        sending={store.sending}
        emptyKey={
          qa
            ? store.isPanel
              ? 'panel.chatEmpty'
              : store.isTimeSeries
                ? store.selected?.kind === 'commodity'
                  ? store.selectedKey === 'commodity_warehouse_pressure_20'
                    ? 'timeSeries.commodityWarehouseChatEmpty'
                    : 'timeSeries.commodityCarryChatEmpty'
                  : 'timeSeries.chatEmpty'
                : 'chatEmptyQa'
            : store.isPanel
              ? 'panel.chatEmptyAuthor'
              : store.isTimeSeries
                ? 'timeSeries.chatEmptyAuthor'
                : 'chatEmptyAuthor'
        }
        stream={store.turnStream}
      />
      <div className="jx-factor-chatInput">
        <EmbeddedAnalysisToolbar
          key={store.selectedKey}
          host={store.selectedKey ? { type: 'factor', id: store.selectedKey } : undefined}
          reportId={reportId}
          includeReport={includeReport}
          onIncludeReportChange={qa ? undefined : setIncludeReport}
          references={references}
          onReferencesChange={setReferences}
          disabled={store.sending}
        />
        <PromptBox
          value={store.nlText}
          onChange={(v) => store.setNlText(v)}
          onSubmit={() => void store.sendAgent(store.nlText, includeReport, references)}
          disabled={qa ? !store.questionsLoader.loaded || store.sending : !store.selectedKey}
          placeholder={t(
            qa
              ? store.isPanel
                ? 'panel.placeholderQa'
                : store.isTimeSeries
                  ? 'timeSeries.placeholderQa'
                  : 'placeholderQa'
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

/**
 * 渲染因子会话消息与工具产物，保持流式和持久消息一致。
 *
 * Render factor messages and tool artifacts consistently across streamed and persisted history.
 */
function ChatLog({
  currentCode,
  currentLanguage,
  onAcceptCodeChange,
  codeChangeBusy,
  codeChangeError,
  messages,
  sending,
  emptyKey,
  stream,
  selectedReportId,
}: {
  currentCode: string;
  currentLanguage: 'typescript' | 'python';
  onAcceptCodeChange: (proposal: import('@jixie/shared').CodeChangeProposalV1) => Promise<void>;
  codeChangeBusy: boolean;
  codeChangeError?: string;
  messages: ChatMessage[];
  sending: boolean;
  emptyKey:
    | 'chatEmptyQa'
    | 'chatEmptyAuthor'
    | 'timeSeries.chatEmpty'
    | 'timeSeries.commodityCarryChatEmpty'
    | 'timeSeries.commodityWarehouseChatEmpty'
    | 'timeSeries.chatEmptyAuthor'
    | 'panel.chatEmpty'
    | 'panel.chatEmptyAuthor';
  stream: AgentTurnStream;
  selectedReportId: string;
}) {
  const { t } = useTranslation('factor');
  const ref = useRef<HTMLDivElement>(null);
  const scrollState = useRef({ height: 0, lastId: '' });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const lastId = messages.at(-1)?.id ?? String(messages.length);
      if (scrollState.current.lastId === lastId && el.scrollHeight > scrollState.current.height) {
        el.scrollTop += el.scrollHeight - scrollState.current.height;
      } else {
        el.scrollTop = el.scrollHeight;
      }
      scrollState.current = { height: el.scrollHeight, lastId };
    }
  }, [messages, sending]);
  return (
    <div ref={ref} className="jx-factor-chatLog">
      {messages.length === 0 && !sending && (
        <div className="jx-factor-chatEmpty">{t(emptyKey)}</div>
      )}
      {messages.map((message, index) => (
        <div
          key={message.id ?? index}
          className={classNames('jx-factor-bubble', `jx-factor-bubble--${message.role}`)}
        >
          {message.role === 'assistant' && message.turnId ? (
            <AgentTrace turnId={message.turnId} />
          ) : (
            traceOf(message) && <ToolTrace trace={traceOf(message)!} />
          )}
          <FactorQuestionContext message={message} selectedReportId={selectedReportId} />
          <MessageParts
            message={message}
            currentCode={currentCode}
            currentCodeLanguage={currentLanguage}
            onAcceptCodeChange={onAcceptCodeChange}
            codeChangeBusy={codeChangeBusy}
            codeChangeError={codeChangeError}
          />
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

/**
 * 组织预置及作者因子选择，协调筛选与未保存切换。
 *
 * Organize builtin and authored factor selection with filtering and draft guards.
 */
const FactorLibrary = complex.component(
  ({ onPickCustom, guardDiscard }: { onPickCustom: () => void; guardDiscard: GuardDiscard }) => {
    const store = complex.useStore();
    const { t } = useTranslation('factor');
    const { modal } = App.useApp();
    const list = store.catalogLoader.result ?? [];
    const presets = list.filter(
      (f) => f.kind !== 'custom' && f.analysisKind !== 'time_series' && f.analysisKind !== 'panel',
    );
    const timeSeries = list.filter((f) => f.kind !== 'custom' && f.analysisKind === 'time_series');
    const panel = list.filter((f) => f.kind !== 'custom' && f.analysisKind === 'panel');
    const custom = list.filter((f) => f.kind === 'custom');

    // A custom factor → jump to Agent (edit/chat); a preset stays here (select → analyze, no code).

    /**
     * 协调因子切换及未保存草稿确认，供目录选择。
     *
     * Coordinate factor selection with unsaved-draft guards.
     */
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

// Middle column: the Monaco editor over a collapsible log dock. A preset is a seeded READ-ONLY code
// row — shown in the same editor with a lock bar + copy-as-custom (fork), instead of being hidden.

/**
 * 根据因子种类选择对应研究工作区，保持编辑和报告布局一致。
 *
 * Select the appropriate factor research workspace while keeping editor and report layout consistent.
 */
const MiddleColumn = complex.component(({ guardDiscard }: { guardDiscard: GuardDiscard }) => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const preset = store.mode === 'preset';
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
          <div className="jx-factor-code">
            <Suspense fallback={<div className="jx-factor-codeEmpty">{t('editorLoading')}</div>}>
              <FactorEditor
                value={store.code}
                onChange={(v) => store.setCode(v)}
                language={store.language}
                documentId={store.selectedKey || 'factor'}
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

/**
 * 展示单资产时间序列因子的代码、参数和探索结果。
 *
 * Present single-asset factor source, research settings and exploration results.
 */
const TimeSeriesWorkspace = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const editable = store.mode === 'custom' && store.factorStatus === 'draft';
  const window = store.code.match(/\bwindow\s*[:=]\s*(\d+)/)?.[1] ?? '—';
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
            <Tag color="blue">
              {store.language === 'python' ? 'Python · py-v1' : 'Factor Definition V2'}
            </Tag>
          </div>
          {editable && store.selectedKey && <FactorIdentityBar />}
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
                language={store.language}
                documentId={store.selectedKey || 'factor'}
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

/**
 * 展示当前因子身份与状态，供工作台定位。
 *
 * Present the selected factor's identity and status.
 */
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
      <Tag color={store.language === 'python' ? 'blue' : undefined}>
        {store.language === 'python' ? 'Python · py-v1' : 'TypeScript · ts-v1'}
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

      <div className="jx-factor-result">
        <FactorResult />
      </div>
    </div>
  );
}, 'ResultColumn');

/**
 * 提示当前草稿与冻结报告不匹配，避免误读旧结果。
 *
 * Indicate when a draft no longer matches its frozen report.
 */
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

/**
 * 展示当前分析方法和主要参数，并提供参数编辑入口。
 *
 * Present the analysis method and headline parameters with editing access.
 */
const ParamsBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const runningSameDraft = store.reportDetail?.status === 'running' && !store.reportOutdated;
  const frequency = store.freq === 'month' ? t('unitMonth') : t('unitWeek');
  const neutral = {
    none: t('neutralNone'),
    size: t('neutralSize'),
  }[store.neutral];
  const universe = t(`evaluationUniverse.${store.evaluationUniverse}`);
  const ranking = t(`evaluationRanking.${store.evaluationScope.rankingScope}`);
  const summary = store.isPanel
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

/**
 * 编辑横截面研究的频率、范围、处理和交易成本设置。
 *
 * Edit cross-sectional frequency, dates, preprocessing and cost settings.
 */
const ParamsPopover = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const runningSameDraft = store.reportDetail?.status === 'running' && !store.reportOutdated;
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
            ]}
          />
        </div>
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
          <span className="jx-factor-paramLabel">{t('evaluationDiagnosticsLabel')}</span>
          <div className="jx-factor-diagnosticChoices">
            {(['size_bucket', 'liquidity_bucket'] as const).map((diagnostic) => (
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

/**
 * 编辑单资产研究的目标资产、窗口和评估参数。
 *
 * Edit single-asset targets, windows and evaluation settings.
 */
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

/**
 * 编辑 Panel 研究的资产范围与排序评估参数。
 *
 * Edit panel universes and ranking-evaluation settings.
 */
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

function outlierOptions(t: TFunction<'factor'>) {
  return [
    { value: 'none', label: t('outlierNone') },
    { value: 'winsor', label: t('outlierWinsor') },
    { value: 'mad', label: t('outlierMad') },
  ];
}

/**
 * 使用当前日期和参数直接提交分析。
 *
 * Submit an analysis using the current dates and parameters.
 */
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

    return (
      <Button
        className={className}
        type="primary"
        size={size}
        disabled={disabled}
        loading={store.reportLoader.loading}
        onClick={() => void store.runAnalysis()}
      >
        {children}
      </Button>
    );
  },
  'ResearchRunButton',
);

/**
 * 展示仍保留的报告和任务状态，允许切换到明确报告身份。
 *
 * Present retained reports and job state for identity-based selection.
 */
const ReportHistory = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const { modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const reports = store.reportsLoader.result?.items ?? [];
  if (reports.length <= 1) {
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

                    {report.id === store.approvedReportId && (
                      <Tag>{t('publication.boundReport')}</Tag>
                    )}
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

/**
 * 根据分析种类选择报告主体，同时呈现来源与过期提示。
 *
 * Select the kind-specific report body with provenance and freshness indicators.
 */
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
  return (
    <LoadingArea loader={loader} empty={runPrompt}>
      {() =>
        store.reportDetail?.analysisKind === 'panel' ? (
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

/**
 * 展示单资产预测关系、收益与样本诊断。
 *
 * Present single-asset predictive statistics, returns and sample diagnostics.
 */
const TimeSeriesReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const report = store.timeSeriesReport;
  const researchSpec = store.reportDetail?.researchSpec;
  const spec =
    researchSpec?.analysisKind === 'time_series'
      ? (researchSpec as TimeSeriesFactorResearchSpecV1)
      : null;
  if (!report || !spec) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }
  return (
    <div className="jx-factor-timeReport" data-testid="time-series-report">
      <Alert type="info" showIcon title={t('timeSeries.reportNotice')} />

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

/**
 * 展示 Panel 排序、分层、多空和资产类别结果。
 *
 * Present panel ranking, quantile, long-short and asset-class results.
 */
const PanelReportBody = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const report = store.panelReport;
  const researchSpec = store.reportDetail?.researchSpec;
  const spec =
    researchSpec?.analysisKind === 'panel' ? (researchSpec as PanelFactorResearchSpecV1) : null;
  if (!report || !spec) {
    return <Placeholder icon={faPlay} text={t('runPrompt')} />;
  }
  return (
    <div className="jx-factor-timeReport" data-testid="panel-report">
      <Alert type="info" showIcon title={t('panel.reportNotice')} />
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

/**
 * 展示截面 Rank IC、分组收益、费用与稳健推断。
 *
 * Present cross-sectional Rank IC, grouped returns, costs and robust inference.
 */
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

/**
 * 展示 HAC 与 Fama–MacBeth 等稳健推断及样本约束。
 *
 * Present HAC and Fama-MacBeth inference with sample constraints.
 */
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

/**
 * 解释冻结方法、数据范围与处理政策，支持结果复核。
 *
 * Explain the frozen method, data scope and preprocessing policy for report review.
 */
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

/**
 * 展示发布资格、证据与操作状态，供用户明确提交发布。
 *
 * Present publication eligibility, evidence and state for explicit publication.
 */
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
  const ownedFactor = store.mode === 'custom';
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
                  href={`/strategy?new=1&factorKey=${encodeURIComponent(store.factorKey)}`}
                  data-testid="factor-use-in-strategy"
                >
                  {t('publication.useInStrategy')}
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
        <code>
          {t(store.approvedReportId ? 'publication.boundReportRef' : 'publication.reportRef', {
            id: (store.approvedReportId ?? detail.id).slice(-8),
          })}
        </code>
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

/**
 * 将冻结报告参数转换为本地化简短标签。
 *
 * Render frozen report parameters as concise localized labels.
 */
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
  const spec = report.spec;
  if (!spec) {
    return t('timeSeries.unsupportedReport');
  }
  const frequency = t(spec.freq === 'week' ? 'unitWeek' : 'unitMonth');
  const neutral = t(spec.neutral === 'size' ? 'neutralSize' : 'neutralNone');
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

/**
 * 提供因子 Agent 输入、发送与取消控制，保留会话模式提示。
 *
 * Provide factor agent input, send and cancel controls with conversation-mode guidance.
 */
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

/**
 * 提取仅用于当前显示的临时工具轨迹，重载会话后不再存在。
 *
 * The turn's ephemeral tool trace (display only — absent once a conversation is reloaded).
 */
function traceOf(message: ChatMessage): AgentToolTraceItem[] | undefined {
  const trace = (message as ChatMessage & { toolTrace?: AgentToolTraceItem[] }).toolTrace;
  return trace?.length ? trace : undefined;
}

const KIND_KEY: Record<FactorKind, string> = {
  price: 'kindPrice',
  fundamental: 'kindFundamental',
  commodity: 'kindCommodity',
  custom: 'kindCustom',
};

function factorV2Inputs(source: string): string[] {
  const declaration = source.match(/\binputs\s*[:=]\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return [...declaration.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

function timeSeriesInputLabel(input: string, t: TFunction<'factor'>): string {
  return t(
    input === 'etf.adjustedClose'
      ? 'timeSeries.inputFields.etfAdjustedClose'
      : 'timeSeries.inputFields.unknown',
  );
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

/**
 * 根据视口尺寸计算因子工作区分栏初始宽度。
 *
 * Derive initial factor splitter sizes from the viewport.
 */
function splitterDefaults(leftPx: number): { left: string; rest: string } {
  const viewportWidth = document.documentElement.clientWidth || 1440;
  const leftFraction = leftPx / viewportWidth;
  const restFraction = (1 - leftFraction) / 2;
  return {
    left: `${(leftFraction * 100).toFixed(4)}%`,
    rest: `${(restFraction * 100).toFixed(4)}%`,
  };
}
