import { useTranslation } from 'react-i18next';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  nav: { date: string; value: number }[];
  up: boolean; // total return ≥ 0 → red (A-share up color), else green
}

// Lazy-loaded so echarts lands in its own chunk (see apps/web/CLAUDE.md §3).
export default function NavChart({ nav, up }: Props) {
  const { t } = useTranslation('lab');
  const color = up ? '#e8463b' : '#2f9e5b'; // canvas can't read CSS vars → hex
  const option: ECOption = {
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const d = String(p.axisValue);
        const v = Math.round(p.data).toLocaleString();
        return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}<br/>${t('navEquity')} ${v}`;
      },
    },
    xAxis: {
      type: 'category',
      data: nav.map((n) => n.date),
      axisLabel: { formatter: (d: string) => d.slice(0, 4), color: '#8a9099' },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        formatter: (v: number) => (v / 10000).toFixed(0) + t('unitWan'),
        color: '#8a9099',
      },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'line',
        data: nav.map((n) => n.value),
        showSymbol: false,
        lineStyle: { color, width: 1.5 },
        areaStyle: { color, opacity: 0.06 },
      },
    ],
  };
  return <EChart option={option} className="jx-lab-chart" />;
}
