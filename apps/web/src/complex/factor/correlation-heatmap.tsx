import type { FactorCorrelation } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  data: FactorCorrelation;
}

// Lazy-loaded (echarts in its own chunk). Factor × factor mean cross-sectional Spearman, red = positive
// (redundant factors), blue = negative. The trailing 'size' column shows every factor's entanglement
// with market cap (the "is this new factor just a small-cap bet?" check).
export default function CorrelationHeatmap({ data }: Props) {
  const n = data.labels.length;
  // echarts heatmap wants [x, y, value]; put the first factor at the top-left (y reversed).
  const cells: [number, number, number | string][] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const v = data.matrix[row][col];
      cells.push([col, n - 1 - row, v == null ? '-' : Number(v.toFixed(2))]);
    }
  }
  const axisLabels = data.labels;
  const option: ECOption = {
    grid: { left: 120, right: 24, top: 96, bottom: 24 },
    tooltip: {
      position: 'top',
      formatter: (p: any) => {
        const col = p.data[0];
        const row = n - 1 - p.data[1];
        return `${axisLabels[row]} × ${axisLabels[col]}<br/>ρ = ${p.data[2]}`;
      },
    },
    xAxis: {
      type: 'category',
      data: axisLabels,
      position: 'top',
      axisLabel: { color: '#8a9099', fontSize: 11, interval: 0, rotate: 30 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: [...axisLabels].reverse(),
      axisLabel: { color: '#8a9099', fontSize: 11, interval: 0 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: true },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 80,
      inRange: { color: ['#2c5fa8', '#eef1f5', '#c0392b'] }, // blue (neg) → white → red (pos)
      textStyle: { color: '#8a9099', fontSize: 11 },
    },
    series: [
      {
        type: 'heatmap',
        data: cells,
        label: {
          show: true,
          fontSize: 11,
          color: '#1f2430',
          formatter: (p: any) => (p.data[2] === '-' ? '' : p.data[2]),
        },
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
      },
    ],
  };
  return <EChart option={option} className="jx-factor-corrChart" />;
}
