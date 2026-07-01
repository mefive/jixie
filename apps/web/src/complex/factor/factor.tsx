import { lazy, Suspense } from 'react';
import classNames from 'classnames';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { DatePicker, Select } from 'antd';
import type { FactorKind } from '@jixie/shared';
import { faSpinner, faTriangleExclamation, faPlay } from '@fortawesome/free-solid-svg-icons';
import { TopNav } from '@src/components/top-nav';
import { LoaderButton } from '@src/components/loader-button';
import { Placeholder } from '@src/components/placeholder';
import { complex } from './complex';
import './factor.css';

dayjs.extend(customParseFormat);
const DecileChart = lazy(() => import('./decile-chart'));

/**
 * 因子分析(产品线 1.5). Left: the factor catalog. Right: for the selected factor, choose 频率(月/周)+
 * 区间 → 运行 → decile bar chart + Rank IC + long-short. Analysis is cached per (factor,freq,start,end);
 * selecting a factor auto-shows its latest cached run, and 已跑 chips jump between computed windows.
 */
export const Factor = complex.component(() => {
  const store = complex.useStore();
  const cat = store.catalogLoader;

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
  if (loader.loading)
    return <Placeholder icon={faSpinner} spin text="计算中……(价格因子首次约 100 秒,基本面 / 资金流几秒)" />;
  if (loader.error)
    return (
      <Placeholder icon={faTriangleExclamation} error text={`分析失败:${loader.errorObject?.message ?? ''}`} />
    );
  const r = store.report;
  if (!r) return <Placeholder icon={faPlay} text="设好频率 / 区间,点「运行分析」" />;

  const n = r.buckets.length;
  const dir = direction(r.icMean);
  const per = r.freq === 'week' ? '周' : '月';
  return (
    <>
      <div className="jx-factor-resultHead">
        <span className="jx-factor-sample">
          样本 {r.periods} {per} · {r.start.slice(0, 4)}–{r.end.slice(0, 4)}
        </span>
        <span className={classNames('jx-factor-dir', `jx-factor-dir--${dir.kind}`)}>{dir.text}</span>
      </div>

      <Suspense fallback={<div className="jx-factor-chart" />}>
        <DecileChart buckets={r.buckets} />
      </Suspense>
      <div className="jx-factor-chartCap">
        横轴 D1(因子值最低)→ D{n}(最高),纵轴各档「下一{per}」年化收益 —— 一路上行=动量,一路下行=反转。
      </div>

      <div className="jx-factor-metrics">
        <Metric label="Rank IC 均值" value={r.icMean.toFixed(4)} hint="符号=方向 · 绝对值=强度" />
        <Metric label="ICIR(年化)" value={r.icirAnnual.toFixed(2)} hint="IC 稳定性" />
        <Metric label="IC>0 占比" value={pct(r.icPosRate)} hint={`多少${per}份方向一致`} />
        <Metric label={`多空 D${n}−D1 年化`} value={pct(r.longShort.annReturn)} hint="纯因子收益" />
        <Metric label="多空 Sharpe" value={r.longShort.sharpe.toFixed(2)} />
        <Metric label="多空最大回撤" value={pct(r.longShort.maxDrawdown)} />
        <Metric label={`最高档${per}换手`} value={pctInt(r.topTurnover)} hint="越高摩擦越重" />
      </div>
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
