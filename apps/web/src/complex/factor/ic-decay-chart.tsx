import type { IcDecayPoint } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  points: IcDecayPoint[]; // Rank IC at forward horizons (1/5/10/20/60 trading days)
}

// Lazy-loaded (echarts in its own chunk). The IC-decay curve: how the factor's Rank IC changes with the
// forward horizon → its natural holding period (peak = best hold; fast decay = short-term factor).
export default function IcDecayChart({ points }: Props) {
  const option: ECOption = {
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const d = points[p.dataIndex];
        return `${d.horizonDays} 日前瞻<br/>Rank IC ${d.icMean.toFixed(4)}<br/>ICIR ${d.icir.toFixed(2)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((p) => `${p.horizonDays}日`),
      axisLabel: { color: '#8a9099', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e8eaed' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => v.toFixed(2), color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'line',
        data: points.map((p) => p.icMean),
        smooth: true,
        showSymbol: true,
        symbolSize: 7,
        lineStyle: { color: '#1f2430', width: 2 },
        itemStyle: { color: '#1f2430' },
        areaStyle: { color: '#1f2430', opacity: 0.05 },
        // Zero reference — above = 追(正向), below = 反着做(反向).
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: '#c9ccd1', type: 'dashed' },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
  return <EChart option={option} className="jx-factor-chart" />;
}
