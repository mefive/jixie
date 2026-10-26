import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Popover, Segmented } from 'antd';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilter } from '@fortawesome/free-solid-svg-icons';
import { EChart, type ECOption } from '@src/components/echart';
import { BENCHMARKS, type BenchmarkCode, type BenchmarkSeries } from './benchmarks';

/**
 * 提供回测净值、基准及基准，供路径和回撤切换。
 *
 * Supply NAV, benchmark and benchmark series for equity and drawdown views.
 */
interface Props {
  nav: { date: string; value: number }[];
  up: boolean;
  benchmarks: BenchmarkSeries;
  benchmarksLoading: boolean;
}

type ChartView = 'equity' | 'drawdown';

// Lazy-loaded so echarts lands in its own chunk (see apps/web/CLAUDE.md §3).

/**
 * 按净值或回撤视图构造图表，支持基准展示。
 *
 * Render NAV or drawdown views with benchmark support.
 */
export default function NavChart({ nav, up, benchmarks, benchmarksLoading }: Props) {
  const { t } = useTranslation('strategy');
  const [view, setView] = useState<ChartView>('equity');
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<BenchmarkCode[]>(['H00300.CSI']);
  const benchmarkFilterActive = selectedBenchmarks.length > 0;
  const drawdown = useMemo(() => drawdownSeries(nav), [nav]);
  const option = useMemo<ECOption>(
    () =>
      view === 'equity'
        ? equityOption(nav, up, benchmarks, selectedBenchmarks, t)
        : drawdownOption(drawdown.points, drawdown, t),
    [nav, up, view, drawdown, benchmarks, selectedBenchmarks, t],
  );

  return (
    <section className="jx-strategy-performance">
      <div className="jx-strategy-performanceHead">
        <Segmented
          size="small"
          value={view}
          onChange={(value) => setView(value as ChartView)}
          options={[
            { label: t('chartEquity'), value: 'equity' },
            { label: t('chartDrawdown'), value: 'drawdown' },
          ]}
        />
        {view === 'equity' ? (
          <Popover
            placement="bottomRight"
            trigger="click"
            content={
              <div className="jx-strategy-benchmarkPopup">
                <div className="jx-strategy-benchmarkPopupTitle">{t('benchmarkCompare')}</div>
                <Checkbox.Group
                  className="jx-strategy-benchmarkOptions"
                  value={selectedBenchmarks}
                  onChange={(codes) => setSelectedBenchmarks(codes as BenchmarkCode[])}
                  options={BENCHMARKS.map(({ code, nameKey }) => ({
                    value: code,
                    label: t(nameKey),
                  }))}
                />
                <div className="jx-strategy-benchmarkPopupHint">{t('benchmarkRebasedHint')}</div>
              </div>
            }
          >
            <Button
              className="jx-strategy-benchmarkFilter"
              type={benchmarkFilterActive ? 'primary' : 'text'}
              size="small"
              loading={benchmarksLoading}
              icon={<FontAwesomeIcon icon={faFilter} />}
              aria-label={t('benchmarkFilter')}
              title={t('benchmarkFilter')}
            />
          </Popover>
        ) : drawdown.trough ? (
          <span className="jx-strategy-performanceMeta">
            {t('drawdownPeriod', {
              peak: formatDate(drawdown.peak?.date),
              trough: formatDate(drawdown.trough.date),
              recovery: drawdown.recovery
                ? formatDate(drawdown.recovery.date)
                : t('drawdownNotRecovered'),
            })}
          </span>
        ) : null}
      </div>
      <EChart option={option} className="jx-strategy-chart" />
    </section>
  );
}

/**
 * 构造策略与基准净值图，供回测收益路径比较。
 *
 * Build strategy and benchmark equity options for backtest comparison.
 */
function equityOption(
  nav: Props['nav'],
  up: boolean,
  benchmarks: BenchmarkSeries,
  selectedBenchmarks: BenchmarkCode[],
  t: (key: string) => string,
): ECOption {
  const color = up ? '#e8463b' : '#2f9e5b';
  const benchmarkLines = BENCHMARKS.filter(({ code }) => selectedBenchmarks.includes(code))
    .map(({ code, nameKey, color: benchmarkColor }) => {
      const data = rebaseBenchmark(nav, benchmarks[code] ?? []);
      if (!data) {
        return null;
      }

      return {
        name: t(nameKey),
        type: 'line' as const,
        data,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { color: benchmarkColor, width: 1.25 },
        itemStyle: { color: benchmarkColor },
      };
    })
    .filter((series) => series != null);

  return {
    animation: false,
    legend: {
      top: 0,
      left: 0,
      itemWidth: 14,
      itemHeight: 3,
      textStyle: { color: '#5f6670', fontSize: 11 },
    },
    grid: { left: 56, right: 16, top: 34, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const points = Array.isArray(params) ? params : [params];
        const rows = points
          .filter((point: any) => point.data != null)
          .map(
            (point: any) =>
              `${point.marker}${point.seriesName} ${Math.round(point.data).toLocaleString()}`,
          );
        return `${formatDate(String(points[0]?.axisValue ?? ''))}<br/>${rows.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: nav.map((point) => point.date),
      axisLabel: { formatter: (date: string) => date.slice(0, 4), color: '#8a9099' },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        formatter: (value: number) => (value / 10000).toFixed(0) + t('unitWan'),
        color: '#8a9099',
      },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        name: t('navStrategy'),
        type: 'line',
        data: nav.map((point) => point.value),
        showSymbol: false,
        lineStyle: { color, width: 1.5 },
        itemStyle: { color },
        areaStyle: { color, opacity: 0.06 },
      },
      ...benchmarkLines,
    ],
  };
}

function rebaseBenchmark(
  nav: Props['nav'],
  points: { date: string; close: number }[],
): (number | null)[] | null {
  const closes = new Map(points.map((point) => [point.date, point.close]));
  const baseIndex = nav.findIndex((point) => (closes.get(point.date) ?? 0) > 0);
  if (baseIndex < 0) {
    return null;
  }

  const baseDate = nav[baseIndex].date;
  const baseClose = closes.get(baseDate)!;
  const baseValue = nav[baseIndex].value;
  return nav.map((point, index) => {
    const close = closes.get(point.date);
    if (index < baseIndex || close == null) {
      return null;
    }
    return (close / baseClose) * baseValue;
  });
}

/**
 * 构造水下曲线及回撤标注，保持负回撤口径。
 *
 * Build underwater drawdown options and markers using the negative drawdown convention.
 */
function drawdownOption(
  points: DrawdownPoint[],
  period: DrawdownSeries,
  t: (key: string) => string,
): ECOption {
  const markers: DrawdownMarker[] = [];
  if (period.peak && period.trough) {
    markers.push(
      {
        name: t('drawdownPeak'),
        coord: [period.peak.date, period.peak.drawdown],
        symbolSize: 32,
        itemStyle: { color: '#8a9099' },
        label: { formatter: t('drawdownPeak'), color: '#fff', fontSize: 9 },
      },
      {
        name: t('drawdownTrough'),
        coord: [period.trough.date, period.trough.drawdown],
        symbolSize: 38,
        itemStyle: { color: '#2f9e5b' },
        label: { formatter: t('drawdownTrough'), color: '#fff', fontSize: 9 },
      },
    );
  }
  if (period.recovery) {
    markers.push({
      name: t('drawdownRecovery'),
      coord: [period.recovery.date, period.recovery.drawdown],
      symbolSize: 34,
      itemStyle: { color: '#111827' },
      label: { formatter: t('drawdownRecovery'), color: '#fff', fontSize: 9 },
    });
  }

  return {
    grid: { left: 56, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const point = Array.isArray(params) ? params[0] : params;
        return `${formatDate(String(point.axisValue))}<br/>${t('chartDrawdown')} ${Number(
          point.data,
        ).toFixed(2)}%`;
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.date),
      axisLabel: { formatter: (date: string) => date.slice(0, 4), color: '#8a9099' },
      axisLine: { lineStyle: { color: '#e8eaed' } },
    },
    yAxis: {
      type: 'value',
      max: 0,
      axisLabel: {
        formatter: (value: number) => `${value.toFixed(0)}%`,
        color: '#8a9099',
      },
      splitLine: { lineStyle: { color: '#f0f1f3' } },
    },
    series: [
      {
        type: 'line',
        data: points.map((point) => point.drawdown),
        showSymbol: false,
        lineStyle: { color: '#2f9e5b', width: 1.5 },
        areaStyle: { color: '#2f9e5b', opacity: 0.1 },
        markPoint: { data: markers },
      },
    ],
  };
}

/**
 * 记录单日净值峰值回撤，供水下曲线。
 *
 * Describe a dated drawdown from the running NAV peak.
 */
interface DrawdownPoint {
  date: string;
  value: number;
  drawdown: number;
}

/**
 * 组合回撤路径及区间标记，供图表提示。
 *
 * Collect drawdown paths and episode markers for charting.
 */
interface DrawdownSeries {
  points: DrawdownPoint[];
  peak?: DrawdownPoint;
  trough?: DrawdownPoint;
  recovery?: DrawdownPoint;
}

/**
 * 定位回撤开始、谷底或恢复事件，供曲线标注。
 *
 * Identify drawdown start, trough or recovery markers.
 */
interface DrawdownMarker {
  name: string;
  coord: [string, number];
  symbolSize: number;
  itemStyle: { color: string };
  label: { formatter: string; color: string; fontSize: number };
}

/**
 * 从净值计算逐日峰值回撤，并提取开始、谷底和恢复标记。
 *
 * Derive drawdowns from running NAV peaks and identify start, trough and recovery markers.
 */
function drawdownSeries(nav: Props['nav']): DrawdownSeries {
  if (!nav.length) {
    return { points: [] };
  }

  let runningPeak = nav[0].value;
  let runningPeakIndex = 0;
  let maxDrawdown = 0;
  let maxPeakIndex = 0;
  let troughIndex = 0;

  /**
   * 更新净值运行峰值并计算百分比回撤，同时记录最深谷底区间。
   *
   * Update the running NAV peak and percentage drawdown while tracking the deepest episode.
   */
  const points = nav.map((point, index) => {
    if (point.value > runningPeak) {
      runningPeak = point.value;
      runningPeakIndex = index;
    }
    const drawdown = runningPeak > 0 ? (point.value / runningPeak - 1) * 100 : 0;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxPeakIndex = runningPeakIndex;
      troughIndex = index;
    }
    return { ...point, drawdown };
  });

  if (maxDrawdown === 0) {
    return { points };
  }

  const peak = points[maxPeakIndex];
  const trough = points[troughIndex];
  const recovery = points.slice(troughIndex + 1).find((point) => point.value >= peak.value);

  return { points, peak, trough, recovery };
}

function formatDate(date?: string): string {
  if (!date) {
    return '—';
  }
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}
