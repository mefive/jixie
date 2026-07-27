import { useTranslation } from 'react-i18next';
import type { MarketStateMetric, MarketStatePoint } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  metric: MarketStateMetric;
  points: MarketStatePoint[];
}

const METRIC_COLORS: Record<MarketStateMetric, string> = {
  activity: '#d97706',
  breadth: '#2563eb',
  trend: '#dc2626',
  crowding: '#7c3aed',
};

export default function MarketStateChart({ metric, points }: Props) {
  const { t } = useTranslation('valuation');
  const name = t(`marketState.metrics.${metric}.label` as const);
  const color = METRIC_COLORS[metric];
  const option: ECOption = {
    animation: false,
    grid: { left: 58, right: 24, top: 28, bottom: 64 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: (value: unknown) =>
        typeof value === 'number' ? `${value.toFixed(2)}%` : String(value),
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.date),
      boundaryGap: false,
      axisLabel: {
        formatter: (date: string) => `${date.slice(0, 4)}-${date.slice(4, 6)}`,
        color: '#8a9099',
      },
      axisLine: { lineStyle: { color: '#e8eaed' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      name: t('marketState.history.percentAxis'),
      nameTextStyle: { color: '#8a9099' },
      axisLabel: { color: '#6f7580', formatter: '{value}%' },
      splitLine: { lineStyle: { color: '#eff0f2' } },
    },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      {
        type: 'slider',
        start: 0,
        end: 100,
        bottom: 12,
        height: 24,
        showDetail: false,
        borderColor: '#e8eaed',
        fillerColor: 'rgba(17, 24, 39, 0.08)',
      },
    ],
    series: [
      {
        name,
        type: 'line',
        data: points.map((point) => displayPercent(point[metric], metric)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color, width: 1.8 },
        itemStyle: { color },
        areaStyle: { color, opacity: 0.06 },
      },
    ],
  };

  return <EChart option={option} className="jx-marketState-chart" />;
}

function displayPercent(value: number | null, metric: MarketStateMetric): number | null {
  if (value == null) {
    return null;
  }
  return metric === 'activity' ? value : value * 100;
}
