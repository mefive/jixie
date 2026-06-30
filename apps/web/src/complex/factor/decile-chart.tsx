import type { BucketStat } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';

interface Props {
  buckets: BucketStat[]; // length 10, ascending by factor value (D1 low … D10 high)
}

// Monochrome ink ramp light→dark across deciles: with the bars ordered D1→D10, a rising ramp that also
// rises in height = momentum, a ramp that falls in height = reversal. Reinforces "单调性一眼可见".
function inkRamp(i: number, n: number): string {
  const t = n > 1 ? i / (n - 1) : 0;
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  // #c9ccd1 (light) → #1f2430 (ink)
  return `rgb(${lerp(201, 31)}, ${lerp(204, 36)}, ${lerp(209, 48)})`;
}

// Lazy-loaded so echarts stays in its own chunk (apps/web/CLAUDE.md §3).
export default function DecileChart({ buckets }: Props) {
  const n = buckets.length;
  const labels = buckets.map((b) =>
    b.bucket === 0 ? 'D1低' : b.bucket === n - 1 ? `D${n}高` : `D${b.bucket + 1}`,
  );
  const option: ECOption = {
    grid: { left: 52, right: 16, top: 20, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        const b = buckets[p.dataIndex];
        return (
          `${labels[p.dataIndex]}<br/>` +
          `年化收益 ${(b.annReturn * 100).toFixed(2)}%<br/>` +
          `Sharpe ${b.sharpe.toFixed(2)} · 期末净值 ${b.navEnd.toFixed(2)}`
        );
      },
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
      axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(0)}%`, color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'bar',
        data: buckets.map((b, i) => ({
          value: b.annReturn,
          itemStyle: { color: inkRamp(i, n), borderRadius: [3, 3, 0, 0] },
        })),
        barWidth: '60%',
      },
    ],
  };
  return <EChart option={option} className="jx-factor-chart" />;
}
