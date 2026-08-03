import { useTranslation } from 'react-i18next';
import type { IndustryHeatItem } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  industries: IndustryHeatItem[];
  selectedIndustryCode: string | null;
  onSelect: (industryCode: string) => void;
}

export default function IndustryStateMap({ industries, selectedIndustryCode, onSelect }: Props) {
  const { t } = useTranslation('valuation');
  const option: ECOption = {
    animationDuration: 300,
    grid: { left: 66, right: 34, top: 24, bottom: 62 },
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => formatTooltip(params, t),
    },
    xAxis: {
      type: 'value',
      name: t('marketState.industryMap.officialReturnAxis'),
      nameLocation: 'middle',
      nameGap: 36,
      nameTextStyle: { color: '#6f7580' },
      axisLabel: { color: '#6f7580', formatter: '{value}%' },
      axisLine: { lineStyle: { color: '#d9dde3' } },
      splitLine: { lineStyle: { color: '#eff0f2' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      name: t('marketState.industryMap.activityAxis'),
      nameLocation: 'middle',
      nameGap: 46,
      nameTextStyle: { color: '#6f7580' },
      axisLabel: { color: '#6f7580' },
      axisLine: { lineStyle: { color: '#d9dde3' } },
      splitLine: { lineStyle: { color: '#eff0f2' } },
    },
    visualMap: {
      type: 'continuous',
      min: 0,
      max: 100,
      dimension: 3,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemWidth: 14,
      itemHeight: 120,
      text: [t('marketState.industryMap.breadthHigh'), t('marketState.industryMap.breadthLow')],
      textStyle: { color: '#6f7580' },
      inRange: { color: ['#16a34a', '#d1d5db', '#dc2626'] },
      calculable: false,
    },
    series: [
      {
        type: 'scatter',
        data: industries.map((industry) => ({
          name: industry.l1Name,
          industryCode: industry.l1Code,
          value: [
            (industry.officialReturn20Day ?? 0) * 100,
            industry.activityScore,
            (industry.amountShare ?? 0) * 100,
            industry.breadthScore,
            industry.heatScore,
            industry.rank,
            industry.pe,
            industry.pePercentile10Year == null ? null : industry.pePercentile10Year * 100,
            industry.pb,
            industry.pbPercentile10Year == null ? null : industry.pbPercentile10Year * 100,
          ],
          symbolSize: symbolSize(industry.amountShare),
          label: {
            show:
              industry.rank <= 8 ||
              industry.l1Code === selectedIndustryCode ||
              industry.activityScore >= 90,
            formatter: industry.l1Name,
            position: 'top',
            color: '#374151',
            fontSize: 11,
          },
          itemStyle: {
            borderColor: industry.l1Code === selectedIndustryCode ? '#111827' : '#ffffff',
            borderWidth: industry.l1Code === selectedIndustryCode ? 3 : 1.5,
            opacity: industry.l1Code === selectedIndustryCode ? 1 : 0.84,
          },
        })),
        emphasis: {
          focus: 'self',
          scale: 1.35,
          label: { show: true, color: '#111827', fontWeight: 'bold' },
        },
      },
    ],
  };

  return (
    <EChart
      option={option}
      className="jx-marketState-industryMap"
      onClick={(params) => {
        const data = params.data as { industryCode?: string } | undefined;
        if (data?.industryCode) {
          onSelect(data.industryCode);
        }
      }}
    />
  );
}

function symbolSize(amountShare: number | null): number {
  const percentage = Math.max(0, (amountShare ?? 0) * 100);
  return Math.max(14, Math.min(46, 11 + Math.sqrt(percentage) * 8));
}

function formatTooltip(
  params: unknown,
  t: ReturnType<typeof useTranslation<'valuation'>>['t'],
): string {
  const item = params as { name?: string; value?: unknown[] };
  const values = item.value;
  if (!Array.isArray(values)) {
    return item.name ?? '';
  }

  return [
    `<strong>${item.name ?? ''}</strong>`,
    `${t('marketState.industry.officialReturn20')}: ${formatSigned(values[0])}%`,
    `${t('marketState.industry.activityScore')}: ${formatNumber(values[1])}`,
    `${t('marketState.industry.amountShare')}: ${formatNumber(values[2])}%`,
    `${t('marketState.industry.breadthScore')}: ${formatNumber(values[3])}`,
    `${t('marketState.industry.heat')}: ${formatNumber(values[4])}`,
    `${t('marketState.industry.pePosition')}: ${formatValuation(values[6], values[7])}`,
    `${t('marketState.industry.pbPosition')}: ${formatValuation(values[8], values[9])}`,
  ].join('<br/>');
}

function formatValuation(value: unknown, percentile: unknown): string {
  return typeof value === 'number' && typeof percentile === 'number'
    ? `${value.toFixed(1)} / P${Math.round(percentile)}`
    : '—';
}

function formatNumber(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}

function formatSigned(value: unknown): string {
  return typeof value === 'number' ? `${value > 0 ? '+' : ''}${value.toFixed(2)}` : '—';
}
