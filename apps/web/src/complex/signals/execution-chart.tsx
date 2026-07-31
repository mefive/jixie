import type { StrategyExecutionOverview } from '@jixie/shared';
import { useTranslation } from 'react-i18next';
import { EChart, type ECOption } from '@src/components/echart';

export default function ExecutionChart({ overview }: { overview: StrategyExecutionOverview }) {
  const { t } = useTranslation('signals');
  const option: ECOption = {
    animation: false,
    color: ['#111827', '#2563eb', '#d97706'],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) =>
        typeof value === 'number'
          ? `¥${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : String(value),
    },
    legend: {
      top: 0,
      data: [t('account.model'), t('account.simulation'), t('account.actual')],
    },
    grid: { left: 64, right: 20, top: 42, bottom: 32 },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#667085' },
      axisLine: { lineStyle: { color: '#d0d5dd' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: '#667085',
        formatter: (value: number) =>
          new Intl.NumberFormat(undefined, {
            notation: 'compact',
            maximumFractionDigits: 1,
          }).format(value),
      },
      splitLine: { lineStyle: { color: '#f2f4f7' } },
    },
    series: [
      {
        name: t('account.model'),
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: overview.model.length < 20,
        data: overview.model.map((point) => [dateValue(point.date), point.equity]),
      },
      {
        name: t('account.simulation'),
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: overview.simulation.length < 20,
        data: overview.simulation.map((point) => [dateValue(point.date), point.equity]),
      },
      {
        name: t('account.actual'),
        type: 'line',
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: overview.actual.length < 20,
        data: overview.actual.map((point) => [dateValue(point.date), point.equity]),
      },
    ],
  };

  return <EChart option={option} className="jx-signals-executionChart" />;
}

function dateValue(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}
