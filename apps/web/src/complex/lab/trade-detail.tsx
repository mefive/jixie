import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Spin } from 'antd';
import type { StockSeries, TradeRecord } from '@jixie/shared';
import { fetchStockSeries, fetchNames } from '@src/api/client';
import { EChart, type ECOption } from '@src/components/echart';
import './trade-detail.css';

const UP = '#e8463b'; // A-share red up
const DOWN = '#2f9e5b'; // green down
const DOT = '#f0a020'; // 富途式分红黄点 — trade markers on the axis

/**
 * 交易详情 — the traded stock's full K线 + 成交量, with each trade as a yellow dot pinned to the bottom
 * axis (Futu-style, not on the price line). Click a dot to scroll the right list to that fill. Multi-stock
 * strategies get a code picker (default the most-traded). Prices are 不复权 (raw) — the real trade prices
 * shown in the list (除权除息 gaps are real); the engine accounts internally in 后复权.
 */
export default function TradeDetail({
  tradeLog,
  start,
  end,
}: {
  tradeLog: TradeRecord[];
  start: string;
  end: string;
}) {
  const codes = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tradeLog) c.set(t.code, (c.get(t.code) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]); // [code, count] by count desc
  }, [tradeLog]);

  const [code, setCode] = useState(codes[0]?.[0] ?? '');
  const [names, setNames] = useState<Record<string, string>>({});
  const [series, setSeries] = useState<StockSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Names for the traded-instruments queue (bulk, once).
  useEffect(() => {
    if (!codes.length) return;
    fetchNames(codes.map((c) => c[0]))
      .then(setNames)
      .catch(() => {});
  }, [codes]);

  const trades = useMemo(() => tradeLog.filter((t) => t.code === code), [tradeLog, code]);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    setLoading(true);
    fetchStockSeries(code, start, end)
      .then((s) => alive && (setSeries(s), setLoading(false)))
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [code, start, end]);

  const option = useMemo<ECOption | null>(() => {
    if (!series) return null;
    const p = series.points;
    const dates = p.map((d) => d.date);
    // Unadjusted (raw) prices — so the chart's price level matches the real fill prices shown in the list
    // (除权除息 gaps are real). The trade dots are pinned to the axis, so they don't depend on this choice.
    const candle = p.map((d) =>
      d.open == null || d.close == null || d.low == null || d.high == null
        ? [NaN, NaN, NaN, NaN]
        : [d.open, d.close, d.low, d.high],
    );
    const vols = p.map((d) => ({
      value: d.vol ?? NaN,
      itemStyle: { color: (d.close ?? 0) >= (d.open ?? 0) ? UP : DOWN },
    }));
    let lo = Infinity;
    for (const c of candle) if (Number.isFinite(c[2])) lo = Math.min(lo, c[2]);
    const dots = trades.map((t) => ({ value: [t.date, lo], side: t.side }));

    return {
      animation: false,
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 60, right: 16, top: 12, height: '58%' },
        { left: 60, right: 16, top: '68%', height: '17%' },
      ],
      xAxis: [
        { type: 'category', data: dates, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#e8eaed' } } },
        { type: 'category', gridIndex: 1, data: dates, axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' }, axisLine: { lineStyle: { color: '#e8eaed' } } },
      ],
      yAxis: [
        { type: 'value', scale: true, position: 'left', axisLabel: { color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
        { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 10, height: 20, start: 0, end: 100 },
      ],
      series: [
        { name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: candle, itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } },
        { name: '量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols },
        { name: '交易', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: dots, symbol: 'circle', symbolSize: 9, itemStyle: { color: DOT, borderColor: '#fff', borderWidth: 1 }, z: 10 },
      ],
    };
  }, [series, trades]);

  const pick = (date: string) => {
    const idx = trades.findIndex((t) => t.date === date);
    if (idx < 0) return;
    setActive(idx);
    listRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div className="jx-td">
      <div className="jx-td-chart">
        <div className="jx-td-queue">
          {codes.map(([c, n]) => (
            <button
              key={c}
              className={classNames('jx-td-chip', { 'jx-td-chip--active': c === code })}
              onClick={() => setCode(c)}
              title={`${names[c] ?? ''} ${c}`}
            >
              <span className="jx-td-chipName">{names[c] ?? c}</span>
              <span className="jx-td-chipCode">{c}</span>
              <span className="jx-td-chipCount">{n}</span>
            </button>
          ))}
        </div>
        <div className="jx-td-hint">
          交易点(黄)在 K 线下方横轴;点它 → 右侧定位。价格为不复权真实成交价
        </div>
        {loading || !option ? (
          <div className="jx-td-loading">{loading ? <Spin /> : '无行情'}</div>
        ) : (
          <EChart
            option={option}
            className="jx-td-canvas"
            onClick={(p: any) => {
              if (p.seriesName === '交易') pick(p.value[0]);
            }}
          />
        )}
      </div>

      <div className="jx-td-list" ref={listRef}>
        <div className="jx-td-head">
          <span>日期</span>
          <span>方向</span>
          <span className="jx-td-num">数量</span>
          <span className="jx-td-num">价格</span>
          <span className="jx-td-num">金额</span>
        </div>
        {trades.map((t, i) => (
          <div key={i} data-i={i} className={classNames('jx-td-row', { 'jx-td-row--active': i === active })}>
            <span>{fmtDate(t.date)}</span>
            <span className={t.side === 'buy' ? 'text-up' : 'text-down'}>{t.side === 'buy' ? '买' : '卖'}</span>
            <span className="jx-td-num">{Math.round(t.realShares ?? t.shares).toLocaleString()}</span>
            <span className="jx-td-num">{(t.realPrice ?? t.price).toFixed(2)}</span>
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
