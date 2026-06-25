import type { StockSeries } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  series: StockSeries;
}

const UP = '#e8463b'; // A-share red up
const DOWN = '#2f9e5b'; // green down

// Lazy-loaded so echarts (incl. candlestick) lands in its own chunk.
export default function StockChart({ series }: Props) {
  const p = series.points;
  const dates = p.map((d) => d.date);
  // Candlestick item = [open, close, low, high]; missing day → NaN tuple (rendered as a gap).
  const candle: number[][] = p.map((d) =>
    d.open == null || d.close == null || d.low == null || d.high == null
      ? [NaN, NaN, NaN, NaN]
      : [d.open, d.close, d.low, d.high],
  );
  const isUp = (d: (typeof p)[number]) => (d.close ?? 0) >= (d.open ?? 0);
  const vols = p.map((d) => ({ value: d.vol ?? NaN, itemStyle: { color: isUp(d) ? UP : DOWN } }));
  const pes: (number | null)[] = p.map((d) => d.pe ?? null);

  const option: ECOption = {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 52, right: 16, top: 12, height: '52%' },
      { left: 52, right: 16, top: '68%', height: '12%' },
      { left: 52, right: 16, top: '84%', height: '12%' },
    ],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#e8eaed' } } },
      { type: 'category', gridIndex: 1, data: dates, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#e8eaed' } } },
      { type: 'category', gridIndex: 2, data: dates, axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' }, axisLine: { lineStyle: { color: '#e8eaed' } } },
    ],
    yAxis: [
      { scale: true, name: '价', nameTextStyle: { color: '#8a9099' }, axisLabel: { color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
      { gridIndex: 1, name: '量', nameTextStyle: { color: '#8a9099' }, axisLabel: { show: false }, splitLine: { show: false } },
      { gridIndex: 2, name: 'PE', nameTextStyle: { color: '#8a9099' }, scale: true, axisLabel: { color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], start: 60, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2], bottom: 0, height: 16, start: 60, end: 100 },
    ],
    series: [
      {
        type: 'candlestick',
        data: candle,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
      },
      { type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols },
      { type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: pes, showSymbol: false, lineStyle: { color: '#307df9', width: 1.2 } },
    ],
  };

  return <EChart option={option} className="jx-screen-chart" />;
}
