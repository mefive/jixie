import {
  BarChart,
  CandlestickChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  type BarSeriesOption,
  type CandlestickSeriesOption,
  type LineSeriesOption,
  type ScatterSeriesOption,
  type HeatmapSeriesOption,
} from 'echarts/charts';
import {
  GridComponent,
  MarkPointComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  AxisPointerComponent,
  VisualMapComponent,
  type GridComponentOption,
  type MarkPointComponentOption,
  type TooltipComponentOption,
  type LegendComponentOption,
  type DataZoomComponentOption,
  type VisualMapComponentOption,
} from 'echarts/components';
import * as echarts from 'echarts/core';
import type { ComposeOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

// On-demand registration: line/bar/candlestick + grid/tooltip/legend/markPoint/dataZoom/axisPointer + canvas
echarts.use([
  LineChart,
  BarChart,
  CandlestickChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  DataZoomComponent,
  AxisPointerComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

// Compose only the module types we use, avoiding type imports from the full 'echarts' (that would bundle the whole package)
export type ECOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | CandlestickSeriesOption
  | ScatterSeriesOption
  | HeatmapSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | MarkPointComponentOption
  | DataZoomComponentOption
  | VisualMapComponentOption
>;

interface Props {
  option: ECOption;
  className?: string; // Container must have a height (ECharts won't size itself), e.g. .jx-xxxChart { height: 260px }
  onClick?: (params: echarts.ECElementEvent) => void; // chart 'click' (e.g. select a trade point)
}

/** Ultra-thin ECharts shell: wraps init / setOption / resize / dispose once, reused directly by later charts. */
export function EChart({ option, className, onClick }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick; // keep latest handler without re-init

  useEffect(() => {
    if (!elRef.current) {
      return;
    }
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    chart.on('click', (p) => onClickRef.current?.(p as echarts.ECElementEvent));
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
