import type { StockSeries } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

export type Adjust = 'none' | 'qfq' | 'hfq';

interface Props {
  series: StockSeries;
  logY?: boolean; // log price axis
  adjust?: Adjust; // 不复权 / 前复权 / 后复权
  className?: string;
}

const UP = '#e8463b'; // A-share red up
const DOWN = '#2f9e5b'; // green down
const PE_COLOR = '#307df9';

/**
 * Stock chart, lazy-loaded so echarts (incl. candlestick) lands in its own chunk.
 * Two grids: price (candlestick on the left axis + PE line on a right second axis) and volume.
 * Price axis switches linear↔log via `logY`; OHLC adjusted per `adjust` (none/qfq/hfq).
 */
export default function StockChart({
  series,
  logY = false,
  adjust = 'qfq',
  className = 'jx-stock-chart',
}: Props) {
  const p = series.points;
  const dates = p.map((d) => d.date);

  // Adjustment factor per mode: none→1, hfq→adjFactor, qfq→adjFactor / latest-factor (anchor = most
  // recent day, so the newest bar matches the raw quote and history is scaled).
  let latest = 1;
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i].adjFactor != null) {
      latest = p[i].adjFactor!;
      break;
    }
  }
  const factorOf = (d: (typeof p)[number]): number => {
    if (adjust === 'none' || d.adjFactor == null) {
      return 1;
    }
    return adjust === 'hfq' ? d.adjFactor : d.adjFactor / latest;
  };

  // Candlestick item = [open, close, low, high] (× adjustment); missing day → NaN tuple (gap).
  const candle: number[][] = p.map((d) => {
    if (d.open == null || d.close == null || d.low == null || d.high == null) {
      return [NaN, NaN, NaN, NaN];
    }
    const f = factorOf(d);
    return [d.open * f, d.close * f, d.low * f, d.high * f];
  });
  const isUp = (d: (typeof p)[number]) => (d.close ?? 0) >= (d.open ?? 0);
  const vols = p.map((d) => ({ value: d.vol ?? NaN, itemStyle: { color: isUp(d) ? UP : DOWN } }));
  const pes: (number | null)[] = p.map((d) => d.pe ?? null);

  const option: ECOption = {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    legend: { data: ['K线', 'PE'], right: 8, top: 0, textStyle: { color: '#8a9099' } },
    grid: [
      { left: 56, right: 56, top: 28, height: '64%' },
      { left: 56, right: 56, top: '80%', height: '14%' },
    ],
    xAxis: [
      {
        type: 'category',
        data: dates,
        boundaryGap: true,
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#e8eaed' } },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: dates,
        axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' },
        axisLine: { lineStyle: { color: '#e8eaed' } },
      },
    ],
    yAxis: [
      // price (left): linear or log
      {
        type: logY ? 'log' : 'value',
        scale: !logY,
        name: '价',
        position: 'left',
        nameTextStyle: { color: '#8a9099' },
        axisLabel: { color: '#8a9099' },
        splitLine: { lineStyle: { color: '#f0f1f3' } },
      },
      // PE (right second axis)
      {
        type: 'value',
        scale: true,
        name: 'PE',
        position: 'right',
        nameTextStyle: { color: PE_COLOR },
        axisLabel: { color: PE_COLOR },
        axisLine: { show: true, lineStyle: { color: PE_COLOR } },
        splitLine: { show: false },
      },
      // volume (grid 1)
      {
        gridIndex: 1,
        name: '量',
        nameTextStyle: { color: '#8a9099' },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1], bottom: 0, height: 18, start: 50, end: 100 },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: candle,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
      },
      {
        name: 'PE',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: pes,
        showSymbol: false,
        lineStyle: { color: PE_COLOR, width: 1.2 },
      },
      { name: '量', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, data: vols },
    ],
  };

  return <EChart option={option} className={className} />;
}
