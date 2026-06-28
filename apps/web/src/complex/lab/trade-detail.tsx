import { useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import type { BacktestSummary, TradeRecord } from '@jixie/shared';
import { EChart, type ECOption } from '@src/components/echart';
import './trade-detail.css';

/**
 * 交易详情 — the trade log over the equity curve. Left: nav line + a trade-point per date (bigger dot =
 * more fills that day); click a point to scroll the right list to that day's first trade. Right: every
 * fill (date / code / 买卖 / 数量 / 价格 / 金额). Prices/amounts are 后复权 (the engine trades in hfq space).
 */
export default function TradeDetail({ nav, tradeLog }: { nav: BacktestSummary['nav']; tradeLog: TradeRecord[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const option = useMemo<ECOption>(() => {
    const valByDate = new Map(nav.map((n) => [n.date, n.value]));
    const countByDate = new Map<string, number>();
    for (const t of tradeLog) countByDate.set(t.date, (countByDate.get(t.date) ?? 0) + 1);
    const maxCount = Math.max(1, ...countByDate.values());
    const scatter = [...countByDate].map(([date, count]) => ({ value: [date, valByDate.get(date) ?? null], count }));

    return {
      grid: { left: 56, right: 16, top: 12, bottom: 28 },
      tooltip: {
        trigger: 'item',
        formatter: (p: any) =>
          p.seriesType === 'scatter'
            ? `${fmtDate(p.value[0])}<br/>${p.data.count} 笔成交`
            : `${fmtDate(p.name)}<br/>权益 ${Math.round(p.value).toLocaleString()}`,
      },
      xAxis: {
        type: 'category',
        data: nav.map((n) => n.date),
        axisLabel: { formatter: (d: string) => d.slice(0, 4), color: '#8a9099' },
        axisLine: { lineStyle: { color: '#e8eaed' } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (v: number) => (v / 10000).toFixed(0) + '万', color: '#8a9099' },
        splitLine: { lineStyle: { color: '#f0f1f3' } },
      },
      series: [
        {
          type: 'line',
          data: nav.map((n) => n.value),
          showSymbol: false,
          lineStyle: { color: '#8a9099', width: 1.2 },
          areaStyle: { color: '#8a9099', opacity: 0.05 },
        },
        {
          type: 'scatter',
          data: scatter,
          symbolSize: (_v: unknown, p: any) => 6 + Math.sqrt(p.data.count / maxCount) * 16,
          itemStyle: { color: '#e8a33d', opacity: 0.85, borderColor: '#fff', borderWidth: 1 },
          z: 5,
        },
      ],
    };
  }, [nav, tradeLog]);

  const pick = (date: string) => {
    const idx = tradeLog.findIndex((t) => t.date === date);
    if (idx < 0) return;
    setActive(idx);
    listRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div className="jx-td">
      <div className="jx-td-chart">
        <EChart
          option={option}
          className="jx-td-canvas"
          onClick={(p: any) => {
            if (p.seriesType === 'scatter') pick(p.value[0]);
          }}
        />
        <div className="jx-td-hint">点上方交易点 → 右侧定位到该笔(点越大,当日成交越多);价格为后复权口径</div>
      </div>

      <div className="jx-td-list" ref={listRef}>
        <div className="jx-td-head">
          <span>日期</span>
          <span>标的</span>
          <span>方向</span>
          <span className="jx-td-num">数量</span>
          <span className="jx-td-num">价格</span>
          <span className="jx-td-num">金额</span>
        </div>
        {tradeLog.map((t, i) => (
          <div key={i} data-i={i} className={classNames('jx-td-row', { 'jx-td-row--active': i === active })}>
            <span>{fmtDate(t.date)}</span>
            <span className="jx-td-code">{t.code}</span>
            <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>{t.side === 'buy' ? '买' : '卖'}</span>
            <span className="jx-td-num">{t.shares.toLocaleString()}</span>
            <span className="jx-td-num">{t.price.toFixed(2)}</span>
            <span className="jx-td-num">{(t.amount / 10000).toFixed(1)}万</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
