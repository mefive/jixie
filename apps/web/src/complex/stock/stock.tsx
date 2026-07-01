import { lazy, Suspense, useState } from 'react';
import { Segmented } from 'antd';
import { TopNav } from '@src/components/top-nav';
import { complex } from './complex';
import type { Adjust } from './stock-chart';
import './stock.css';

const StockChart = lazy(() => import('./stock-chart'));

export const Stock = complex.component(() => {
  const store = complex.useStore();
  const series = store.seriesLoader.result;
  const loading = store.seriesLoader.loading;
  const [scale, setScale] = useState<'linear' | 'log'>('linear'); // 价格 Y 轴线性/对数 (纯 UI 态)
  const [adjust, setAdjust] = useState<Adjust>('qfq'); // 复权方式,默认前复权

  return (
    <div className="jx-stock">
      <TopNav />
      <main className="jx-stock-body">
        <div className="jx-stock-head">
          <span className="jx-stock-title">{series ? series.name : store.code}</span>
          <span className="jx-stock-code">{series?.tsCode ?? store.code}</span>
          <Segmented
            className="jx-stock-toggle"
            size="small"
            value={adjust}
            onChange={(v) => setAdjust(v as Adjust)}
            options={[
              { label: '前复权', value: 'qfq' },
              { label: '后复权', value: 'hfq' },
              { label: '不复权', value: 'none' },
            ]}
          />
          <Segmented
            className="jx-stock-toggle"
            size="small"
            value={scale}
            onChange={(v) => setScale(v as 'linear' | 'log')}
            options={[
              { label: '线性', value: 'linear' },
              { label: '对数', value: 'log' },
            ]}
          />
        </div>

        {store.seriesLoader.error ? (
          <div className="jx-stock-placeholder jx-stock-placeholder--error">
            行情加载失败：{store.seriesLoader.errorObject?.message}
          </div>
        ) : loading || !series ? (
          <ChartSkeleton />
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            <StockChart series={series} logY={scale === 'log'} adjust={adjust} className="jx-stock-chart" />
          </Suspense>
        )}
      </main>
    </div>
  );
}, 'Stock');

// —— 子组件 ——

// Candlestick-shaped loading skeleton for the chart area — shimmering bars of a fixed height pattern.
// (A chart skeleton is the §5 chart exception to "no hand-drawn shapes"; antd Skeleton has no chart form.)
function ChartSkeleton() {
  return (
    <div className="jx-stock-chart jx-stock-skeleton" aria-label="加载行情…">
      {SKELETON_BARS.map((h, i) => (
        <span key={i} className="jx-stock-skeletonBar" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

// Static height pattern (%) so the skeleton is deterministic — no per-render randomness.
const SKELETON_BARS = [40, 55, 48, 62, 70, 58, 66, 74, 68, 80, 72, 85, 78, 64, 56, 60, 52, 46, 50, 44];
