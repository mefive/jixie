import { lazy, Suspense, useEffect, useRef } from 'react';
import classNames from 'classnames';
import { Button, DatePicker, Input, InputNumber } from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { faPlay, faSpinner } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { SavedBar } from '@src/components/saved-bar';
import { complex } from './complex';
import './lab.css';

// Our dates are 'YYYYMMDD' strings; enable dayjs to parse that format for the DatePicker.
dayjs.extend(customParseFormat);
const ymd = (s: string) => (s ? dayjs(s, 'YYYYMMDD') : null);

const NavChart = lazy(() => import('./nav-chart'));
const CodeEditor = lazy(() => import('./code-editor'));

/**
 * Backtest workbench — code-first. The strategy is TypeScript the user writes against the SDK
 * (`defineStrategy` + `ctx`); the server compiles and runs it. Top strip = name/range/capital/run +
 * saved list; left = the code editor; right = results (metrics + equity curve) / live log.
 */
export const Lab = complex.component(() => {
  const store = complex.useStore();
  const loader = store.backtestLoader;

  return (
    <div className="jx-lab">
      <TopNav />

      <div className="jx-lab-bar">
        <label className="jx-lab-field jx-lab-field--name">
          <span className="jx-lab-label">策略名称</span>
          <Input value={store.name} onChange={(e) => store.setField('name', e.target.value)} />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">起始日</span>
          <DatePicker
            className="jx-lab-control"
            value={ymd(store.start)}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => store.setField('start', d ? d.format('YYYYMMDD') : '')}
          />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">结束日</span>
          <DatePicker
            className="jx-lab-control"
            value={ymd(store.end)}
            format="YYYY-MM-DD"
            allowClear={false}
            onChange={(d) => store.setField('end', d ? d.format('YYYYMMDD') : '')}
          />
        </label>
        <label className="jx-lab-field">
          <span className="jx-lab-label">初始资金</span>
          <InputNumber
            className="jx-lab-control"
            value={store.initialCash}
            min={10000}
            step={100000}
            formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={(v) => Number((v ?? '').replace(/,/g, ''))}
            onChange={(v) => store.setField('initialCash', v ?? 0)}
          />
        </label>

        <div className="jx-lab-barActions">
          <SavedBar
            title="我的策略"
            items={store.savedLoader.result ?? []}
            loading={store.savedLoader.loading}
            onOpenList={() => store.loadSavedList()}
            onLoad={(id) => void store.openSaved(id)}
            onDelete={(id) => store.removeSaved(id)}
          />
          <Button
            type="primary"
            loading={loader.loading}
            icon={loader.loading ? undefined : <FontAwesomeIcon icon={faPlay} />}
            onClick={() => store.run()}
          >
            {loader.loading ? '回测中…' : '运行回测'}
          </Button>
        </div>
      </div>

      <main className="jx-lab-body">
        <section className="jx-lab-editor">
          <StrategyCode />
        </section>
        <section className="jx-lab-result">
          <ResultPanel />
        </section>
      </main>
    </div>
  );
}, 'Lab');

// —— 子组件 ——

// The strategy code editor — Monaco with SDK autocomplete/types, lazy-loaded into its own chunk.
const StrategyCode = complex.component(() => {
  const store = complex.useStore();
  return (
    <div className="jx-lab-code">
      <Suspense fallback={<div className="jx-lab-placeholder">加载编辑器…</div>}>
        <CodeEditor value={store.code} onChange={(v) => store.setField('code', v)} />
      </Suspense>
    </div>
  );
}, 'StrategyCode');

const ResultPanel = complex.component(() => {
  const store = complex.useStore();
  const loader = store.backtestLoader;

  if (loader.loading) {
    return <RunningLog lines={store.logLines} />;
  }
  if (loader.error) {
    return (
      <div className="jx-lab-placeholder jx-lab-placeholder--error">
        回测失败：{loader.errorObject?.message}
      </div>
    );
  }
  const r = loader.result;
  if (!r) {
    return <div className="jx-lab-placeholder">写好左侧策略后点「运行回测」查看净值与指标。</div>;
  }

  const up = r.totalReturn >= 0;
  const metrics: Metric[] = [
    { label: '年化收益', value: pct(r.annReturn), tone: r.annReturn >= 0 ? 'up' : 'down' },
    { label: '累计收益', value: pct(r.totalReturn), tone: up ? 'up' : 'down' },
    { label: 'Sharpe', value: r.sharpe.toFixed(2) },
    { label: '最大回撤', value: pct(r.maxDrawdown), tone: 'down' },
    { label: '期末权益', value: Math.round(r.finalValue).toLocaleString() },
    { label: '成交笔数', value: r.trades.toLocaleString() },
  ];

  return (
    <>
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
      <Suspense fallback={<div className="jx-lab-placeholder">加载图表…</div>}>
        <NavChart nav={r.nav} up={up} />
      </Suspense>
    </>
  );
}, 'ResultPanel');

// Live backtest progress — the worker's streamed log lines, auto-scrolled to the latest.
function RunningLog({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="jx-lab-running">
      <div className="jx-lab-runningHead">
        <FontAwesomeIcon icon={faSpinner} spin />
        <span>回测计算中…</span>
      </div>
      <pre ref={ref} className="jx-lab-log">
        {lines.length ? lines.join('\n') : '正在启动回测进程…'}
      </pre>
    </div>
  );
}

// —— 帮助函数 ——

interface Metric {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}

function pct(x: number): string {
  return (x * 100).toFixed(2) + '%';
}
