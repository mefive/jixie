import type { StrategyScanReport } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';
import { metricValue, type ScanMetric } from './parameter-scan';

export default function ParameterScanChart({
  report,
  metric,
}: {
  report: StrategyScanReport;
  metric: ScanMetric;
}) {
  const [first, second] = report.spec.dimensions;
  const cells = report.payload?.cells ?? [];
  const sample = report.spec.splitDate ? 'outOfSample' : 'full';
  let option: ECOption;

  if (!second) {
    option = {
      tooltip: { trigger: 'axis' },
      grid: { left: 58, right: 24, top: 24, bottom: 42 },
      xAxis: { type: 'category', data: first.values.map(String), name: first.key },
      yAxis: { type: 'value', scale: true },
      series: [
        {
          type: 'line',
          smooth: false,
          symbolSize: 7,
          data: first.values.map((value) => {
            const cell = cells.find((candidate) => candidate.params[first.key] === value);
            return metricValue(metric, cell?.[sample]);
          }),
          lineStyle: { color: '#111827', width: 2 },
          itemStyle: { color: '#111827' },
        },
      ],
    };
  } else {
    const data = cells.map((cell) => [
      second.values.indexOf(cell.params[second.key]),
      first.values.indexOf(cell.params[first.key]),
      metricValue(metric, cell[sample]) ?? null,
    ]);
    const finite = data
      .map((point) => point[2])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    option = {
      tooltip: {
        formatter: (params: any) => {
          const [x, y, value] = params.value;
          return `${first.key}=${first.values[y]}<br/>${second.key}=${second.values[x]}<br/>${formatValue(metric, value)}`;
        },
      },
      grid: { left: 70, right: 56, top: 20, bottom: 48 },
      xAxis: { type: 'category', data: second.values.map(String), name: second.key },
      yAxis: { type: 'category', data: first.values.map(String), name: first.key },
      visualMap: {
        min: finite.length ? Math.min(...finite) : 0,
        max: finite.length ? Math.max(...finite) : 1,
        calculable: false,
        orient: 'vertical',
        right: 0,
        top: 'middle',
        inRange: {
          color:
            metric === 'turnover' || metric === 'totalSlippage'
              ? ['#dcfce7', '#f8fafc', '#fee2e2']
              : ['#fee2e2', '#f8fafc', '#dcfce7'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: true, formatter: (params: unknown) => formatValue(metric, params) },
        },
      ],
    };
  }

  return <EChart option={option} className="jx-parameterScan-chart" />;
}

function formatValue(metric: ScanMetric, value: unknown): string {
  const numeric =
    typeof value === 'object' && value != null && 'value' in value
      ? Number((value as { value: unknown[] }).value[2])
      : Number(value);
  if (!Number.isFinite(numeric)) {
    return '—';
  }
  if (metric === 'annReturn' || metric === 'maxDrawdown' || metric === 'excessReturn') {
    return `${(numeric * 100).toFixed(2)}%`;
  }
  if (metric === 'turnover') {
    return `${numeric.toFixed(1)}×`;
  }
  if (metric === 'totalSlippage') {
    return `¥${Math.round(numeric).toLocaleString()}`;
  }
  return numeric.toFixed(2);
}
