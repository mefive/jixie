import { BarChart, LineChart, type BarSeriesOption, type LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
  LegendComponent,
  type GridComponentOption,
  type MarkPointComponentOption,
  type TooltipComponentOption,
  type LegendComponentOption,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { ComposeOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// On-demand registration: line/bar + grid/tooltip/legend/markPoint + canvas (full echarts is 330KB gzip, this is only ~60KB)
echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

// Compose only the module types we use, avoiding type imports from the full 'echarts' (that would bundle the whole package)
export type ECOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | MarkPointComponentOption
>;

interface Props {
  option: ECOption;
  className?: string; // Container must have a height (ECharts won't size itself), e.g. .jx-xxxChart { height: 260px }
}

/** Ultra-thin ECharts shell: wraps init / setOption / resize / dispose once, reused directly by later charts. */
export function EChart({ option, className }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true); // notMerge: full replace, avoids leftover old series
  }, [option]);

  return <div ref={elRef} className={className} />;
}
