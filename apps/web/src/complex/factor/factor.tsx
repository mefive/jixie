import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { App, Button, DatePicker, Input, Segmented, Select, Splitter, Tabs } from 'antd';
import type {
  ChatMessage,
  FactorKind,
  FactorMeta,
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
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { MessageParts } from '@src/components/message-parts';
import type { QueryCardResults } from '@src/components/query-card-model';
import { ToolTrace } from '@src/components/tool-trace';
import { AgentPending } from '@src/components/agent-pending';
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
const FactorEditor = lazy(() => import('./factor-editor'));

/**
 * Factor research — Agent-authored, IDE-style (aligned with the strategy workbench). 3-column Splitter: an Agent
 * panel (a chat that writes the custom factor's defineFactor code, + a factor-library tab of presets & custom
 * factors) | the code editor over a collapsible log dock (a preset shows a greyed note — no code) | the
 * analysis params + result (deciles + Rank IC + long-short + heatmap). Preset factors skip the editor and
 * go straight to analysis; custom factors are authored by the Agent and persisted on a run.
 */
export const Factor = complex.component(() => {
  const store = complex.useStore();

  // Reflect the currently-shown report in the URL (?factor&freq&start&end) — refresh-safe + shareable.
  const [, setSearchParams] = useSearchParams();
  const shown = store.report;
  useEffect(() => {
    if (shown) {
      setSearchParams(
        { factor: shown.factor, freq: shown.freq, start: shown.start, end: shown.end },
        { replace: true },
      );
    }
  }, [shown, setSearchParams]);

  // The Splitter renders on the FIRST paint (not gated on the catalog) so it mounts once, early, and its
  // layout-measure reflow happens while the panels are still empty — invisible. Catalog loading is scoped
  // to the factor-library list (a small region), not the whole workbench, so nothing pops in from blank.
  const [panelDefaults] = useState(() => splitterDefaults(340));
  return (
    <div className="jx-factor">
      <Splitter className="jx-factor-body">
        <Splitter.Panel defaultSize={panelDefaults.left} min={280} max={520} collapsible>
          <AgentPanel />
        </Splitter.Panel>
        <Splitter.Panel defaultSize={panelDefaults.rest} min="22%">
          <MiddleColumn />
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
const AgentPanel = complex.component(() => {
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
              store.newFactor();
              setTab('agent');
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
            children: <FactorLibrary onPickCustom={() => setTab('agent')} />,
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
      <div className="jx-factor-agentName">
        <span className="jx-factor-agentNameText">{name}</span>
        {f && (
          <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>{t(KIND_KEY[f.kind])}</span>
        )}
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
          <MessageParts message={message} cards={cards} />
          {traceOf(message) && <ToolTrace trace={traceOf(message)!} />}
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
const FactorLibrary = complex.component(({ onPickCustom }: { onPickCustom: () => void }) => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const { modal } = App.useApp();
  const list = store.catalogLoader.result ?? [];
  const presets = list.filter((f) => f.kind !== 'custom');
  const custom = list.filter((f) => f.kind === 'custom');

  // A custom factor → jump to Agent (edit/chat); a preset stays here (select → analyze, no code).
  const pick = (key: string, isCustom: boolean) => {
    void store.selectFactor(key);
    if (isCustom) {
      onPickCustom();
    }
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
}, 'FactorLibrary');

// Middle column: the Monaco editor over a collapsible log dock. A preset is a seeded READ-ONLY code
// row — shown in the same editor with a lock bar + copy-as-custom (fork), instead of being hidden.
const MiddleColumn = complex.component(() => {
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
                action={() => store.forkSelected()}
              >
                {t('forkToCustom')}
              </LoaderButton>
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

// Right column: sticky analysis params (frequency/range/run + already-run chips) over the scrollable analysis result.
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
        <RunChips />
      </div>
      <div className="jx-factor-result">
        <FactorResult />
      </div>
    </div>
  );
}, 'ResultColumn');

// Frequency + date range + run/view (label depends on cache + unsaved custom code) + recompute.
const ParamsBar = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const canView = store.isCached && !store.edited; // custom code edits force a recompute
  return (
    <div className="jx-factor-params">
      <span className="jx-factor-paramLabel">{t('freq')}</span>
      <Select
        size="small"
        value={store.freq}
        onChange={(v) => store.setFreq(v)}
        options={[
          { value: 'month', label: t('unitMonth') },
          { value: 'week', label: t('unitWeek') },
        ]}
        style={{ width: 68 }}
      />
      <span className="jx-factor-paramLabel">{t('range')}</span>
      <DatePicker
        size="small"
        value={dayjs(store.start, 'YYYYMMDD')}
        onChange={(d) => d && store.setStart(d.format('YYYYMMDD'))}
        allowClear={false}
      />
      <span className="jx-factor-paramDash">~</span>
      <DatePicker
        size="small"
        value={dayjs(store.end, 'YYYYMMDD')}
        onChange={(d) => d && store.setEnd(d.format('YYYYMMDD'))}
        allowClear={false}
      />
      <LoaderButton
        type="primary"
        size="small"
        loader={store.analysisLoader}
        action={() => store.runAnalysis()}
        style={{ width: 96 }}
      >
        {canView ? t('view') : t('run')}
      </LoaderButton>
      {store.report && (
        <LoaderButton
          size="small"
          loader={store.analysisLoader}
          action={() => store.runAnalysis(true)}
        >
          {t('recompute')}
        </LoaderButton>
      )}
    </div>
  );
}, 'ParamsBar');

// The factor's already-computed windows — one click jumps to that cached report (instant).
const RunChips = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const runs = store.runsLoader.result ?? [];
  if (!runs.length) {
    return null;
  }
  return (
    <div className="jx-factor-runs">
      <span className="jx-factor-runsLabel">{t('runsLabel')}</span>
      {runs.map((r) => {
        const active = r.freq === store.freq && r.start === store.start && r.end === store.end;
        return (
          <button
            key={`${r.freq}|${r.start}|${r.end}`}
            className={classNames('jx-factor-chip', { 'jx-factor-chip--active': active })}
            onClick={() => void store.applyRun(r)}
          >
            {t(r.freq === 'week' ? 'unitWeek' : 'unitMonth')}·{r.start.slice(2, 6)}–
            {r.end.slice(2, 6)}
          </button>
        );
      })}
    </div>
  );
}, 'RunChips');

// Result: running / loading / error / prompt-to-run / the report. The live log streams in the dock.
// Thin wrapper: jobRunning shows a running placeholder; a never-run factor shows a run prompt; otherwise
// LoadingArea drives the cached-report load with a DELAYED spinner (so a fast reload doesn't flash it).
const FactorResult = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('factor');
  const loader = store.analysisLoader;
  if (store.jobRunning) {
    return <Placeholder icon={faSpinner} spin text={t('computing')} />;
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
