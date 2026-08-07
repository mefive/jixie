import { useTranslation } from 'react-i18next';
import type { FactorTimeSeriesReportV1 } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

export default function TimeSeriesStateChart({ report }: { report: FactorTimeSeriesReportV1 }) {
  const { t } = useTranslation('factor');
  const labels = report.byAsset.map((row) => t(`timeSeries.assetNames.${row.assetId}`));
  const option: ECOption = {
    grid: { left: 58, right: 18, top: 42, bottom: 34 },
    legend: {
      top: 4,
      data: [t('timeSeries.positiveState'), t('timeSeries.negativeState')],
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value) => `${(Number(value) * 100).toFixed(2)}%`,
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: { color: '#8a9099', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e8eaed' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(1)}%`, color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        name: t('timeSeries.positiveState'),
        type: 'bar',
        data: report.byAsset.map((row) => row.positiveStateMeanReturn),
        itemStyle: { color: '#315efb', borderRadius: [3, 3, 0, 0] },
      },
      {
        name: t('timeSeries.negativeState'),
        type: 'bar',
        data: report.byAsset.map((row) => row.negativeStateMeanReturn),
        itemStyle: { color: '#aab2c0', borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
  return <EChart option={option} className="jx-factor-chart" />;
}
