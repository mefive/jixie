import { useEffect, useMemo, useState } from 'react';
import { Button, Drawer, Segmented, Skeleton, Slider, Tooltip } from 'antd';
import classNames from 'classnames';
import {
  faArrowTrendDown,
  faArrowTrendUp,
  faBackwardStep,
  faForwardStep,
  faPause,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useTranslation } from 'react-i18next';
import type {
  MarketWeatherDimension,
  MarketWeatherFrequency,
  MarketWeatherItem,
  MarketWeatherSeries,
  MarketWeatherState,
} from '@jixie/shared';
import './industry-weather-map.css';

interface Props {
  series: MarketWeatherSeries | null;
  loading: boolean;
  dimension: MarketWeatherDimension;
  frequency: MarketWeatherFrequency;
  onDimensionChange: (dimension: MarketWeatherDimension) => void;
  onFrequencyChange: (frequency: MarketWeatherFrequency) => void;
}

export function MarketWeatherMap({
  series,
  loading,
  dimension,
  frequency,
  onDimensionChange,
  onFrequencyChange,
}: Props) {
  const { t } = useTranslation('valuation');
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null);
  const displayFrequency = series?.frequency ?? frequency;

  useEffect(() => {
    setSelectedPeriodIndex(Math.max(0, (series?.periods.length ?? 1) - 1));
    setPlaying(false);
    setSelectedItemCode(null);
  }, [series]);

  useEffect(() => {
    if (!playing || !series || series.periods.length < 2) {
      return;
    }

    const timer = window.setInterval(() => {
      setSelectedPeriodIndex((current) => (current >= series.periods.length - 1 ? 0 : current + 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [playing, series]);

  const period = series?.periods[selectedPeriodIndex];
  const itemByCode = useMemo(
    () => new Map(period?.items.map((item) => [item.code, item]) ?? []),
    [period],
  );
  const selectedItem = selectedItemCode ? (itemByCode.get(selectedItemCode) ?? null) : null;
  const attentionNames = period
    ? period.items
        .filter((item) => ATTENTION_STATES.has(item.state))
        .slice(0, 3)
        .map((item) => item.name)
        .join('、')
    : '—';
  const warningNames = period
    ? period.items
        .filter((item) => WARNING_STATES.has(item.state))
        .slice(0, 2)
        .map((item) => item.name)
        .join('、')
    : '—';

  return (
    <section className="jx-industryWeather">
      <div className="jx-industryWeather-head">
        <div>
          <div className="jx-industryWeather-eyebrow">{t('marketState.weather.eyebrow')}</div>
          <h2 className="jx-industryWeather-title">
            {t(`marketState.weather.dimensions.${dimension}.title`)}
          </h2>
          <p className="jx-industryWeather-subtitle">
            {t(`marketState.weather.dimensions.${dimension}.subtitle`)}
          </p>
        </div>
        <div className="jx-industryWeather-controls">
          <Segmented
            className="jx-industryWeather-dimension"
            value={dimension}
            disabled={loading}
            onChange={(value) => onDimensionChange(value as MarketWeatherDimension)}
            options={WEATHER_DIMENSIONS.map((value) => ({
              value,
              label: t(`marketState.weather.dimensions.${value}.label`),
            }))}
          />
          <Segmented
            className="jx-industryWeather-frequency"
            value={frequency}
            disabled={loading}
            onChange={(value) => onFrequencyChange(value as MarketWeatherFrequency)}
            options={WEATHER_FREQUENCIES.map((value) => ({
              value,
              label: t(`marketState.weather.frequencies.${value}`),
            }))}
          />
        </div>
      </div>

      {series && period ? (
        <>
          <div className="jx-industryWeather-brief">
            <div className="jx-industryWeather-periodReadout">
              <strong>{formatPeriodLabel(period.key, displayFrequency, t)}</strong>
              <span>
                {t('marketState.weather.snapshotDate', { date: formatDate(period.snapshotDate) })}
              </span>
            </div>
            <p>
              {t('marketState.weather.readout', {
                attention: attentionNames || '—',
                warning: warningNames || '—',
              })}
            </p>
          </div>

          <div className="jx-industryWeather-groups">
            {series.groups.map((group) => (
              <section className="jx-industryWeather-group" key={group.key}>
                <div className="jx-industryWeather-groupHead">
                  <strong>{t(`marketState.weather.groupLabels.${dimension}.${group.key}`)}</strong>
                  <span>{group.codes.length}</span>
                </div>
                <div className="jx-industryWeather-cards">
                  {group.codes.flatMap((itemCode) => {
                    const item = itemByCode.get(itemCode);
                    return item
                      ? [
                          <MarketWeatherCard
                            key={itemCode}
                            item={item}
                            frequency={displayFrequency}
                            selected={selectedItemCode === itemCode}
                            onSelect={() => setSelectedItemCode(itemCode)}
                          />,
                        ]
                      : [];
                  })}
                </div>
              </section>
            ))}
          </div>

          <div className="jx-industryWeather-timeline">
            <div className="jx-industryWeather-playback">
              <Tooltip title={t('marketState.weather.previous')}>
                <Button
                  type="text"
                  aria-label={t('marketState.weather.previous')}
                  icon={<FontAwesomeIcon icon={faBackwardStep} />}
                  disabled={selectedPeriodIndex === 0}
                  onClick={() => setSelectedPeriodIndex((current) => Math.max(0, current - 1))}
                />
              </Tooltip>
              <Tooltip
                title={playing ? t('marketState.weather.pause') : t('marketState.weather.play')}
              >
                <Button
                  className="jx-industryWeather-playButton"
                  type="primary"
                  shape="circle"
                  aria-label={
                    playing ? t('marketState.weather.pause') : t('marketState.weather.play')
                  }
                  icon={<FontAwesomeIcon icon={playing ? faPause : faPlay} />}
                  onClick={() => setPlaying((current) => !current)}
                />
              </Tooltip>
              <Tooltip title={t('marketState.weather.next')}>
                <Button
                  type="text"
                  aria-label={t('marketState.weather.next')}
                  icon={<FontAwesomeIcon icon={faForwardStep} />}
                  disabled={selectedPeriodIndex === series.periods.length - 1}
                  onClick={() =>
                    setSelectedPeriodIndex((current) =>
                      Math.min(series.periods.length - 1, current + 1),
                    )
                  }
                />
              </Tooltip>
            </div>
            <div className="jx-industryWeather-sliderWrap">
              <Slider
                className="jx-industryWeather-slider"
                min={0}
                max={series.periods.length - 1}
                step={1}
                value={selectedPeriodIndex}
                onChange={setSelectedPeriodIndex}
                tooltip={{
                  formatter: (value) =>
                    value == null
                      ? ''
                      : formatPeriodLabel(series.periods[value].key, displayFrequency, t),
                }}
              />
              <div className="jx-industryWeather-range">
                <span>{formatPeriodLabel(series.periods[0].key, displayFrequency, t)}</span>
                <strong>{formatPeriodLabel(period.key, displayFrequency, t)}</strong>
                <span>{formatPeriodLabel(series.periods.at(-1)!.key, displayFrequency, t)}</span>
              </div>
            </div>
          </div>

          <div className="jx-industryWeather-legend">
            <span>{t('marketState.weather.legend.cold')}</span>
            <i className="jx-industryWeather-gradient" aria-hidden="true" />
            <span>{t('marketState.weather.legend.hot')}</span>
            <span className="jx-industryWeather-legendNote">
              {t('marketState.weather.legend.note')}
            </span>
          </div>
        </>
      ) : (
        <div className="jx-industryWeather-loading">
          <Skeleton active paragraph={{ rows: 12 }} />
        </div>
      )}

      <MarketWeatherDrawer
        series={series}
        periodIndex={selectedPeriodIndex}
        item={selectedItem}
        frequency={displayFrequency}
        onClose={() => setSelectedItemCode(null)}
      />
    </section>
  );
}

// Subcomponents and helpers.

function MarketWeatherCard({
  item,
  frequency,
  selected,
  onSelect,
}: {
  item: MarketWeatherItem;
  frequency: MarketWeatherFrequency;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('valuation');
  const heatBand = weatherHeatBand(item.heatScore);

  return (
    <button
      type="button"
      className={classNames(
        'jx-industryWeather-card',
        `jx-industryWeather-card--${heatBand}`,
        `jx-industryWeather-card--state-${item.state}`,
        {
          'jx-industryWeather-card--selected': selected,
          'jx-industryWeather-card--active': item.activityScore != null && item.activityScore >= 80,
        },
      )}
      onClick={onSelect}
    >
      <span className="jx-industryWeather-cardTop">
        <strong>{item.name}</strong>
        <span className="jx-industryWeather-state">
          {t(`marketState.weather.states.${item.state}`)}
        </span>
      </span>
      <span className="jx-industryWeather-performance">
        <span className="jx-industryWeather-performanceLabels">
          <span>{t(`marketState.weather.frequencies.${frequency}`)}</span>
          {item.relativeReturn == null ? null : (
            <b className={returnClassName(item.relativeReturn)}>
              {t('marketState.weather.metrics.relativeReturn')}{' '}
              {formatSignedPercent(item.relativeReturn)}
            </b>
          )}
        </span>
        <strong className={returnClassName(item.periodReturn)}>
          {formatSignedPercent(item.periodReturn)}
        </strong>
      </span>
      <span className="jx-industryWeather-cardMetrics">
        <span>
          {t('marketState.weather.metrics.heat')}
          <b>{formatScore(item.heatScore)}</b>
        </span>
        <span>
          {t('marketState.weather.metrics.activity')}
          <b>{formatScore(item.activityScore)}</b>
        </span>
        <span>
          {t('marketState.weather.metrics.breadth')}
          <b>{formatScore(item.breadthScore)}</b>
        </span>
      </span>
      <span className="jx-industryWeather-cardBottom">
        <Tooltip
          title={
            item.valuationSource == null
              ? undefined
              : t(`marketState.weather.valuation.${item.valuationSource}`)
          }
        >
          <span className={valuationClassName(item.valuationPercentile)}>
            {valuationLabel(item.valuationPercentile, t)}
          </span>
        </Tooltip>
        <span className={returnClassName(item.heatChange)}>
          {item.heatChange == null ? null : (
            <FontAwesomeIcon icon={item.heatChange >= 0 ? faArrowTrendUp : faArrowTrendDown} />
          )}
          {formatHeatChange(item.heatChange)}
        </span>
      </span>
    </button>
  );
}

function MarketWeatherDrawer({
  series,
  periodIndex,
  item,
  frequency,
  onClose,
}: {
  series: MarketWeatherSeries | null;
  periodIndex: number;
  item: MarketWeatherItem | null;
  frequency: MarketWeatherFrequency;
  onClose: () => void;
}) {
  const { t } = useTranslation('valuation');
  const history = series
    ? series.periods.slice(Math.max(0, periodIndex - 23), periodIndex + 1).flatMap((period) => {
        const historyItem = period.items.find((candidate) => candidate.code === item?.code);
        return historyItem ? [{ period, item: historyItem }] : [];
      })
    : [];

  return (
    <Drawer open={item != null} title={item?.name} width={440} onClose={onClose}>
      {item ? (
        <div className="jx-industryWeather-drawer">
          <div className="jx-industryWeather-drawerState">
            <span>{t(`marketState.weather.states.${item.state}`)}</span>
            <strong className={returnClassName(item.periodReturn)}>
              {formatSignedPercent(item.periodReturn)}
            </strong>
          </div>
          {item.relativeReturn == null ? null : (
            <div className="jx-industryWeather-drawerRelative">
              <span>{t('marketState.weather.relativeTo', { name: item.benchmarkName })}</span>
              <strong className={returnClassName(item.relativeReturn)}>
                {formatSignedPercent(item.relativeReturn)}
              </strong>
            </div>
          )}
          <div className="jx-industryWeather-drawerMetrics">
            <WeatherMetric
              label={t('marketState.weather.metrics.heat')}
              value={item.heatScore}
              format="score"
            />
            <WeatherMetric
              label={t('marketState.weather.metrics.activity')}
              value={item.activityScore}
              format="percentile"
            />
            <WeatherMetric
              label={t('marketState.weather.metrics.breadth')}
              value={item.breadthScore}
              format="percent"
            />
            <WeatherMetric
              label={valuationMetricLabel(item.valuationSource, t)}
              value={item.valuationPercentile}
              format="percentile"
            />
          </div>
          <h3>{t('marketState.weather.historyTitle', { count: history.length })}</h3>
          <div className="jx-industryWeather-historyStrip">
            {history.map(({ period, item }) => (
              <Tooltip
                key={period.key}
                title={`${formatPeriodLabel(period.key, frequency, t)} · ${formatSignedPercent(item.periodReturn)}`}
              >
                <span
                  className={`jx-industryWeather-historyCell jx-industryWeather-historyCell--${weatherHeatBand(item.heatScore)}`}
                />
              </Tooltip>
            ))}
          </div>
          <div className="jx-industryWeather-historyList">
            {history
              .slice(-8)
              .reverse()
              .map(({ period, item }) => (
                <div key={period.key}>
                  <span>{formatPeriodLabel(period.key, frequency, t)}</span>
                  <span>{t(`marketState.weather.states.${item.state}`)}</span>
                  <strong className={returnClassName(item.periodReturn)}>
                    {formatSignedPercent(item.periodReturn)}
                  </strong>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function WeatherMetric({
  label,
  value,
  format,
}: {
  label: string;
  value: number | null;
  format: 'score' | 'percent' | 'percentile';
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{formatWeatherMetric(value, format)}</strong>
    </div>
  );
}

function formatWeatherMetric(
  value: number | null,
  format: 'score' | 'percent' | 'percentile',
): string {
  if (value == null) {
    return '—';
  }
  switch (format) {
    case 'percentile':
      return `P${Math.round(value)}`;
    case 'percent':
      return `${Math.round(value)}%`;
    case 'score':
      return String(Math.round(value));
  }
}

function weatherHeatBand(score: number): WeatherHeatBand {
  if (score >= 85) {
    return 'extreme';
  }
  if (score >= 68) {
    return 'hot';
  }
  if (score >= 50) {
    return 'warm';
  }
  if (score >= 30) {
    return 'mild';
  }
  return 'cold';
}

function returnClassName(value: number | null): string {
  return classNames('jx-industryWeather-change', {
    'jx-industryWeather-change--up': value != null && value > 0,
    'jx-industryWeather-change--down': value != null && value < 0,
  });
}

function valuationClassName(value: number | null): string {
  return classNames('jx-industryWeather-valuation', {
    'jx-industryWeather-valuation--low': value != null && value <= 30,
    'jx-industryWeather-valuation--high': value != null && value >= 70,
  });
}

function valuationLabel(
  value: number | null,
  t: ReturnType<typeof useTranslation<'valuation'>>['t'],
): string {
  if (value == null) {
    return t('marketState.weather.valuation.unknown');
  }
  const state = value <= 30 ? 'low' : value >= 70 ? 'high' : 'neutral';
  return t(`marketState.weather.valuation.${state}`, { value: Math.round(value) });
}

function valuationMetricLabel(
  source: MarketWeatherItem['valuationSource'],
  t: ReturnType<typeof useTranslation<'valuation'>>['t'],
): string {
  const metric = t('marketState.weather.metrics.valuation');
  return source == null ? metric : `${metric} · ${t(`marketState.weather.valuation.${source}`)}`;
}

function formatHeatChange(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
}

function formatScore(value: number | null): string {
  return value == null ? '—' : String(Math.round(value));
}

function formatSignedPercent(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatPeriodLabel(
  key: string,
  frequency: MarketWeatherFrequency,
  t: ReturnType<typeof useTranslation<'valuation'>>['t'],
): string {
  switch (frequency) {
    case 'week': {
      const [year, week] = key.split('-W');
      return t('marketState.weather.periodLabels.week', { year, value: Number(week) });
    }
    case 'month': {
      const [year, month] = key.split('-');
      return t('marketState.weather.periodLabels.month', { year, value: Number(month) });
    }
    case 'quarter': {
      const [year, quarter] = key.split('-Q');
      return t('marketState.weather.periodLabels.quarter', {
        year,
        value: Number(quarter),
      });
    }
    case 'year':
      return t('marketState.weather.periodLabels.year', { year: key });
  }
}

type WeatherHeatBand = 'cold' | 'mild' | 'warm' | 'hot' | 'extreme';

const WEATHER_FREQUENCIES: MarketWeatherFrequency[] = ['week', 'month', 'quarter', 'year'];
const WEATHER_DIMENSIONS: MarketWeatherDimension[] = ['industry', 'scale', 'board', 'style'];
const ATTENTION_STATES = new Set<MarketWeatherState>(['undervalued', 'warming', 'expanding']);
const WARNING_STATES = new Set<MarketWeatherState>(['overheated', 'crowded']);

export default MarketWeatherMap;
