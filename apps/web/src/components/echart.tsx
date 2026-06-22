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

// 按需注册：line/bar + grid/tooltip/legend/markPoint + canvas（全量 echarts 330KB gzip，这样只 ~60KB）
echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

// 只组合用到的模块类型，避免从全量 'echarts' 引类型（那会把整包打进来）
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
  className?: string; // 容器必须有高度（ECharts 不自撑高），如 .jx-xxxChart { height: 260px }
}

/** 极薄 ECharts 壳：init / setOption / resize / dispose 封装一次，后续图表直接复用。 */
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
    chartRef.current?.setOption(option, true); // notMerge：完整替换，避免残留旧系列
  }, [option]);

  return <div ref={elRef} className={className} />;
}
