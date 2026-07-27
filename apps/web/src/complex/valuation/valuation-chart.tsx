import { useTranslation } from 'react-i18next';
import type { IndexValuationMetric, IndexValuationPoint } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  indexName: string;
  metric: IndexValuationMetric;
  points: IndexValuationPoint[];
}

const METRIC_COLOR = '#111827';
const CLOSE_COLOR = '#a5abb3';

export default function ValuationChart({ indexName, metric, points }: Props) {
  const { t } = useTranslation('valuation');
  const dates = points.map((point) => point.date);
  const metricValues = points.map((point) => point[metric]);
  const closeValues = points.map((point) => point.close);
  const lastMetricPoint = findLastMetricPoint(points, metric);
  const metricName = t(`metrics.${metric}` as const);
  const closeName = t('indexClose');
  const option: ECOption = {
    animation: false,
    grid: { left: 62, right: 66, top: 50, bottom: 68 },
    legend: {
      data: [metricName, closeName],
      top: 0,
      right: 8,
      textStyle: { color: '#8a9099' },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLabel: {
        formatter: (date: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}`,
        color: '#8a9099',
      },
      axisLine: { lineStyle: { color: '#e8eaed' } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        name: metricName,
        nameTextStyle: { color: METRIC_COLOR },
        axisLabel: { color: '#6f7580' },
        splitLine: { lineStyle: { color: '#eff0f2' } },
      },
      {
        type: 'value',
        scale: true,
        name: t('closeAxis', { index: indexName }),
        nameTextStyle: { color: CLOSE_COLOR },
        axisLabel: { color: CLOSE_COLOR },
        axisLine: { show: true, lineStyle: { color: CLOSE_COLOR } },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        start: 0,
        end: 100,
        bottom: 14,
        height: 26,
        showDetail: false,
        borderColor: '#e8eaed',
        fillerColor: 'rgba(17, 24, 39, 0.08)',
      },
    ],
    series: [
      {
        name: metricName,
        type: 'line',
        data: metricValues,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: METRIC_COLOR, width: 1.8 },
        itemStyle: { color: METRIC_COLOR },
        markPoint: lastMetricPoint
          ? {
              symbol: 'circle',
              symbolSize: 9,
              label: { show: false },
              data: [
                {
                  name: metricName,
                  coord: [lastMetricPoint.date, lastMetricPoint.value],
                },
              ],
            }
          : undefined,
        tooltip: { valueFormatter: (value: unknown) => formatMetric(value, metric) },
      },
      {
        name: closeName,
        type: 'line',
        yAxisIndex: 1,
        data: closeValues,
        showSymbol: false,
        lineStyle: { color: CLOSE_COLOR, width: 1.2, opacity: 0.8 },
        itemStyle: { color: CLOSE_COLOR },
        tooltip: { valueFormatter: formatNumber },
      },
    ],
  };

  return <EChart option={option} className="jx-valuation-chart" />;
}

function findLastMetricPoint(points: IndexValuationPoint[], metric: IndexValuationMetric) {
  for (let index = points.length - 1; index >= 0; index--) {
    const value = points[index][metric];
    if (value != null) {
      return { date: points[index].date, value };
    }
  }

  return null;
}

function formatMetric(value: unknown, metric: IndexValuationMetric): string {
  if (typeof value !== 'number') {
    return String(value);
  }
  return metric === 'turnoverRate' ? `${value.toFixed(2)}%` : value.toFixed(2);
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}
