import { lazy, Suspense, useState } from 'react';
import { Segmented } from 'antd';
import { useTranslation } from 'react-i18next';
import { complex } from './complex';
import type { Adjust } from './stock-chart';
import './stock.css';

const StockChart = lazy(() => import('./stock-chart'));

export const Stock = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('stock');
  const series = store.seriesLoader.result;
  const loading = store.seriesLoader.loading;
  const [scale, setScale] = useState<'linear' | 'log'>('linear'); // price Y axis: linear/log (pure UI state)
  const [adjust, setAdjust] = useState<Adjust>('qfq'); // adjustment mode, defaults to forward-adjustment (qfq)

  return (
    <div className="jx-stock">
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
              { label: t('adjust.qfq'), value: 'qfq' },
              { label: t('adjust.hfq'), value: 'hfq' },
              { label: t('adjust.none'), value: 'none' },
            ]}
          />
          <Segmented
            className="jx-stock-toggle"
            size="small"
            value={scale}
            onChange={(v) => setScale(v as 'linear' | 'log')}
            options={[
              { label: t('scale.linear'), value: 'linear' },
              { label: t('scale.log'), value: 'log' },
            ]}
          />
        </div>

        {store.seriesLoader.error ? (
          <div className="jx-stock-placeholder jx-stock-placeholder--error">
            {t('loadFailed', { message: store.seriesLoader.errorObject?.message })}
          </div>
        ) : loading || !series ? (
          <ChartSkeleton />
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            <StockChart
              series={series}
              logY={scale === 'log'}
              adjust={adjust}
              className="jx-stock-chart"
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}, 'Stock');

// —— Subcomponents ——

// Candlestick-shaped loading skeleton for the chart area — shimmering bars of a fixed height pattern.
// (A chart skeleton is the §5 chart exception to "no hand-drawn shapes"; antd Skeleton has no chart form.)
function ChartSkeleton() {
  const { t } = useTranslation('stock');
  return (
    <div className="jx-stock-chart jx-stock-skeleton" aria-label={t('loadingLabel')}>
      {SKELETON_BARS.map((h, i) => (
        <span key={i} className="jx-stock-skeletonBar" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

// Static height pattern (%) so the skeleton is deterministic — no per-render randomness.
const SKELETON_BARS = [
  40, 55, 48, 62, 70, 58, 66, 74, 68, 80, 72, 85, 78, 64, 56, 60, 52, 46, 50, 44,
];
