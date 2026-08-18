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

export function chartOption(chart: ResearchChartOutputV1): ECOption {
  if (chart.kind === 'boxplot') {
    return boxplotOption(chart);
  }
  if (chart.kind === 'heatmap') {
    return heatmapOption(chart);
  }

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
      barCategoryGap: chart.kind === 'histogram' ? '2%' : undefined,
      markLine:
        chart.kind === 'event_path'
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#94a3b8', type: 'dashed', width: 1 },
              data: [
                ...(eventTimeMarker(chart) ? [{ name: 't=0', xAxis: eventTimeMarker(chart) }] : []),
                { name: '0', yAxis: 0 },
              ],
            }
          : undefined,
      itemStyle: { color: SERIES_PALETTE[index % SERIES_PALETTE.length] },
    })),
  } as ECOption;
}

function boxplotOption(chart: ResearchChartOutputV1): ECOption {
  const points = chart.rows.flatMap((row) => {
    const values = ['min', 'q1', 'median', 'q3', 'max'].map((column) => numberValue(row[column]));
    return values.every((value): value is number => value !== null)
      ? [{ category: String(row[chart.x] ?? ''), values }]
      : [];
  });
  return {
    animationDuration: 280,
    grid: { left: 58, right: 22, top: chart.title ? 52 : 30, bottom: 58 },
    title: chartTitle(chart),
    tooltip: { trigger: 'item' },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.category),
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
    series: [
      {
        name: chart.series[0]?.label ?? 'distribution',
        type: 'boxplot',
        data: points.map((point) => point.values),
        itemStyle: { color: '#dbeafe', borderColor: '#1d4ed8' },
      },
    ],
  } as ECOption;
}

function heatmapOption(chart: ResearchChartOutputV1): ECOption {
  const yColumn = chart.y ?? 'y';
  const xCategories = unique(chart.rows.map((row) => formatDate(row[chart.x])));
  const yCategories = unique(chart.rows.map((row) => String(row[yColumn] ?? '')));
  const values = chart.rows.flatMap((row) => {
    const value = numberValue(row[chart.series[0]?.column ?? 'value']);
    if (value === null) {
      return [];
    }
    return [
      [
        xCategories.indexOf(formatDate(row[chart.x])),
        yCategories.indexOf(String(row[yColumn] ?? '')),
        value,
      ],
    ];
  });
  const numericValues = values.map((point) => point[2]);
  const minimum = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const maximum = numericValues.length > 0 ? Math.max(...numericValues) : 0;
  const crossesZero = minimum < 0 && maximum > 0;
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  const visualMinimum = crossesZero ? -magnitude : minimum;
  const visualMaximum = crossesZero ? magnitude : maximum;
  const colors = crossesZero
    ? ['#b91c1c', '#f8fafc', '#1d4ed8']
    : maximum <= 0
      ? ['#b91c1c', '#fecaca', '#fef2f2']
      : ['#eff6ff', '#93c5fd', '#1d4ed8'];
  return {
    animationDuration: 280,
    grid: { left: 76, right: 22, top: chart.title ? 52 : 30, bottom: 82 },
    title: chartTitle(chart),
    tooltip: { trigger: 'item' },
    xAxis: {
      type: 'category',
      data: xCategories,
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    yAxis: {
      type: 'category',
      data: yCategories,
      inverse: true,
      axisLabel: { color: '#64748b', hideOverlap: true },
      axisLine: { lineStyle: { color: '#e5e7eb' } },
    },
    visualMap: {
      min: visualMinimum,
      max: visualMaximum,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 8,
      inRange: { color: colors },
    },
    series: [
      {
        name: chart.series[0]?.label ?? 'value',
        type: 'heatmap',
        data: values,
        emphasis: { itemStyle: { borderColor: '#111827', borderWidth: 1 } },
      },
    ],
  } as ECOption;
}

function chartTitle(chart: ResearchChartOutputV1) {
  return chart.title
    ? { text: chart.title, left: 12, top: 8, textStyle: { fontSize: 13, color: '#111827' } }
    : undefined;
}

function eventTimeMarker(chart: ResearchChartOutputV1): string | undefined {
  const row = chart.rows.find((candidate) => numberValue(candidate[chart.x]) === 0);
  return row ? formatDate(row[chart.x]) : undefined;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function numberValue(value: unknown): number | null {
  if (value === null || typeof value === 'boolean' || value === '') {
    return null;
  }
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
