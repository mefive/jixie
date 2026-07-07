import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartSpec, SqlRows } from '@jixie/shared';
import { faChartLine } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { agentSql } from '@src/api/client';
import { EChart, type ECOption } from './echart';
import './chat-chart.css';

interface ChatChartProps {
  title: string;
  chart: ChartSpec;
}

/**
 * A chart card inside an agent conversation. Like QueryCard it persists the QUERY (read-only SQL +
 * column mapping) and re-runs it on render, so a reopened conversation never shows stale points.
 * Every state (skeleton / error / chart) fills the same fixed-height body — the conversation column
 * must not reflow when data lands. Lazy-loaded (echarts chunk); default export for React.lazy.
 */
export default function ChatChart({ title, chart }: ChatChartProps) {
  const { t } = useTranslation('components');
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    rows: SqlRows['rows'];
  }>({ loading: true, error: null, rows: [] });

  useEffect(() => {
    let alive = true;
    agentSql(chart.sql)
      .then(({ rows }) => alive && setState({ loading: false, error: null, rows }))
      .catch(
        (e) =>
          alive &&
          setState({
            loading: false,
            error: e instanceof Error ? e.message : t('queryFailed'),
            rows: [],
          }),
      );
    return () => {
      alive = false;
    };
    // The spec of a given chart part never changes (message parts are immutable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="jx-chatChart">
      <div className="jx-chatChart-head">
        <FontAwesomeIcon icon={faChartLine} />
        <span className="jx-chatChart-title">{title}</span>
        {state.rows.length > 0 && (
          <span className="jx-chatChart-meta">{t('points', { count: state.rows.length })}</span>
        )}
      </div>
      {state.loading && <div className="jx-chatChart-skeleton" />}
      {state.error && (
        <div className="jx-chatChart-status">
          {t('chartQueryFailed')}
          {state.error}
        </div>
      )}
      {!state.loading && !state.error && (
        <EChart option={buildOption(chart, state.rows)} className="jx-chatChart-body" />
      )}
    </div>
  );
}

// —— 帮助函数 ——

// Canvas can't read CSS variables — chart colors live as hex (ink first, then 涨红/跌绿 accents).
const SERIES_PALETTE = ['#1f2430', '#e8463b', '#2f9e5b', '#b38f2d', '#8a9099'];
const AXIS_LABEL_COLOR = '#8a9099';
const AXIS_LINE_COLOR = '#e8eaed';
const SPLIT_LINE_COLOR = '#f0f1f3';

/** '20240105' → '2024-01-05' for axis readability; anything else passes through. */
function formatXValue(value: string | number | null): string {
  const text = String(value ?? '');
  return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text;
}

function toNumber(value: string | number | null): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildOption(chart: ChartSpec, rows: SqlRows['rows']): ECOption {
  const multiSeries = chart.series.length > 1;

  // Scatter reads both axes as values (x-y relation); line/bar read x as ordered categories.
  const scatter = chart.kind === 'scatter';
  return {
    grid: { left: 56, right: 16, top: multiSeries ? 36 : 16, bottom: 28 },
    tooltip: { trigger: scatter ? 'item' : 'axis' },
    legend: multiSeries
      ? { top: 4, textStyle: { color: AXIS_LABEL_COLOR, fontSize: 11 } }
      : undefined,
    xAxis: {
      type: scatter ? 'value' : 'category',
      ...(scatter ? { scale: true } : { data: rows.map((row) => formatXValue(row[chart.x])) }),
      axisLabel: { color: AXIS_LABEL_COLOR },
      axisLine: { lineStyle: { color: AXIS_LINE_COLOR } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: AXIS_LABEL_COLOR },
      splitLine: { lineStyle: { color: SPLIT_LINE_COLOR } },
    },
    series: chart.series.map((series, index) => ({
      name: series.label ?? series.column,
      type: chart.kind,
      data: scatter
        ? rows.map((row) => [toNumber(row[chart.x]), toNumber(row[series.column])])
        : rows.map((row) => toNumber(row[series.column])),
      ...(chart.kind === 'line' ? { showSymbol: false, lineStyle: { width: 1.5 } } : {}),
      ...(chart.kind === 'scatter' ? { symbolSize: 6 } : {}),
      itemStyle: { color: SERIES_PALETTE[index % SERIES_PALETTE.length] },
    })),
  } as ECOption;
}
