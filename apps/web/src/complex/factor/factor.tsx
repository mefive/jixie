import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { App, Button, DatePicker, Input, Segmented, Select, Splitter, Tabs } from 'antd';
import type { ChatMessage, FactorKind, IcDecayPoint, FactorWeight } from '@jixie/shared';
import { faSpinner, faPlay, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { LoadingArea } from '@src/components/loading-area';
import { LogView } from '@src/components/log-view';
import { Markdown } from '@src/components/markdown';
import { QuantileHeatmap } from './quantile-heatmap';
import { complex } from './complex';
import './factor.css';

dayjs.extend(customParseFormat);
const DecileChart = lazy(() => import('./decile-chart'));
const IcDecayChart = lazy(() => import('./ic-decay-chart'));
const FactorEditor = lazy(() => import('./factor-editor'));

/**
 * 因子研究 — Agent-authored, IDE-style (aligned with the strategy workbench). 3-column Splitter: an Agent
 * panel (a chat that writes the custom factor's defineFactor code, + a 因子库 tab of presets & custom
 * factors) | the code editor over a collapsible 日志 dock (a preset shows a greyed note — no code) | the
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
  // to the 因子库 list (a small region), not the whole workbench, so nothing pops in from blank.
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

// —— 子组件 ——

// Left column: Agent (chat authors the factor) | 因子库 (presets + custom, to select).
const AgentPanel = complex.component(() => {
  const store = complex.useStore();
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
            新建
          </Button>
        }
        items={[
          { key: 'agent', label: 'Agent', children: <AgentChat /> },
          {
            // Picking a custom factor jumps to Agent (to edit/chat); a preset stays here (analysis-only).
            key: 'library',
            label: '因子库',
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
  const qa = store.qaMode;
  const f = store.selected;
  const name = f?.label ?? (store.mode === 'custom' ? '新因子（未保存）' : '未选择因子');
  return (
    <div className="jx-factor-chat">
      <div className="jx-factor-agentName">
        <span className="jx-factor-agentNameText">{name}</span>
        {f && (
          <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>{KIND_LABEL[f.kind]}</span>
        )}
      </div>
      <ChatLog messages={store.chatMessages} sending={store.sending} qa={qa} />
      <div className="jx-factor-chatInput">
        <PromptBox
          value={store.nlText}
          onChange={(v) => store.setNlText(v)}
          onSubmit={() => void store.sendAgent(store.nlText)}
          placeholder={
            qa
              ? '问问这个预设因子 —— 如「IC 0.03 算强吗」「适合什么周期」—— 回车发送'
              : '描述你想要的因子,如「盈利收益率 1/PE」「小市值」;或继续对话调整 —— 回车发送'
          }
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
}: {
  messages: ChatMessage[];
  sending: boolean;
  qa: boolean;
}) {
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
        <div className="jx-factor-chatEmpty">
          {qa
            ? '这是预设因子(内置公式)。有关它 / 因子分析的问题都可以问 —— Agent 只答疑,不改代码。想写自定义因子请点「新建」。'
            : '跟 Agent 说你想要的因子(基于估值 / 规模 / 流动性),它写成代码进中间编辑器。价格 / 财报类因子请从「因子库」选预设。'}
        </div>
      )}
      {messages.map((message, index) => (
        <div
          key={index}
          className={classNames('jx-factor-bubble', `jx-factor-bubble--${message.role}`)}
        >
          {message.role === 'assistant' ? <Markdown text={message.content} /> : message.content}
        </div>
      ))}
      {sending && (
        <div className="jx-factor-bubble jx-factor-bubble--assistant jx-factor-bubble--thinking">
          <FontAwesomeIcon icon={faSpinner} spin /> 思考中…
        </div>
      )}
    </div>
  );
}

// 因子库 tab: presets grouped by kind + this user's custom factors. Click to select (→ analyze); custom
// rows have a delete affordance. Picking one jumps back to the Agent tab.
const FactorLibrary = complex.component(({ onPickCustom }: { onPickCustom: () => void }) => {
  const store = complex.useStore();
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
      title: '删除确认',
      content: `确定删除自定义因子「${name}」吗?删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => store.removeFactor(id),
    });

  // Catalog loading is scoped here (a small region) with a delayed spinner — not the whole workbench.
  return (
    <LoadingArea loader={store.catalogLoader}>
      {() => (
        <div className="jx-factor-library">
          <div className="jx-factor-libGroup">预设因子</div>
          {presets.map((f) => (
            <button
              key={f.key}
              className={classNames('jx-factor-libItem', {
                'jx-factor-libItem--active': f.key === store.selectedKey,
              })}
              onClick={() => pick(f.key, false)}
            >
              <span className="jx-factor-libName">{f.label}</span>
              <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>
                {KIND_LABEL[f.kind]}
              </span>
            </button>
          ))}

          <div className="jx-factor-libGroup">自定义因子</div>
          {custom.length === 0 && <div className="jx-factor-libEmpty">还没有,用 Agent 写一个</div>}
          {custom.map((f) => (
            <button
              key={f.key}
              className={classNames('jx-factor-libItem', {
                'jx-factor-libItem--active': f.key === store.selectedKey,
              })}
              onClick={() => pick(f.key, true)}
            >
              <span className="jx-factor-libName">{f.label}</span>
              <span
                role="button"
                title="删除"
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

// Middle column: for a custom factor, the Monaco editor over a collapsible 日志 dock. A preset has no
// code, so the editor is dropped — the whole middle is just the 日志 (analysis progress).
const MiddleColumn = complex.component(() => {
  const store = complex.useStore();
  if (store.mode !== 'custom') {
    return <FactorDock />;
  }
  return (
    <Splitter orientation="vertical">
      <Splitter.Panel min="20%">
        <section className="jx-factor-editor">
          <div className="jx-factor-code">
            <Suspense fallback={<div className="jx-factor-codeEmpty">加载编辑器……</div>}>
              <FactorEditor value={store.code} onChange={(v) => store.setCode(v)} />
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

// Middle-bottom: the run's streamed 日志 (system progress + custom-factor console.*).
const FactorDock = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-factor-dock">
      <div className="jx-factor-dockHead">
        {store.jobRunning && <FontAwesomeIcon icon={faSpinner} spin />}
        日志
      </div>
      <LogView
        lines={store.logs}
        emptyText="运行分析后在此查看日志(系统进度 + 你的 console 输出)"
      />
    </div>
  );
}, 'FactorDock');

// Right column: sticky 分析参数 (频率/区间/运行 + 已跑 chips) over the scrollable analysis result.
const ResultColumn = complex.component(() => {
  const store = complex.useStore();
  const active = store.selectedKey || store.mode === 'custom';
  if (!active) {
    return (
      <div className="jx-factor-resultCol jx-factor-empty">
        ← 选一个因子,或让 Agent 写一个,再运行分析
      </div>
    );
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

// Frequency + date range + 运行/查看 (label depends on cache + unsaved custom code) + 重算.
const ParamsBar = complex.component(() => {
  const store = complex.useStore();
  const canView = store.isCached && !store.edited; // custom code edits force a recompute
  return (
    <div className="jx-factor-params">
      <span className="jx-factor-paramLabel">频率</span>
      <Select
        size="small"
        value={store.freq}
        onChange={(v) => store.setFreq(v)}
        options={[
          { value: 'month', label: '月' },
          { value: 'week', label: '周' },
        ]}
        style={{ width: 68 }}
      />
      <span className="jx-factor-paramLabel">区间</span>
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
        {canView ? '查看' : '运行分析'}
      </LoaderButton>
      {store.report && (
        <LoaderButton
          size="small"
          loader={store.analysisLoader}
          action={() => store.runAnalysis(true)}
        >
          重算
        </LoaderButton>
      )}
    </div>
  );
}, 'ParamsBar');

// The factor's already-computed windows — one click jumps to that cached report (instant).
const RunChips = complex.component(() => {
  const store = complex.useStore();
  const runs = store.runsLoader.result ?? [];
  if (!runs.length) {
    return null;
  }
  return (
    <div className="jx-factor-runs">
      <span className="jx-factor-runsLabel">已跑</span>
      {runs.map((r) => {
        const active = r.freq === store.freq && r.start === store.start && r.end === store.end;
        return (
          <button
            key={`${r.freq}|${r.start}|${r.end}`}
            className={classNames('jx-factor-chip', { 'jx-factor-chip--active': active })}
            onClick={() => void store.applyRun(r)}
          >
            {r.freq === 'week' ? '周' : '月'}·{r.start.slice(2, 6)}–{r.end.slice(2, 6)}
          </button>
        );
      })}
    </div>
  );
}, 'RunChips');

// Result: running / loading / error / prompt-to-run / the report. The live log streams in the dock.
// Thin wrapper: jobRunning shows a running placeholder; a never-run factor shows a 运行 prompt; otherwise
// LoadingArea drives the cached-report load with a DELAYED spinner (so a fast reload doesn't flash it).
const FactorResult = complex.component(() => {
  const store = complex.useStore();
  const loader = store.analysisLoader;
  if (store.jobRunning) {
    return (
      <Placeholder
        icon={faSpinner}
        spin
        text="计算中……(基本面 / 自定义因子几秒;结果入库下次秒开)· 实时日志见中间「日志」"
      />
    );
  }
  const runPrompt = () => <Placeholder icon={faPlay} text="设好频率 / 区间,点「运行分析」" />;
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
  const [weight, setWeight] = useState<FactorWeight>('equal'); // 分位收益加权:等权 / 市值加权(view 切换)
  const r = store.report;
  if (!r) {
    return <Placeholder icon={faPlay} text="设好频率 / 区间,点「运行分析」" />;
  }

  const n = r.buckets.length;
  const dir = direction(r.icMean);
  const per = r.freq === 'week' ? '周' : '月';
  // Weight is a view toggle over precomputed data (等权 always present; 市值加权 on newer reports).
  const hasMktcap = !!r.bucketsMktcap;
  const useMktcap = weight === 'mktcap' && hasMktcap;
  const buckets = useMktcap ? r.bucketsMktcap! : r.buckets;
  const longShort = useMktcap ? r.longShortMktcap! : r.longShort;
  return (
    <>
      <div className="jx-factor-resultHead">
        <span className="jx-factor-sample">
          样本 {r.periods} {per} · {r.start.slice(0, 4)}–{r.end.slice(0, 4)}
        </span>
        {hasMktcap && (
          <Segmented
            size="small"
            value={weight}
            onChange={(v) => setWeight(v as FactorWeight)}
            options={[
              { label: '等权', value: 'equal' },
              { label: '市值加权', value: 'mktcap' },
            ]}
          />
        )}
        <span className={classNames('jx-factor-dir', `jx-factor-dir--${dir.kind}`)}>
          {dir.text}
        </span>
      </div>

      <Suspense fallback={<div className="jx-factor-chart" />}>
        <DecileChart buckets={buckets} />
      </Suspense>
      <div className="jx-factor-chartCap">
        横轴 D1(因子值最低)→ D{n}(最高),纵轴各档「下一{per}」年化收益 ——
        一路上行=动量,一路下行=反转。
        {hasMktcap && '「市值加权」看大票能否真赚到(等权易被小盘放大)。'}
      </div>

      <div className="jx-factor-metrics">
        <Metric label="Rank IC 均值" value={r.icMean.toFixed(4)} hint="符号=方向 · 绝对值=强度" />
        <Metric label="ICIR(年化)" value={r.icirAnnual.toFixed(2)} hint="IC 稳定性" />
        <Metric label="IC>0 占比" value={pct(r.icPosRate)} hint={`多少${per}份方向一致`} />
        <Metric label={`多空 D${n}−D1 年化`} value={pct(longShort.annReturn)} hint="纯因子收益" />
        <Metric label="多空 Sharpe" value={longShort.sharpe.toFixed(2)} />
        <Metric label="多空最大回撤" value={pct(longShort.maxDrawdown)} />
        <Metric label={`最高档${per}换手`} value={pctInt(r.topTurnover)} hint="越高摩擦越重" />
      </div>

      {r.icDecay?.length > 0 && (
        <>
          <div className="jx-factor-sectionTitle">IC 衰减 · 因子的持有周期</div>
          <Suspense fallback={<div className="jx-factor-chart" />}>
            <IcDecayChart points={r.icDecay} />
          </Suspense>
          <div className="jx-factor-chartCap">
            横轴前瞻交易日,纵轴 Rank IC —— {decayHint(r.icDecay)}
          </div>
        </>
      )}

      {r.quantileHorizons?.length ? (
        <>
          <div className="jx-factor-sectionTitle">分位 × 前瞻期 · 各档在不同持有期的收益</div>
          <QuantileHeatmap rows={r.quantileHorizons} weight={useMktcap ? 'mktcap' : 'equal'} />
          <div className="jx-factor-chartCap">
            格子=日均前瞻收益(‱ 万分,已按持有天数归一化,横向可比),红涨绿跌。看哪个前瞻期下 D1→D{n}
            单调最强、信号衰不衰。
          </div>
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

// —— 帮助函数 / 配置 ——

const KIND_LABEL: Record<FactorKind, string> = {
  price: '价格',
  fundamental: '基本面',
  moneyflow: '资金流',
  custom: '自定义',
};

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pctInt = (v: number) => `${(v * 100).toFixed(0)}%`;

// Direction from the IC sign: positive → long the top decile (momentum-like); negative → long the
// bottom decile (reversal-like); near-zero → no edge.
function direction(icMean: number): { kind: 'up' | 'down' | 'flat'; text: string } {
  if (icMean > 0.01) {
    return { kind: 'up', text: '正向 · 做多高分位' };
  }
  if (icMean < -0.01) {
    return { kind: 'down', text: '反向 · 做多低分位' };
  }
  return { kind: 'flat', text: '方向不显著' };
}

// Interpret the IC-decay shape: where |IC| peaks (natural holding period) + whether it rises (slow
// factor, hold long) or fades from the short end (fast factor, hold short).
function decayHint(points: IcDecayPoint[]): string {
  if (!points.length) {
    return '';
  }
  const peak = points.reduce((a, b) => (Math.abs(b.icMean) > Math.abs(a.icMean) ? b : a));
  const rising = Math.abs(points.at(-1)!.icMean) > Math.abs(points[0].icMean);
  const trend = rising ? '越往后越强(慢因子,宜长持)' : '短端更强、随后衰减(快因子,宜短持)';
  return `|IC| 峰值在 ${peak.horizonDays} 日 · ${trend}`;
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
