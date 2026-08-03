import { lazy, Suspense, useState } from 'react';
import { Button, Popover, Segmented, Skeleton, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import classNames from 'classnames';
import { faArrowDown, faArrowUp, faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';
import type {
  IndustryHeatItem,
  IndustryWeatherSeries,
  MarketStylePair,
  MarketStateMetric,
  MarketStateMetricSummary,
  MarketStateScope,
  MarketStateScopeOption,
  MarketStateSnapshot,
  MarketWeatherFrequency,
} from '@jixie/shared';
import { IndustryWeatherMap } from './industry-weather-map';

const IndustryStateMap = lazy(() => import('./industry-state-map'));
const MarketStateChart = lazy(() => import('./market-state-chart'));

interface Props {
  snapshot: MarketStateSnapshot;
  loading: boolean;
  weatherSeries: IndustryWeatherSeries | null;
  weatherLoading: boolean;
  weatherFrequency: MarketWeatherFrequency;
  onScopeChange: (scope: MarketStateScope) => void;
  onWeatherFrequencyChange: (frequency: MarketWeatherFrequency) => void;
}

export function MarketStateOverview({
  snapshot,
  loading,
  weatherSeries,
  weatherLoading,
  weatherFrequency,
  onScopeChange,
  onWeatherFrequencyChange,
}: Props) {
  const { t } = useTranslation('valuation');
  const [metric, setMetric] = useState<MarketStateMetric>('activity');
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const [selectedIndustryCode, setSelectedIndustryCode] = useState<string | null>(null);
  const scopeName = t(marketScopeLabelKey(snapshot.scope));
  const leadingIndustry = snapshot.industries.at(0);
  const mostActiveIndustry = snapshot.industries.reduce<IndustryHeatItem | null>(
    (current, industry) =>
      current == null || industry.activityScore > current.activityScore ? industry : current,
    null,
  );
  const mostUndervaluedIndustry = snapshot.industries.reduce<IndustryHeatItem | null>(
    (current, industry) => {
      const valuation = averagePercentiles([
        industry.pePercentile10Year,
        industry.pbPercentile10Year,
      ]);
      const currentValuation = current
        ? averagePercentiles([current.pePercentile10Year, current.pbPercentile10Year])
        : null;
      return valuation != null && (currentValuation == null || valuation < currentValuation)
        ? industry
        : current;
    },
    null,
  );
  const industryColumns = buildIndustryColumns(t);

  return (
    <>
      <IndustryWeatherMap
        series={weatherSeries}
        loading={weatherLoading}
        frequency={weatherFrequency}
        onFrequencyChange={onWeatherFrequencyChange}
      />

      <div className="jx-marketState-layerHead">
        <span className="jx-marketState-layerIndex">02</span>
        <div>
          <h2 className="jx-marketState-cardTitle">{t('marketState.index.title')}</h2>
          <p className="jx-marketState-cardSubtitle">{t('marketState.index.subtitle')}</p>
        </div>
      </div>
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

      <section className="jx-marketState-readout">
        <Tag
          bordered={false}
          className={`jx-marketState-regime jx-marketState-regime--${snapshot.regime}`}
        >
          {t(`marketState.regimes.${snapshot.regime}`)}
        </Tag>
        <p className="jx-marketState-readoutText">
          {t('marketState.readout', {
            leader: leadingIndustry?.l1Name ?? '—',
            active: mostActiveIndustry?.l1Name ?? '—',
            undervalued: mostUndervaluedIndustry?.l1Name ?? '—',
            breadth: formatPercent(snapshot.latest.breadth, true),
          })}
        </p>
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

      <section className="jx-marketState-styleCard">
        <div className="jx-marketState-cardHead">
          <div className="jx-marketState-layerTitle">
            <span className="jx-marketState-layerIndex">03</span>
            <div>
              <h2 className="jx-marketState-cardTitle">{t('marketState.style.title')}</h2>
              <p className="jx-marketState-cardSubtitle">{t('marketState.style.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="jx-marketState-styleGrid">
          {snapshot.stylePairs.map((pair) => (
            <StylePairCard key={pair.key} pair={pair} />
          ))}
        </div>
      </section>

      <section className="jx-marketState-industryMapCard">
        <div className="jx-marketState-cardHead">
          <div className="jx-marketState-layerTitle">
            <span className="jx-marketState-layerIndex">04</span>
            <div>
              <h2 className="jx-marketState-cardTitle">{t('marketState.industryMap.title')}</h2>
              <p className="jx-marketState-cardSubtitle">{t('marketState.industryMap.subtitle')}</p>
            </div>
          </div>
          <span className="jx-marketState-asOf">
            {t('marketState.industry.asOf', { date: formatDate(snapshot.asOf) })}
          </span>
        </div>
        <Suspense
          fallback={<Skeleton.Node active className="jx-marketState-industryMapSkeleton" />}
        >
          <IndustryStateMap
            industries={snapshot.industries}
            selectedIndustryCode={selectedIndustryCode}
            onSelect={setSelectedIndustryCode}
          />
        </Suspense>
      </section>

      <section className="jx-marketState-industryCard">
        <div className="jx-marketState-cardHead">
          <div>
            <h2 className="jx-marketState-cardTitle">{t('marketState.industry.title')}</h2>
            <p className="jx-marketState-cardSubtitle">{t('marketState.industry.subtitle')}</p>
          </div>
        </div>
        <Table
          className="jx-marketState-industryTable"
          rowKey="l1Code"
          size="small"
          columns={industryColumns}
          dataSource={snapshot.industries}
          pagination={false}
          scroll={{ x: 1420 }}
          rowClassName={(industry) =>
            classNames({
              'jx-marketState-industryRow--selected': industry.l1Code === selectedIndustryCode,
            })
          }
          onRow={(industry) => ({
            onClick: () => setSelectedIndustryCode(industry.l1Code),
          })}
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

function StylePairCard({ pair }: { pair: MarketStylePair }) {
  const { t } = useTranslation('valuation');
  const growthLeading = pair.spread20Day == null || pair.spread20Day >= 0;
  const leadingName = growthLeading ? pair.growth.name : pair.value.name;

  return (
    <article className="jx-marketState-stylePair">
      <div className="jx-marketState-stylePairHead">
        <span className="jx-marketState-stylePairLabel">
          {t(`marketState.style.pairs.${pair.key}`)}
        </span>
        <span className="jx-marketState-stylePairNames">
          {pair.growth.name} / {pair.value.name}
        </span>
      </div>
      <div className="jx-marketState-styleLead">
        <strong>{leadingName}</strong>
        <span>
          {pair.spread20Day == null
            ? '—'
            : t('marketState.style.leadValue', {
                value: formatAbsolutePercent(pair.spread20Day),
              })}
        </span>
      </div>
      <div className="jx-marketState-stylePeriods">
        <StylePeriod
          label={t('marketState.style.periods.fiveDay')}
          left={pair.growth.return5Day}
          right={pair.value.return5Day}
        />
        <StylePeriod
          label={t('marketState.style.periods.twentyDay')}
          left={pair.growth.return20Day}
          right={pair.value.return20Day}
          emphasis
        />
        <StylePeriod
          label={t('marketState.style.periods.sixtyDay')}
          left={pair.growth.return60Day}
          right={pair.value.return60Day}
        />
      </div>
      <div className="jx-marketState-styleBreadth">
        <span>{t('marketState.style.officialSource')}</span>
        <strong>{pair.growth.source}</strong>
      </div>
    </article>
  );
}

function StylePeriod({
  label,
  left,
  right,
  emphasis = false,
}: {
  label: string;
  left: number | null | undefined;
  right: number | null | undefined;
  emphasis?: boolean;
}) {
  return (
    <div
      className={classNames('jx-marketState-stylePeriod', {
        'jx-marketState-stylePeriod--emphasis': emphasis,
      })}
    >
      <span>{label}</span>
      <strong>{formatSpreadPair(left, right)}</strong>
    </div>
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
              !selected && option.return20Day != null && option.return20Day > 0,
            'jx-marketState-scopeOptionDot--down':
              !selected && option.return20Day != null && option.return20Day < 0,
          })}
          aria-hidden="true"
        />
        <strong className="jx-marketState-scopeOptionName">
          {t(marketScopeLabelKey(option.value))}
        </strong>
      </span>
      <span className="jx-marketState-scopeOptionMetric">
        {t('marketState.scopeMetrics.trend')}
        <b className="jx-marketState-scopeOptionMetricValue">
          {formatSignedPercent(option.return20Day)}
        </b>
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

function IndustryStateTag({ industry }: { industry: IndustryHeatItem }) {
  const { t } = useTranslation('valuation');
  const state = industryState(industry);

  return (
    <Tag
      bordered={false}
      className={`jx-marketState-industryTag jx-marketState-industryTag--${state}`}
    >
      {t(`marketState.industry.states.${state}`)}
    </Tag>
  );
}

function IndustryValuationTag({ industry }: { industry: IndustryHeatItem }) {
  const { t } = useTranslation('valuation');
  const state = industryValuationState(industry);

  return (
    <Tag
      bordered={false}
      className={`jx-marketState-valuationTag jx-marketState-valuationTag--${state}`}
    >
      {t(`marketState.industry.valuationStates.${state}`)}
    </Tag>
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

function RankChange({ value }: { value: number | null }) {
  if (value == null || value === 0) {
    return <span className="jx-marketState-rankChange">—</span>;
  }

  return (
    <span
      className={classNames('jx-marketState-rankChange', {
        'jx-marketState-rankChange--up': value > 0,
        'jx-marketState-rankChange--down': value < 0,
      })}
    >
      <FontAwesomeIcon icon={value > 0 ? faArrowUp : faArrowDown} />
      {Math.abs(value)}
    </span>
  );
}

function buildIndustryColumns(
  t: ReturnType<typeof useTranslation<'valuation'>>['t'],
): TableColumnsType<IndustryHeatItem> {
  return [
    {
      title: t('marketState.industry.rank'),
      dataIndex: 'rank',
      width: 58,
      align: 'center',
    },
    {
      title: t('marketState.industry.name'),
      dataIndex: 'l1Name',
      width: 118,
      fixed: 'left',
      render: (name: string, industry) => (
        <div className="jx-marketState-industryName">
          <strong className="jx-marketState-industryNameLabel">{name}</strong>
          <span className="jx-marketState-industryNameCount">{industry.tradedCount}</span>
        </div>
      ),
    },
    {
      title: t('marketState.industry.state'),
      key: 'state',
      width: 92,
      render: (_, industry) => <IndustryStateTag industry={industry} />,
    },
    {
      title: t('marketState.industry.valuation'),
      key: 'valuation',
      width: 88,
      render: (_, industry) => <IndustryValuationTag industry={industry} />,
    },
    {
      title: t('marketState.industry.heat'),
      dataIndex: 'heatScore',
      width: 132,
      sorter: (left, right) => left.heatScore - right.heatScore,
      render: (value: number) => <ScoreBar value={value} emphasis />,
    },
    {
      title: t('marketState.industry.officialReturn20'),
      dataIndex: 'officialReturn20Day',
      width: 112,
      align: 'right',
      sorter: (left, right) => (left.officialReturn20Day ?? 0) - (right.officialReturn20Day ?? 0),
      render: (value: number | null) => <ReturnValue value={value} />,
    },
    {
      title: t('marketState.industry.pePosition'),
      key: 'pePosition',
      width: 105,
      align: 'right',
      render: (_, industry) => formatValuationPosition(industry.pe, industry.pePercentile10Year),
    },
    {
      title: t('marketState.industry.pbPosition'),
      key: 'pbPosition',
      width: 105,
      align: 'right',
      render: (_, industry) => formatValuationPosition(industry.pb, industry.pbPercentile10Year),
    },
    {
      title: t('marketState.industry.activityScore'),
      dataIndex: 'activityScore',
      width: 122,
      sorter: (left, right) => left.activityScore - right.activityScore,
      render: (value: number) => <ScoreBar value={value} />,
    },
    {
      title: t('marketState.industry.breadthScore'),
      dataIndex: 'breadthScore',
      width: 122,
      sorter: (left, right) => left.breadthScore - right.breadthScore,
      render: (value: number) => <ScoreBar value={value} />,
    },
    {
      title: t('marketState.industry.amountShare'),
      dataIndex: 'amountShare',
      width: 98,
      align: 'right',
      render: (value: number | null) => formatPercent(value, true),
    },
    {
      title: t('marketState.industry.rankChange5Day'),
      dataIndex: 'rankChange5Day',
      width: 94,
      align: 'center',
      sorter: (left, right) => (left.rankChange5Day ?? 0) - (right.rankChange5Day ?? 0),
      render: (value: number | null) => <RankChange value={value} />,
    },
    {
      title: t('marketState.industry.rankChange20Day'),
      dataIndex: 'rankChange20Day',
      width: 94,
      align: 'center',
      sorter: (left, right) => (left.rankChange20Day ?? 0) - (right.rankChange20Day ?? 0),
      render: (value: number | null) => <RankChange value={value} />,
    },
    {
      title: t('marketState.industry.concentration'),
      dataIndex: 'topFiveAmountShare',
      width: 104,
      align: 'right',
      render: (value: number | null) => formatPercent(value, true),
    },
  ];
}

function industryState(industry: IndustryHeatItem): IndustryState {
  if (
    industry.heatScore >= 85 &&
    industry.activityScore >= 80 &&
    (industry.officialReturn20Day ?? 0) > 0
  ) {
    return 'overheated';
  }
  if (industry.heatScore >= 75 && industry.breadthScore >= 60) {
    return 'leading';
  }
  if (industry.activityScore >= 75 && (industry.officialReturn20Day ?? 0) <= 0) {
    return 'activeLagging';
  }
  if (industry.heatScore <= 25) {
    return 'cooling';
  }
  return 'balanced';
}

function industryValuationState(industry: IndustryHeatItem): IndustryValuationState {
  const percentile = averagePercentiles([industry.pePercentile10Year, industry.pbPercentile10Year]);
  if (percentile == null) {
    return 'unknown';
  }
  if (percentile <= 0.3) {
    return 'low';
  }
  if (percentile >= 0.7) {
    return 'high';
  }
  return 'neutral';
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

function formatSignedPercent(value: number | null | undefined): string {
  if (value == null) {
    return '—';
  }
  const percent = value * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function formatAbsolutePercent(value: number): string {
  return `${Math.abs(value * 100).toFixed(2)}%`;
}

function formatSpreadPair(
  left: number | null | undefined,
  right: number | null | undefined,
): string {
  return `${formatSignedPercent(left)} / ${formatSignedPercent(right)}`;
}

function formatValuationPosition(value: number | null, percentile: number | null): string {
  if (value == null || percentile == null) {
    return '—';
  }
  return `${value.toFixed(1)} / P${Math.round(percentile * 100)}`;
}

function averagePercentiles(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => value != null);
  return valid.length === 0
    ? null
    : valid.reduce((total, value) => total + value, 0) / valid.length;
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

type IndustryState = 'overheated' | 'leading' | 'activeLagging' | 'cooling' | 'balanced';
type IndustryValuationState = 'low' | 'neutral' | 'high' | 'unknown';

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
