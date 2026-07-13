import { useTranslation } from 'react-i18next';
import type { StockSeries } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

export type Adjust = 'none' | 'qfq' | 'hfq';

interface Props {
  series: StockSeries;
  logY?: boolean; // log price axis
  adjust?: Adjust; // unadjusted / forward-adjusted (qfq) / after-adjusted (hfq)
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
  const { t } = useTranslation('stock');
  const p = series.points;
  const dates = p.map((d) => d.date);
  const isShortHistory = p.length <= 120;

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
    legend: {
      data: [t('chart.candlestick'), t('chart.pe')],
      right: 8,
      top: 0,
      textStyle: { color: '#8a9099' },
    },
    grid: [
      { left: 56, right: 56, top: 28, height: '64%' },
      { left: 56, right: 56, top: '76%', bottom: 72 },
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
        axisLabel: {
          formatter: (date: string) =>
            isShortHistory
              ? `${date.slice(4, 6)}-${date.slice(6, 8)}`
              : `${date.slice(0, 4)}-${date.slice(4, 6)}`,
          color: '#8a9099',
        },
        axisLine: { lineStyle: { color: '#e8eaed' } },
      },
    ],
    yAxis: [
      // price (left): linear or log
      {
        type: logY ? 'log' : 'value',
        scale: !logY,
        name: t('chart.priceAxis'),
        position: 'left',
        nameTextStyle: { color: '#8a9099' },
        axisLabel: { color: '#8a9099' },
        splitLine: { lineStyle: { color: '#f0f1f3' } },
      },
      // PE (right second axis)
      {
        type: 'value',
        scale: true,
        name: t('chart.pe'),
        position: 'right',
        nameTextStyle: { color: PE_COLOR },
        axisLabel: { color: PE_COLOR },
        axisLine: { show: true, lineStyle: { color: PE_COLOR } },
        splitLine: { show: false },
      },
      // volume (grid 1)
      {
        gridIndex: 1,
        name: t('chart.volume'),
        nameTextStyle: { color: '#8a9099' },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        bottom: 16,
        height: 30,
        handleSize: '90%',
        showDetail: false,
        start: 0,
        end: 100,
      },
    ],
    series: [
      {
        name: t('chart.candlestick'),
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: candle,
        barMaxWidth: 18,
        itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        tooltip: { valueFormatter: formatPrice },
      },
      {
        name: t('chart.pe'),
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: pes,
        showSymbol: false,
        lineStyle: { color: PE_COLOR, width: 1.2 },
        tooltip: { valueFormatter: formatRatio },
      },
      {
        name: t('chart.volume'),
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 2,
        data: vols,
        barMaxWidth: 22,
        tooltip: { valueFormatter: formatVolume },
      },
    ],
  };

  return <EChart option={option} className={className} />;
}

// —— Helpers ——

function formatPrice(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

function formatRatio(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

function formatVolume(value: unknown): string {
  return typeof value === 'number'
    ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : String(value);
}
