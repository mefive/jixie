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
  IndustryWeatherItem,
  IndustryWeatherSeries,
  IndustryWeatherState,
  MarketWeatherFrequency,
} from '@jixie/shared';
import './industry-weather-map.css';

interface Props {
  series: IndustryWeatherSeries | null;
  loading: boolean;
  frequency: MarketWeatherFrequency;
  onFrequencyChange: (frequency: MarketWeatherFrequency) => void;
}

export function IndustryWeatherMap({ series, loading, frequency, onFrequencyChange }: Props) {
  const { t } = useTranslation('valuation');
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selectedIndustryCode, setSelectedIndustryCode] = useState<string | null>(null);
  const displayFrequency = series?.frequency ?? frequency;

  useEffect(() => {
    setSelectedPeriodIndex(Math.max(0, (series?.periods.length ?? 1) - 1));
    setPlaying(false);
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
  const industryByCode = useMemo(
    () => new Map(period?.industries.map((industry) => [industry.l1Code, industry]) ?? []),
    [period],
  );
  const selectedIndustry = selectedIndustryCode
    ? (industryByCode.get(selectedIndustryCode) ?? null)
    : null;
  const attentionNames = period
    ? period.industries
        .filter((industry) => ATTENTION_STATES.has(industry.state))
        .slice(0, 3)
        .map((industry) => industry.l1Name)
        .join('、')
    : '—';
  const warningNames = period
    ? period.industries
        .filter((industry) => WARNING_STATES.has(industry.state))
        .slice(0, 2)
        .map((industry) => industry.l1Name)
        .join('、')
    : '—';

  return (
    <section className="jx-industryWeather">
      <div className="jx-industryWeather-head">
        <div>
          <div className="jx-industryWeather-eyebrow">{t('marketState.weather.eyebrow')}</div>
          <h2 className="jx-industryWeather-title">{t('marketState.weather.title')}</h2>
          <p className="jx-industryWeather-subtitle">{t('marketState.weather.subtitle')}</p>
        </div>
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
            {INDUSTRY_GROUPS.map((group) => (
              <section className="jx-industryWeather-group" key={group.key}>
                <div className="jx-industryWeather-groupHead">
                  <strong>{t(`marketState.weather.groups.${group.key}`)}</strong>
                  <span>{group.codes.length}</span>
                </div>
                <div className="jx-industryWeather-cards">
                  {group.codes.flatMap((industryCode) => {
                    const industry = industryByCode.get(industryCode);
                    return industry
                      ? [
                          <IndustryWeatherCard
                            key={industryCode}
                            industry={industry}
                            frequency={displayFrequency}
                            selected={selectedIndustryCode === industryCode}
                            onSelect={() => setSelectedIndustryCode(industryCode)}
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

      <IndustryWeatherDrawer
        series={series}
        periodIndex={selectedPeriodIndex}
        industry={selectedIndustry}
        frequency={displayFrequency}
        onClose={() => setSelectedIndustryCode(null)}
      />
    </section>
  );
}

// —— Subcomponents / helpers ——

function IndustryWeatherCard({
  industry,
  frequency,
  selected,
  onSelect,
}: {
  industry: IndustryWeatherItem;
  frequency: MarketWeatherFrequency;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('valuation');
  const heatBand = weatherHeatBand(industry.heatScore);

  return (
    <button
      type="button"
      className={classNames(
        'jx-industryWeather-card',
        `jx-industryWeather-card--${heatBand}`,
        `jx-industryWeather-card--state-${industry.state}`,
        {
          'jx-industryWeather-card--selected': selected,
          'jx-industryWeather-card--active': industry.activityScore >= 80,
        },
      )}
      onClick={onSelect}
    >
      <span className="jx-industryWeather-cardTop">
        <strong>{industry.l1Name}</strong>
        <span className="jx-industryWeather-state">
          {t(`marketState.weather.states.${industry.state}`)}
        </span>
      </span>
      <span className="jx-industryWeather-performance">
        <span>{t(`marketState.weather.frequencies.${frequency}`)}</span>
        <strong className={returnClassName(industry.periodReturn)}>
          {formatSignedPercent(industry.periodReturn)}
        </strong>
      </span>
      <span className="jx-industryWeather-cardMetrics">
        <span>
          {t('marketState.weather.metrics.heat')}
          <b>{Math.round(industry.heatScore)}</b>
        </span>
        <span>
          {t('marketState.weather.metrics.activity')}
          <b>{Math.round(industry.activityScore)}</b>
        </span>
        <span>
          {t('marketState.weather.metrics.breadth')}
          <b>{Math.round(industry.breadthScore)}</b>
        </span>
      </span>
      <span className="jx-industryWeather-cardBottom">
        <span className={valuationClassName(industry.valuationPercentile)}>
          {valuationLabel(industry.valuationPercentile, t)}
        </span>
        <span className={returnClassName(industry.heatChange)}>
          {industry.heatChange == null ? null : (
            <FontAwesomeIcon icon={industry.heatChange >= 0 ? faArrowTrendUp : faArrowTrendDown} />
          )}
          {formatHeatChange(industry.heatChange)}
        </span>
      </span>
    </button>
  );
}

function IndustryWeatherDrawer({
  series,
  periodIndex,
  industry,
  frequency,
  onClose,
}: {
  series: IndustryWeatherSeries | null;
  periodIndex: number;
  industry: IndustryWeatherItem | null;
  frequency: MarketWeatherFrequency;
  onClose: () => void;
}) {
  const { t } = useTranslation('valuation');
  const history = series
    ? series.periods.slice(Math.max(0, periodIndex - 23), periodIndex + 1).flatMap((period) => {
        const item = period.industries.find((candidate) => candidate.l1Code === industry?.l1Code);
        return item ? [{ period, item }] : [];
      })
    : [];

  return (
    <Drawer open={industry != null} title={industry?.l1Name} width={440} onClose={onClose}>
      {industry ? (
        <div className="jx-industryWeather-drawer">
          <div className="jx-industryWeather-drawerState">
            <span>{t(`marketState.weather.states.${industry.state}`)}</span>
            <strong className={returnClassName(industry.periodReturn)}>
              {formatSignedPercent(industry.periodReturn)}
            </strong>
          </div>
          <div className="jx-industryWeather-drawerMetrics">
            <WeatherMetric
              label={t('marketState.weather.metrics.heat')}
              value={industry.heatScore}
              format="score"
            />
            <WeatherMetric
              label={t('marketState.weather.metrics.activity')}
              value={industry.activityScore}
              format="percentile"
            />
            <WeatherMetric
              label={t('marketState.weather.metrics.breadth')}
              value={industry.breadthScore}
              format="percent"
            />
            <WeatherMetric
              label={t('marketState.weather.metrics.valuation')}
              value={industry.valuationPercentile}
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

function formatHeatChange(value: number | null): string {
  if (value == null) {
    return '—';
  }
  return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
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
const ATTENTION_STATES = new Set<IndustryWeatherState>(['undervalued', 'warming', 'expanding']);
const WARNING_STATES = new Set<IndustryWeatherState>(['overheated', 'crowded']);
const INDUSTRY_GROUPS = [
  {
    key: 'financial',
    codes: ['801780.SI', '801790.SI', '801180.SI'],
  },
  {
    key: 'technology',
    codes: ['801080.SI', '801750.SI', '801770.SI', '801760.SI', '801740.SI'],
  },
  {
    key: 'resources',
    codes: [
      '801030.SI',
      '801040.SI',
      '801050.SI',
      '801710.SI',
      '801720.SI',
      '801950.SI',
      '801960.SI',
    ],
  },
  {
    key: 'manufacturing',
    codes: ['801730.SI', '801880.SI', '801890.SI', '801140.SI', '801970.SI'],
  },
  {
    key: 'consumer',
    codes: [
      '801010.SI',
      '801110.SI',
      '801120.SI',
      '801130.SI',
      '801200.SI',
      '801210.SI',
      '801980.SI',
    ],
  },
  {
    key: 'defensive',
    codes: ['801150.SI', '801160.SI', '801170.SI', '801230.SI'],
  },
] as const;

export default IndustryWeatherMap;
