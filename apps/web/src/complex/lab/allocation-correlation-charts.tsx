import type { AllocationCorrelationPairSeries, AllocationCorrelationWindow } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  data: AllocationCorrelationWindow;
  pair: AllocationCorrelationPairSeries;
  labels: Record<string, string>;
}

export default function AllocationCorrelationCharts({ data, pair, labels }: Props) {
  const count = data.assetClasses.length;
  const classLabels = data.assetClasses.map((assetClass) => labels[assetClass] ?? assetClass);
  const heatmapCells: Array<[number, number, number | string]> = [];
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      const value = data.latest[row][column];
      heatmapCells.push([column, count - 1 - row, value == null ? '-' : Number(value.toFixed(2))]);
    }
  }
  const heatmap: ECOption = {
    grid: { left: 88, right: 18, top: 82, bottom: 42 },
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const column = params.data[0];
        const row = count - 1 - params.data[1];
        const observations = data.latestObservations[row][column];
        return `${classLabels[row]} × ${classLabels[column]}<br/>ρ = ${params.data[2]}<br/>n = ${observations}`;
      },
    },
    xAxis: {
      type: 'category',
      data: classLabels,
      position: 'top',
      axisLabel: { color: '#8a9099', fontSize: 11, interval: 0, rotate: 25 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: true },
    },
    yAxis: {
      type: 'category',
      data: [...classLabels].reverse(),
      axisLabel: { color: '#8a9099', fontSize: 11, interval: 0 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: true },
    },
    visualMap: {
      min: -1,
      max: 1,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 14,
      itemHeight: 110,
      inRange: { color: ['#2c5fa8', '#eef1f5', '#c0392b'] },
      textStyle: { color: '#8a9099', fontSize: 11 },
    },
    series: [
      {
        type: 'heatmap',
        data: heatmapCells,
        label: {
          show: true,
          fontSize: 11,
          color: '#1f2430',
          formatter: (params: any) => (params.data[2] === '-' ? '' : params.data[2]),
        },
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
      },
    ],
  };
  const pairLabel = `${labels[pair.left] ?? pair.left} × ${labels[pair.right] ?? pair.right}`;
  const rolling: ECOption = {
    grid: { left: 48, right: 20, top: 42, bottom: 38 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const point = Array.isArray(params) ? params[0] : params;
        const source = pair.points[point.dataIndex];
        return `${formatDate(source.date)}<br/>${pairLabel}: ${source.value == null ? '—' : source.value.toFixed(3)}<br/>n = ${source.observations}`;
      },
    },
    xAxis: {
      type: 'category',
      data: pair.points.map((point) => formatDate(point.date)),
      boundaryGap: false,
      axisLabel: { color: '#8a9099', fontSize: 10 },
      axisLine: { lineStyle: { color: '#d8dce2' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      interval: 0.5,
      axisLabel: { color: '#8a9099', fontSize: 10 },
      splitLine: { lineStyle: { color: '#eef0f2' } },
    },
    series: [
      {
        name: pairLabel,
        type: 'line',
        data: pair.points.map((point) => point.value),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: '#34495e', width: 2 },
        itemStyle: { color: '#34495e' },
      },
    ],
  };

  return (
    <div className="jx-lab-correlationCharts">
      <EChart option={heatmap} className="jx-lab-correlationHeatmap" />
      <EChart option={rolling} className="jx-lab-correlationRolling" />
    </div>
  );
}

function formatDate(date: string): string {
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}
