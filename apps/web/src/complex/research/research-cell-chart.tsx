import type { ResearchChartOutputV1 } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface ResearchCellChartProps {
  chart: ResearchChartOutputV1;
}

export default function ResearchCellChart({ chart }: ResearchCellChartProps) {
  return <EChart className="jx-research-cellChart" option={chartOption(chart)} />;
}

// —— Helpers ——

const SERIES_PALETTE = ['#111827', '#e8463b', '#2f9e5b', '#b38f2d', '#64748b'];

function chartOption(chart: ResearchChartOutputV1): ECOption {
  const scatter = chart.kind === 'scatter';
  return {
    animationDuration: 280,
    grid: { left: 58, right: 22, top: chart.title ? 52 : 30, bottom: 52 },
    title: chart.title
      ? { text: chart.title, left: 12, top: 8, textStyle: { fontSize: 13, color: '#111827' } }
      : undefined,
    tooltip: { trigger: scatter ? 'item' : 'axis' },
    legend:
      chart.series.length > 1
        ? { top: chart.title ? 30 : 8, right: 12, textStyle: { color: '#64748b', fontSize: 11 } }
        : undefined,
    xAxis: {
      type: scatter ? 'value' : 'category',
      ...(scatter ? {} : { data: chart.rows.map((row) => formatDate(row[chart.x])) }),
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: '#64748b' },
      splitLine: { lineStyle: { color: '#f1f5f9' } },
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 8 }],
    series: chart.series.map((series, index) => ({
      name: series.label ?? series.column,
      type:
        chart.kind === 'bar' || chart.kind === 'histogram' ? 'bar' : scatter ? 'scatter' : 'line',
      data: scatter
        ? chart.rows.map((row) => [numberValue(row[chart.x]), numberValue(row[series.column])])
        : chart.rows.map((row) => numberValue(row[series.column])),
      showSymbol: scatter,
      symbolSize: scatter ? 7 : 3,
      smooth: false,
      lineStyle: { width: 1.7 },
      areaStyle: chart.kind === 'area' ? { opacity: 0.14 } : undefined,
      itemStyle: { color: SERIES_PALETTE[index % SERIES_PALETTE.length] },
    })),
  } as ECOption;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDate(value: unknown): string {
  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    return text.slice(0, 10);
  }
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  }
  return text;
}
