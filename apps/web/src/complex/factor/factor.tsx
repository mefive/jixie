import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DatePicker, Segmented, Select } from 'antd';
import type { FactorKind, IcDecayPoint, FactorWeight } from '@jixie/shared';
import { faSpinner, faTriangleExclamation, faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { QuantileHeatmap } from './quantile-heatmap';
import { complex } from './complex';
import './factor.css';

dayjs.extend(customParseFormat);
const DecileChart = lazy(() => import('./decile-chart'));
const IcDecayChart = lazy(() => import('./ic-decay-chart'));

/**
 * 因子分析(产品线 1.5). Left: the factor catalog. Right: for the selected factor, choose 频率(月/周)+
 * 区间 → 运行 → decile bar chart + Rank IC + long-short. Analysis is cached per (factor,freq,start,end);
 * selecting a factor auto-shows its latest cached run, and 已跑 chips jump between computed windows.
 */
export const Factor = complex.component(() => {
  const store = complex.useStore();
  const cat = store.catalogLoader;

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

  return (
    <div className="jx-factor">
      <TopNav />
      <main className="jx-factor-body">
        <div className="jx-factor-head">
          <h1 className="jx-factor-title">因子分析</h1>
          <p className="jx-factor-hint">
            选一个因子 → 设频率 / 区间 → 运行:看十分位分层收益、Rank IC、多空。快因子(反转/资金流)建议看「周」。
          </p>
        </div>

        {cat.loading && <Placeholder icon={faSpinner} spin text="加载因子列表……" />}
        {cat.error && (
          <Placeholder icon={faTriangleExclamation} error text={`加载失败:${cat.errorObject?.message ?? ''}`} />
        )}
        {cat.loaded && (
          <div className="jx-factor-split">
            <FactorList />
            <FactorPanel />
          </div>
        )}
      </main>
    </div>
  );
}, 'Factor');

// —— 子组件 ——

// Left: the catalog as a clickable list (identity + kind). No metrics — those come from running analysis.
const FactorList = complex.component(() => {
  const store = complex.useStore();
  const list = store.catalogLoader.result ?? [];
  return (
    <div className="jx-factor-list">
      {list.map((f) => (
        <button
          key={f.key}
          className={classNames('jx-factor-listItem', {
            'jx-factor-listItem--active': f.key === store.selectedKey,
          })}
          onClick={() => void store.selectFactor(f.key)}
        >
          <span className="jx-factor-listName">{f.label}</span>
          <span className="jx-factor-listMeta">
            <span className="jx-factor-listKey">{f.key}</span>
            <span className={`jx-factor-kind jx-factor-kind--${f.kind}`}>{KIND_LABEL[f.kind]}</span>
          </span>
        </button>
      ))}
    </div>
  );
}, 'FactorList');

// Right: params bar + run chips + result for the selected factor.
const FactorPanel = complex.component(() => {
  const store = complex.useStore();
  const f = store.selected;
  if (!f) return <div className="jx-factor-detail jx-factor-empty">← 左边选一个因子开始分析</div>;
  return (
    <section className="jx-factor-detail">
      <header className="jx-factor-detailHead">
        <div className="jx-factor-detailTitleWrap">
          <h2 className="jx-factor-detailTitle">{f.label}</h2>
          <span className="jx-factor-detailKey">
            {f.key} · {KIND_LABEL[f.kind]}
          </span>
        </div>
      </header>
      <ParamsBar />
      <RunChips />
      <Result />
    </section>
  );
}, 'FactorPanel');

// Frequency + date range + 运行/查看 (label depends on whether the current 4-tuple is cached) + 重算.
const ParamsBar = complex.component(() => {
  const store = complex.useStore();
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
        style={{ width: 72 }}
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
        style={{ width: 120 }}
      >
        {store.isCached ? '查看' : '运行分析'}
      </LoaderButton>
      {store.report && (
        <LoaderButton size="small" loader={store.analysisLoader} action={() => store.runAnalysis(true)}>
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
  if (!runs.length) return null;
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

// Result: loading / error / prompt-to-run / the report (decile chart + metrics).
const Result = complex.component(() => {
  const store = complex.useStore();
  const loader = store.analysisLoader;
  const [weight, setWeight] = useState<FactorWeight>('equal'); // 分位收益加权:等权 / 市值加权(view 切换)
  if (store.jobRunning)
    return (
      <div className="jx-factor-running">
        <div className="jx-factor-runningHead">
          <FontAwesomeIcon icon={faSpinner} spin /> 计算中……(价格因子较慢,基本面 / 资金流几秒;结果会入库,下次秒开)
        </div>
        {store.logs.length > 0 && <pre className="jx-factor-log">{store.logs.join('\n')}</pre>}
      </div>
    );
  if (loader.loading) return <Placeholder icon={faSpinner} spin text="加载中……" />;
  if (loader.error)
    return (
      <Placeholder icon={faTriangleExclamation} error text={`分析失败:${loader.errorObject?.message ?? ''}`} />
    );
  const r = store.report;
  if (!r) return <Placeholder icon={faPlay} text="设好频率 / 区间,点「运行分析」" />;

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
        <span className={classNames('jx-factor-dir', `jx-factor-dir--${dir.kind}`)}>{dir.text}</span>
      </div>

      <Suspense fallback={<div className="jx-factor-chart" />}>
        <DecileChart buckets={buckets} />
      </Suspense>
      <div className="jx-factor-chartCap">
        横轴 D1(因子值最低)→ D{n}(最高),纵轴各档「下一{per}」年化收益 —— 一路上行=动量,一路下行=反转。
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
}, 'Result');

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="jx-factor-metric">
      <span className="jx-factor-metricLabel">{label}</span>
      <span className="jx-factor-metricValue">{value}</span>
      {hint && <span className="jx-factor-metricHint">{hint}</span>}
    </div>
  );
}

// —— 帮助函数 / 配置 ——

const KIND_LABEL: Record<FactorKind, string> = {
  price: '价格',
  fundamental: '基本面',
  moneyflow: '资金流',
};

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pctInt = (v: number) => `${(v * 100).toFixed(0)}%`;

// Direction from the IC sign: positive → long the top decile (momentum-like); negative → long the
// bottom decile (reversal-like); near-zero → no edge.
function direction(icMean: number): { kind: 'up' | 'down' | 'flat'; text: string } {
  if (icMean > 0.01) return { kind: 'up', text: '正向 · 做多高分位' };
  if (icMean < -0.01) return { kind: 'down', text: '反向 · 做多低分位' };
  return { kind: 'flat', text: '方向不显著' };
}

// Interpret the IC-decay shape: where |IC| peaks (natural holding period) + whether it rises (slow
// factor, hold long) or fades from the short end (fast factor, hold short).
function decayHint(points: IcDecayPoint[]): string {
  if (!points.length) return '';
  const peak = points.reduce((a, b) => (Math.abs(b.icMean) > Math.abs(a.icMean) ? b : a));
  const rising = Math.abs(points.at(-1)!.icMean) > Math.abs(points[0].icMean);
  const trend = rising ? '越往后越强(慢因子,宜长持)' : '短端更强、随后衰减(快因子,宜短持)';
  return `|IC| 峰值在 ${peak.horizonDays} 日 · ${trend}`;
}
