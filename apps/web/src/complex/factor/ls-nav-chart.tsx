import { useTranslation } from 'react-i18next';
import type { LongShortNav } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  nav: LongShortNav; // equal-weight long-short NAV, gross vs net-of-cost
}

// Lazy-loaded (echarts in its own chunk). The long-short leg's cumulative NAV, before vs after trading
// cost — the tradability gate: a high-turnover factor's gross curve can look great while its net curve
// (after ~30bps round-trip per name churned each rebalance) flattens or reverses.
export default function LsNavChart({ nav }: Props) {
  const { t } = useTranslation('factor');
  const labels = nav.dates.map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}`);
  const option: ECOption = {
    grid: { left: 44, right: 16, top: 28, bottom: 28 },
    legend: {
      data: [t('lsNavGross'), t('lsNavNet')],
      top: 0,
      right: 0,
      itemWidth: 18,
      itemHeight: 8,
      textStyle: { color: '#8a9099', fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => (typeof v === 'number' ? v.toFixed(3) : String(v)),
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#8a9099', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e8eaed' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { formatter: (v: number) => v.toFixed(2), color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        name: t('lsNavGross'),
        type: 'line',
        data: nav.gross,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#1f2430', width: 2 },
        itemStyle: { color: '#1f2430' },
      },
      {
        name: t('lsNavNet'),
        type: 'line',
        data: nav.net,
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#c0392b', width: 2, type: 'dashed' },
        itemStyle: { color: '#c0392b' },
      },
      {
        // NAV = 1 reference line (break-even).
        type: 'line',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#c9ccd1', type: 'dashed' },
          data: [{ yAxis: 1 }],
        },
      },
    ],
  };
  return <EChart option={option} className="jx-factor-chart" />;
}
