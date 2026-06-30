import { lazy, Suspense } from 'react';
import classNames from 'classnames';
import { Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { FactorReport } from '@jixie/shared';
import { faSpinner, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { complex } from './complex';
import './factor.css';

const DecileChart = lazy(() => import('./decile-chart'));

/**
 * 因子分析(产品线 1.5). Loads every pre-computed factor's report, lists them in a sortable table, and
 * shows the selected factor's decile bar chart + IC / long-short metrics. Reuses the existing
 * analyzeFactors() engine — this page is its visualization.
 */
export const Factor = complex.component(() => {
  const store = complex.useStore();
  const loader = store.reportLoader;

  return (
    <div className="jx-factor">
      <TopNav />
      <main className="jx-factor-body">
        <div className="jx-factor-head">
          <h1 className="jx-factor-title">因子分析</h1>
          <p className="jx-factor-hint">
            每个因子按月调仓、全市场分十档持有 —— 看分位收益是否单调(动量 / 反转)、Rank IC 有没有预测力。
          </p>
        </div>

        {loader.loading && <Placeholder icon={faSpinner} spin text="计算因子分位 / IC 中……(首次较慢)" />}
        {loader.error && (
          <Placeholder icon={faTriangleExclamation} error text={`加载失败:${loader.errorObject?.message ?? ''}`} />
        )}
        {loader.loaded &&
          (store.reports.length ? (
            <div className="jx-factor-split">
              <FactorTable />
              <FactorDetail />
            </div>
          ) : (
            <Placeholder
              icon={faTriangleExclamation}
              text="还没有因子数据 —— 先在后端跑 pnpm factor:compute 物化因子值。"
            />
          ))}
      </main>
    </div>
  );
}, 'Factor');

// —— 子组件 ——

// Sortable factor list; click a row to drive the detail panel.
const FactorTable = complex.component(() => {
  const store = complex.useStore();
  return (
    <Table<FactorReport>
      className="jx-factor-table"
      rowKey="factor"
      size="small"
      dataSource={store.reports}
      columns={COLUMNS}
      pagination={false}
      rowClassName={(r) => (r.factor === store.selected?.factor ? 'jx-factor-row--active' : '')}
      onRow={(r) => ({ onClick: () => store.select(r.factor) })}
    />
  );
}, 'FactorTable');

// Selected factor: decile chart + a grid of IC / long-short / turnover metrics + a direction badge.
const FactorDetail = complex.component(() => {
  const store = complex.useStore();
  const r = store.selected;
  if (!r) return null;
  const n = r.buckets.length;
  const dir = direction(r.icMean);

  return (
    <section className="jx-factor-detail">
      <header className="jx-factor-detailHead">
        <div className="jx-factor-detailTitleWrap">
          <h2 className="jx-factor-detailTitle">{r.label}</h2>
          <span className="jx-factor-detailKey">
            {r.factor} · 样本 {r.months} 个月
          </span>
        </div>
        <span className={classNames('jx-factor-dir', `jx-factor-dir--${dir.kind}`)}>{dir.text}</span>
      </header>

      <Suspense fallback={<div className="jx-factor-chart" />}>
        <DecileChart buckets={r.buckets} />
      </Suspense>
      <div className="jx-factor-chartCap">
        横轴 D1(因子值最低)→ D{n}(最高),纵轴为各档「下一月」年化收益 —— 一路上行=动量,一路下行=反转。
      </div>

      <div className="jx-factor-metrics">
        <Metric label="Rank IC 均值" value={r.icMean.toFixed(4)} hint="符号=方向 · 绝对值=强度" />
        <Metric label="ICIR(年化)" value={r.icirAnnual.toFixed(2)} hint="IC 稳定性" />
        <Metric label="IC>0 占比" value={pct(r.icPosRate)} hint="多少月份方向一致" />
        <Metric label={`多空 D${n}−D1 年化`} value={pct(r.longShort.annReturn)} hint="纯因子收益" />
        <Metric label="多空 Sharpe" value={r.longShort.sharpe.toFixed(2)} />
        <Metric label="多空最大回撤" value={pct(r.longShort.maxDrawdown)} />
        <Metric label="最高档月换手" value={pctInt(r.topTurnover)} hint="越高摩擦越重" />
      </div>
    </section>
  );
}, 'FactorDetail');

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="jx-factor-metric">
      <span className="jx-factor-metricLabel">{label}</span>
      <span className="jx-factor-metricValue">{value}</span>
      {hint && <span className="jx-factor-metricHint">{hint}</span>}
    </div>
  );
}

function Placeholder({
  text,
  icon,
  spin,
  error,
}: {
  text: string;
  icon: typeof faSpinner;
  spin?: boolean;
  error?: boolean;
}) {
  return (
    <div className={classNames('jx-factor-placeholder', { 'jx-factor-placeholder--error': error })}>
      <FontAwesomeIcon icon={icon} spin={spin} />
      <span>{text}</span>
    </div>
  );
}

// —— 帮助函数 / 配置 ——

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const pctInt = (v: number) => `${(v * 100).toFixed(0)}%`;

// Direction read off the IC sign: positive = bigger factor value predicts higher return (momentum,
// long the top decile); negative = reversal (long the bottom decile). Near-zero = no edge.
function direction(icMean: number): { kind: 'up' | 'down' | 'flat'; text: string } {
  if (icMean > 0.01) return { kind: 'up', text: '正向 · 做多高分位' };
  if (icMean < -0.01) return { kind: 'down', text: '反向 · 做多低分位' };
  return { kind: 'flat', text: '方向不显著' };
}

const COLUMNS: ColumnsType<FactorReport> = [
  {
    title: '因子',
    dataIndex: 'label',
    render: (_v, r) => (
      <div className="jx-factor-name">
        <span className="jx-factor-nameMain">{r.label}</span>
        <span className="jx-factor-nameKey">{r.factor}</span>
      </div>
    ),
  },
  {
    title: 'IC 均值',
    dataIndex: 'icMean',
    align: 'right',
    sorter: (a, b) => a.icMean - b.icMean,
    render: (v: number) => (
      <span className={classNames({ 'text-up': v > 0.01, 'text-down': v < -0.01 })}>
        {v.toFixed(4)}
      </span>
    ),
  },
  {
    title: 'ICIR年化',
    dataIndex: 'icirAnnual',
    align: 'right',
    sorter: (a, b) => a.icirAnnual - b.icirAnnual,
    render: (v: number) => v.toFixed(2),
  },
  {
    title: '多空年化',
    dataIndex: ['longShort', 'annReturn'],
    align: 'right',
    sorter: (a, b) => a.longShort.annReturn - b.longShort.annReturn,
    render: (v: number) => pct(v),
  },
];
