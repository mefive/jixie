import { lazy, Suspense } from 'react';
import classNames from 'classnames';
import { Button, DatePicker, Input, InputNumber, Select } from 'antd';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { faPlay, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { TopNav } from '@src/components/top-nav';
import { complex } from './complex';
import { FACTOR_PRESETS } from './presets';
import './lab.css';

// Our dates are 'YYYYMMDD' strings; enable dayjs to parse that format for the DatePicker.
dayjs.extend(customParseFormat);
const ymd = (s: string) => (s ? dayjs(s, 'YYYYMMDD') : null);

const NavChart = lazy(() => import('./nav-chart'));

export const Lab = complex.component(() => {
  const store = complex.useStore();
  const loader = store.backtestLoader;

  return (
    <div className="jx-lab">
      <TopNav />

      <main className="jx-lab-body">
        <section className="jx-lab-form">
          <h2 className="jx-lab-formTitle">策略配置</h2>

          <div className="jx-lab-nl">
            <Input.TextArea
              value={store.nlText}
              onChange={(e) => store.setField('nlText', e.target.value)}
              placeholder="用一句话描述策略，AI 帮你填表，如「买最便宜的 10% 股票，月度调仓」"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
            <Button
              icon={<FontAwesomeIcon icon={faWandMagicSparkles} />}
              loading={store.parseLoader.loading}
              disabled={!store.nlText.trim()}
              onClick={() => void store.parse()}
            >
              AI 解析填表
            </Button>
            {store.parseLoader.error && (
              <span className="jx-lab-nlError">{store.parseLoader.errorObject?.message}</span>
            )}
          </div>

          <label className="jx-lab-field">
            <span className="jx-lab-label">策略名称</span>
            <Input value={store.name} onChange={(e) => store.setField('name', e.target.value)} />
          </label>

          <div className="jx-lab-row">
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
          </div>

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

          <label className="jx-lab-field">
            <span className="jx-lab-label">打分因子</span>
            <Select
              value={store.selectedPresetKey}
              onChange={(v) => store.setPreset(v)}
              options={[
                ...FACTOR_PRESETS.map((p) => ({ label: p.label, value: p.key })),
                ...(store.selectedPresetKey === 'custom'
                  ? [{ label: '自定义（来自 AI）', value: 'custom', disabled: true }]
                  : []),
              ]}
            />
          </label>

          <div className="jx-lab-row">
            <label className="jx-lab-field">
              <span className="jx-lab-label">方向</span>
              <Select
                value={store.side}
                onChange={(v) => store.setField('side', v)}
                options={[
                  { label: '买高分位', value: 'high' },
                  { label: '买低分位', value: 'low' },
                ]}
              />
            </label>
            <label className="jx-lab-field">
              <span className="jx-lab-label">分位 ({(store.quantile * 100).toFixed(0)}%)</span>
              <InputNumber
                className="jx-lab-control"
                value={store.quantile}
                min={0.05}
                max={1}
                step={0.05}
                onChange={(v) => store.setField('quantile', v ?? 0.1)}
              />
            </label>
          </div>

          <div className="jx-lab-row">
            <label className="jx-lab-field">
              <span className="jx-lab-label">剔次新(天)</span>
              <InputNumber
                className="jx-lab-control"
                value={store.minListDays}
                min={0}
                onChange={(v) => store.setField('minListDays', v ?? 0)}
              />
            </label>
            <label className="jx-lab-field">
              <span className="jx-lab-label">剔流动性(%)</span>
              <InputNumber
                className="jx-lab-control"
                value={store.dropIlliquidPct}
                min={0}
                max={100}
                onChange={(v) => store.setField('dropIlliquidPct', v ?? 0)}
              />
            </label>
          </div>

          <Button
            type="primary"
            block
            loading={loader.loading}
            icon={loader.loading ? undefined : <FontAwesomeIcon icon={faPlay} />}
            onClick={() => store.run()}
          >
            {loader.loading ? '回测中…' : '运行回测'}
          </Button>

          <details className="jx-lab-ir">
            <summary className="jx-lab-irSummary">查看策略 IR</summary>
            <pre className="jx-lab-irCode">{store.irPreview}</pre>
          </details>
        </section>

        <section className="jx-lab-result">
          <ResultPanel />
        </section>
      </main>
    </div>
  );
}, 'Lab');

// —— 子组件 ——

const ResultPanel = complex.component(() => {
  const store = complex.useStore();
  const loader = store.backtestLoader;

  if (loader.loading) {
    return <div className="jx-lab-placeholder">回测计算中，请稍候…</div>;
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
    return <div className="jx-lab-placeholder">配置左侧参数后点「运行回测」查看净值与指标。</div>;
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

// —— 帮助函数 ——

interface Metric {
  label: string;
  value: string;
  tone?: 'up' | 'down';
}

function pct(x: number): string {
  return (x * 100).toFixed(2) + '%';
}
