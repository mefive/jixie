import { lazy, Suspense, useState } from 'react';
import { Segmented, Skeleton, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type {
  IndustryHeatItem,
  MarketStateMetric,
  MarketStateMetricSummary,
  MarketStateScope,
  MarketStateSnapshot,
} from '@jixie/shared';

const MarketStateChart = lazy(() => import('./market-state-chart'));

interface Props {
  snapshot: MarketStateSnapshot;
  loading: boolean;
  onScopeChange: (scope: MarketStateScope) => void;
}

export function MarketStateOverview({ snapshot, loading, onScopeChange }: Props) {
  const { t } = useTranslation('valuation');
  const [metric, setMetric] = useState<MarketStateMetric>('activity');
  const scopeName = t(marketScopeLabelKey(snapshot.scope));
  const columns: TableColumnsType<IndustryHeatItem> = [
    {
      title: t('marketState.industry.rank'),
      dataIndex: 'rank',
      width: 54,
      align: 'center',
    },
    {
      title: t('marketState.industry.name'),
      dataIndex: 'l1Name',
      width: 110,
      fixed: 'left',
      render: (name: string, item) => (
        <div className="jx-marketState-industryName">
          <strong className="jx-marketState-industryNameLabel">{name}</strong>
          <span className="jx-marketState-industryNameCount">{item.tradedCount}</span>
        </div>
      ),
    },
    {
      title: t('marketState.industry.heat'),
      dataIndex: 'heatScore',
      width: 124,
      sorter: (left, right) => left.heatScore - right.heatScore,
      render: (value: number) => <ScoreBar value={value} emphasis />,
    },
    {
      title: t('marketState.industry.trendScore'),
      dataIndex: 'trendScore',
      width: 112,
      render: (value: number) => <ScoreBar value={value} />,
    },
    {
      title: t('marketState.industry.breadthScore'),
      dataIndex: 'breadthScore',
      width: 112,
      render: (value: number) => <ScoreBar value={value} />,
    },
    {
      title: t('marketState.industry.activityScore'),
      dataIndex: 'activityScore',
      width: 112,
      render: (value: number) => <ScoreBar value={value} />,
    },
    {
      title: t('marketState.industry.excessReturn20'),
      dataIndex: 'excessReturn20',
      width: 106,
      align: 'right',
      sorter: (left, right) => (left.excessReturn20 ?? 0) - (right.excessReturn20 ?? 0),
      render: (value: number | null) => <ReturnValue value={value} />,
    },
    {
      title: t('marketState.industry.turnover'),
      dataIndex: 'turnoverRate',
      width: 92,
      align: 'right',
      render: (value: number | null) => formatPercent(value, false),
    },
    {
      title: t('marketState.industry.amountShare'),
      dataIndex: 'amountShare',
      width: 98,
      align: 'right',
      render: (value: number | null) => formatPercent(value, true),
    },
    {
      title: t('marketState.industry.concentration'),
      dataIndex: 'topFiveAmountShare',
      width: 112,
      align: 'right',
      render: (value: number | null) => formatPercent(value, true),
    },
  ];

  return (
    <>
      <section className="jx-marketState-scopeBar">
        <div className="jx-marketState-scopeCopy">
          <span className="jx-marketState-scopeLabel">{t('marketState.scopeLabel')}</span>
          <p className="jx-marketState-scopeHint">
            {snapshot.scope === 'all'
              ? t('marketState.scopeAllHint', {
                  start: formatDate(snapshot.availableStart),
                })
              : t('marketState.scopeIndexHint', {
                  start: formatDate(snapshot.availableStart),
                  membership: formatDate(snapshot.membershipAsOf ?? snapshot.asOf),
                })}
          </p>
        </div>
        <Segmented
          className="jx-marketState-scopeSegmented"
          value={snapshot.scope}
          disabled={loading}
          onChange={(value) => onScopeChange(value as MarketStateScope)}
          options={snapshot.scopeOptions.map((option) => ({
            value: option.value,
            label: t(marketScopeLabelKey(option.value)),
          }))}
        />
      </section>

      <section className="jx-marketState-summary" aria-label={t('marketState.summaryLabel')}>
        {MARKET_METRICS.map((summaryMetric) => (
          <MarketMetricCard
            key={summaryMetric}
            metric={summaryMetric}
            summary={snapshot.summaries[summaryMetric]}
            scopeName={scopeName}
          />
        ))}
      </section>

      <section className="jx-marketState-detailStrip">
        <DetailItem
          label={t('marketState.details.aboveMa20')}
          value={formatPercent(snapshot.latest.aboveMa20Ratio, true)}
        />
        <DetailItem
          label={t('marketState.details.aboveMa60')}
          value={formatPercent(snapshot.latest.aboveMa60Ratio, true)}
        />
        <DetailItem
          label={t('marketState.details.advance')}
          value={formatPercent(snapshot.latest.advanceRatio, true)}
        />
        <DetailItem
          label={t('marketState.details.limit')}
          value={t('marketState.details.limitValue', {
            up: snapshot.latest.limitUpCount,
            down: snapshot.latest.limitDownCount,
          })}
        />
        <DetailItem
          label={t('marketState.details.amount', { scope: scopeName })}
          value={
            snapshot.latest.totalAmount == null
              ? '—'
              : t('marketState.details.amountValue', {
                  value: Math.round(snapshot.latest.totalAmount / 100_000).toLocaleString(),
                })
          }
        />
      </section>

      <section className="jx-marketState-chartCard">
        <div className="jx-marketState-cardHead">
          <div>
            <h2 className="jx-marketState-cardTitle">
              {t('marketState.history.title', { scope: scopeName })}
            </h2>
            <p className="jx-marketState-cardSubtitle">{t('marketState.history.subtitle')}</p>
          </div>
          <Segmented
            size="small"
            value={metric}
            onChange={(value) => setMetric(value as MarketStateMetric)}
            options={MARKET_METRICS.map((key) => ({
              value: key,
              label: t(metricLabelKey(key)),
            }))}
          />
        </div>
        <Suspense fallback={<Skeleton.Node active className="jx-marketState-chartSkeleton" />}>
          <MarketStateChart metric={metric} points={snapshot.points} />
        </Suspense>
      </section>

      <section className="jx-marketState-industryCard">
        <div className="jx-marketState-cardHead">
          <div>
            <h2 className="jx-marketState-cardTitle">{t('marketState.industry.title')}</h2>
            <p className="jx-marketState-cardSubtitle">{t('marketState.industry.subtitle')}</p>
          </div>
          <span className="jx-marketState-asOf">
            {t('marketState.industry.asOf', { date: formatDate(snapshot.asOf) })}
          </span>
        </div>
        <Table
          className="jx-marketState-industryTable"
          rowKey="l1Code"
          size="small"
          columns={columns}
          dataSource={snapshot.industries}
          pagination={false}
          scroll={{ x: 1030 }}
        />
      </section>

      <section className="jx-marketState-method">
        <span className="jx-marketState-methodLabel">{t('marketState.methodLabel')}</span>
        <p className="jx-marketState-methodText">
          {snapshot.scope === 'all'
            ? t('marketState.methodAllText')
            : t('marketState.methodIndexText')}
        </p>
      </section>
    </>
  );
}

// —— Subcomponents / helpers ——

function MarketMetricCard({
  metric,
  summary,
  scopeName,
}: {
  metric: MarketStateMetric;
  summary: MarketStateMetricSummary;
  scopeName: string;
}) {
  const { t } = useTranslation('valuation');
  const percentile = toPercent(summary.percentile3Year);

  return (
    <article className={`jx-marketState-metricCard jx-marketState-metricCard--${metric}`}>
      <div className="jx-marketState-metricHead">
        <span className="jx-marketState-metricLabel">{t(metricLabelKey(metric))}</span>
        <strong className="jx-marketState-metricValue">
          {formatMetric(summary.value, metric)}
        </strong>
      </div>
      <p className="jx-marketState-metricDescription">
        {t(metricDescriptionKey(metric), { scope: scopeName })}
      </p>
      <div className="jx-marketState-percentile">
        <span className="jx-marketState-percentileLabel">
          {t('marketState.threeYearPercentile')}
        </span>
        <strong className="jx-marketState-percentileValue">
          {formatPercentile(summary.percentile3Year)}
        </strong>
      </div>
      <div className="jx-marketState-track" aria-hidden="true">
        <span className="jx-marketState-trackFill" style={{ width: `${percentile}%` }} />
      </div>
    </article>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="jx-marketState-detailItem">
      <span className="jx-marketState-detailLabel">{label}</span>
      <strong className="jx-marketState-detailValue">{value}</strong>
    </div>
  );
}

function ScoreBar({ value, emphasis = false }: { value: number; emphasis?: boolean }) {
  return (
    <div
      className={classNames('jx-marketState-score', {
        'jx-marketState-score--emphasis': emphasis,
      })}
    >
      <span className="jx-marketState-scoreValue">{Math.round(value)}</span>
      <i className="jx-marketState-scoreTrack">
        <b
          className="jx-marketState-scoreFill"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </i>
    </div>
  );
}

function ReturnValue({ value }: { value: number | null }) {
  return (
    <span
      className={classNames('jx-marketState-return', {
        'text-up': value != null && value > 0,
        'text-down': value != null && value < 0,
      })}
    >
      {formatSignedPercent(value)}
    </span>
  );
}

function metricLabelKey(metric: MarketStateMetric) {
  return `marketState.metrics.${metric}.label` as const;
}

function metricDescriptionKey(metric: MarketStateMetric) {
  return `marketState.metrics.${metric}.description` as const;
}

function marketScopeLabelKey(scope: MarketStateScope) {
  return `marketState.scopes.${scope === 'all' ? 'all' : scope.replaceAll('.', '_')}` as const;
}

function formatMetric(value: number | null, metric: MarketStateMetric): string {
  if (value == null) {
    return '—';
  }
  return metric === 'activity' ? `${value.toFixed(2)}%` : formatPercent(value, true);
}

function formatPercent(value: number | null, decimal: boolean): string {
  if (value == null) {
    return '—';
  }
  const percent = decimal ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function formatSignedPercent(value: number | null): string {
  if (value == null) {
    return '—';
  }
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function formatPercentile(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function toPercent(value: number | null): number {
  return value == null ? 0 : Math.max(0, Math.min(100, value * 100));
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

const MARKET_METRICS: MarketStateMetric[] = ['activity', 'breadth', 'trend', 'crowding'];
