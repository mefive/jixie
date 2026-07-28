import { lazy, Suspense, useState } from 'react';
import { Button, Popover, Segmented, Skeleton } from 'antd';
import classNames from 'classnames';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';
import type {
  MarketStateMetric,
  MarketStateMetricSummary,
  MarketStateScope,
  MarketStateScopeOption,
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
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopeName = t(marketScopeLabelKey(snapshot.scope));

  return (
    <>
      <section className="jx-marketState-scopeBar">
        <Popover
          open={scopePickerOpen}
          onOpenChange={setScopePickerOpen}
          placement="bottomRight"
          trigger="click"
          content={
            <ScopePicker
              options={snapshot.scopeOptions}
              selectedScope={snapshot.scope}
              onSelect={(scope) => {
                setScopePickerOpen(false);
                onScopeChange(scope);
              }}
            />
          }
        >
          <Button
            className="jx-marketState-scopeTrigger"
            disabled={loading}
            aria-label={t('marketState.scopeLabel')}
          >
            <span>{scopeName}</span>
            <FontAwesomeIcon icon={faChevronDown} />
          </Button>
        </Popover>
        <span className="jx-marketState-toolbarMeta">
          {t('marketState.coverage', {
            date: formatDate(snapshot.asOf),
            count: snapshot.latest.tradedCount,
          })}
        </span>
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
    <article className="jx-marketState-metricCard">
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

function ScopePicker({
  options,
  selectedScope,
  onSelect,
}: {
  options: MarketStateScopeOption[];
  selectedScope: MarketStateScope;
  onSelect: (scope: MarketStateScope) => void;
}) {
  const { t } = useTranslation('valuation');
  const optionByValue = new Map(options.map((option) => [option.value, option]));

  return (
    <div className="jx-marketState-scopePicker">
      {MARKET_SCOPE_GROUPS.map((group, groupIndex) => {
        const groupOptions = group.scopes.flatMap((scope) => {
          const option = optionByValue.get(scope);
          return option ? [option] : [];
        });
        if (groupOptions.length === 0) {
          return null;
        }

        return (
          <section
            key={group.key}
            className={classNames(
              'jx-marketState-scopeGroup',
              `jx-marketState-scopeGroup--${group.key}`,
              {
                'jx-marketState-scopeGroup--divided': groupIndex > 0,
              },
            )}
          >
            <span className="jx-marketState-scopeGroupLabel">
              {t(`marketState.scopeGroups.${group.key}`)}
            </span>
            <div className="jx-marketState-scopeGroupOptions">
              {groupOptions.map((option) => (
                <ScopePickerOption
                  key={option.value}
                  option={option}
                  selected={option.value === selectedScope}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ScopePickerOption({
  option,
  selected,
  onSelect,
}: {
  option: MarketStateScopeOption;
  selected: boolean;
  onSelect: (scope: MarketStateScope) => void;
}) {
  const { t } = useTranslation('valuation');

  return (
    <Button
      type="text"
      className={classNames('jx-marketState-scopeOption', {
        'jx-marketState-scopeOption--selected': selected,
      })}
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(option.value)}
    >
      <span className="jx-marketState-scopeOptionIdentity">
        <i
          className={classNames('jx-marketState-scopeOptionDot', {
            'jx-marketState-scopeOptionDot--selected': selected,
            'jx-marketState-scopeOptionDot--up':
              !selected && option.trend != null && option.trend > 0,
            'jx-marketState-scopeOptionDot--down':
              !selected && option.trend != null && option.trend < 0,
          })}
          aria-hidden="true"
        />
        <strong className="jx-marketState-scopeOptionName">
          {t(marketScopeLabelKey(option.value))}
        </strong>
      </span>
      <span className="jx-marketState-scopeOptionMetric">
        {t('marketState.scopeMetrics.trend')}
        <b className="jx-marketState-scopeOptionMetricValue">{formatSignedPercent(option.trend)}</b>
      </span>
      <span className="jx-marketState-scopeOptionMetric">
        {t('marketState.scopeMetrics.breadth')}
        <b className="jx-marketState-scopeOptionMetricValue">
          {formatPercent(option.breadth, true)}
        </b>
      </span>
    </Button>
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

const MARKET_SCOPE_GROUPS: Array<{
  key: 'broad' | 'boards' | 'styles';
  scopes: MarketStateScope[];
}> = [
  {
    key: 'broad',
    scopes: ['all', '000016.SH', '000300.SH', '000905.SH', '000852.SH', '932000.CSI', '000510.SH'],
  },
  {
    key: 'boards',
    scopes: ['399006.SZ', '000688.SH'],
  },
  {
    key: 'styles',
    scopes: ['000922.CSI'],
  },
];
