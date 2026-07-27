import { lazy, Suspense, useMemo, useState } from 'react';
import { Alert, Segmented, Select, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import type {
  IndexValuationMetric,
  IndexValuationMetricSummary,
  IndexValuationPoint,
} from '@jixie/shared';
import { complex } from './complex';
import './valuation.css';

const ValuationChart = lazy(() => import('./valuation-chart'));

type HistoryRange = '5y' | '10y' | 'all';

export const Valuation = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('valuation');
  const [metric, setMetric] = useState<IndexValuationMetric>('peTtm');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('10y');
  const series = store.seriesLoader.result;
  const catalog = store.catalogLoader.result;
  const loading = store.seriesLoader.loading || !series;
  const displayPoints = useMemo(
    () => (series ? filterPoints(series.points, series.asOf, historyRange) : []),
    [series, historyRange],
  );
  const indexName = t(indexNameKey(store.code));

  return (
    <div className="jx-valuation">
      <main className="jx-valuation-body">
        <section className="jx-valuation-hero">
          <div className="jx-valuation-heroCopy">
            <span className="jx-valuation-kicker">{t('kicker')}</span>
            <h1 className="jx-valuation-title">{t('title')}</h1>
            <p className="jx-valuation-subtitle">{t('subtitle')}</p>
          </div>
          <div className="jx-valuation-indexControl">
            <label className="jx-valuation-controlLabel">{t('selectIndex')}</label>
            <Select
              className="jx-valuation-indexSelect"
              value={store.code}
              loading={store.catalogLoader.loading}
              onChange={(code) => store.setCode(code)}
              options={(catalog?.indices ?? []).map((index) => ({
                value: index.tsCode,
                label: `${t(indexNameKey(index.tsCode))} · ${index.tsCode}`,
              }))}
            />
            <span className="jx-valuation-updated">
              {series ? t('updated', { date: formatDate(series.asOf) }) : t('loading')}
            </span>
          </div>
        </section>

        {store.seriesLoader.error ? (
          <Alert
            type="error"
            showIcon
            message={t('loadFailed')}
            description={store.seriesLoader.errorObject?.message}
          />
        ) : loading ? (
          <DashboardSkeleton />
        ) : (
          <>
            <section className="jx-valuation-summary" aria-label={t('summaryLabel')}>
              {SUMMARY_METRICS.map((summaryMetric) => (
                <MetricCard
                  key={summaryMetric}
                  metric={summaryMetric}
                  summary={series.summaries[summaryMetric]}
                />
              ))}
            </section>

            <section className="jx-valuation-chartCard">
              <div className="jx-valuation-chartHead">
                <div>
                  <h2 className="jx-valuation-chartTitle">
                    {t('chartTitle', { index: indexName })}
                  </h2>
                  <p className="jx-valuation-chartSubtitle">{t('chartSubtitle')}</p>
                </div>
                <div className="jx-valuation-chartControls">
                  <Segmented
                    size="small"
                    value={metric}
                    onChange={(value) => setMetric(value as IndexValuationMetric)}
                    options={SUMMARY_METRICS.map((key) => ({
                      value: key,
                      label: t(metricLabelKey(key)),
                    }))}
                  />
                  <Segmented
                    size="small"
                    value={historyRange}
                    onChange={(value) => setHistoryRange(value as HistoryRange)}
                    options={[
                      { value: '5y', label: t('range.fiveYear') },
                      { value: '10y', label: t('range.tenYear') },
                      { value: 'all', label: t('range.all') },
                    ]}
                  />
                </div>
              </div>
              <Suspense fallback={<ChartSkeleton />}>
                <ValuationChart indexName={indexName} metric={metric} points={displayPoints} />
              </Suspense>
            </section>

            <section className="jx-valuation-method">
              <span className="jx-valuation-methodLabel">{t('methodLabel')}</span>
              <p className="jx-valuation-methodText">{t('methodText')}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}, 'Valuation');

// —— Subcomponents / helpers ——

function MetricCard({
  metric,
  summary,
}: {
  metric: IndexValuationMetric;
  summary: IndexValuationMetricSummary;
}) {
  const { t } = useTranslation('valuation');
  const tenYearPercent = toPercent(summary.percentile10Year);

  return (
    <article className="jx-valuation-metricCard">
      <div className="jx-valuation-metricHead">
        <span className="jx-valuation-metricLabel">{t(metricLabelKey(metric))}</span>
        <span className="jx-valuation-metricValue">{formatMetric(summary.value, metric)}</span>
      </div>
      <div className="jx-valuation-percentileMain">
        <span>{t('tenYearPercentile')}</span>
        <strong className="jx-valuation-percentileValue">
          {formatPercentile(summary.percentile10Year)}
        </strong>
      </div>
      <div className="jx-valuation-percentileTrack" aria-hidden="true">
        <span className="jx-valuation-percentileFill" style={{ width: `${tenYearPercent}%` }} />
      </div>
      <div className="jx-valuation-percentileFoot">
        <span>{t('low')}</span>
        <span>
          {t('allHistoryPercentile')} {formatPercentile(summary.percentileAll)}
        </span>
        <span>{t('high')}</span>
      </div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="jx-valuation-dashboardSkeleton">
      <Skeleton active paragraph={{ rows: 3 }} />
      <Skeleton active paragraph={{ rows: 9 }} />
    </div>
  );
}

function ChartSkeleton() {
  return <Skeleton.Node active className="jx-valuation-chartSkeleton" />;
}

function filterPoints(
  points: IndexValuationPoint[],
  asOf: string,
  historyRange: HistoryRange,
): IndexValuationPoint[] {
  if (historyRange === 'all') {
    return points;
  }

  const years = historyRange === '5y' ? 5 : 10;
  const start = `${Number(asOf.slice(0, 4)) - years}${asOf.slice(4)}`;
  return points.filter((point) => point.date >= start);
}

function toPercent(value: number | null): number {
  return value == null ? 0 : Math.max(0, Math.min(100, value * 100));
}

function formatPercentile(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function formatMetric(value: number | null, metric: IndexValuationMetric): string {
  if (value == null) {
    return '—';
  }
  return metric === 'turnoverRate' ? `${value.toFixed(2)}%` : value.toFixed(2);
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function metricLabelKey(metric: IndexValuationMetric) {
  return `metrics.${metric}` as const;
}

function indexNameKey(code: string) {
  return INDEX_NAME_KEYS[code] ?? 'indices.unknown';
}

const SUMMARY_METRICS: IndexValuationMetric[] = ['peTtm', 'pb', 'pe', 'turnoverRate'];

const INDEX_NAME_KEYS: Record<string, string> = {
  '000001.SH': 'indices.sseComposite',
  '000016.SH': 'indices.sse50',
  '000300.SH': 'indices.csi300',
  '000905.SH': 'indices.csi500',
  '399001.SZ': 'indices.szComponent',
  '399005.SZ': 'indices.sme',
  '399006.SZ': 'indices.chiNext',
};
