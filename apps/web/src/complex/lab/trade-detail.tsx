import { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { Spin } from 'antd';
import type { StockSeries, TradeRecord } from '@jixie/shared';
import { fetchStockSeries, fetchNames, fetchIndexSeries } from '@src/api/client';
import { EChart, type ECOption } from '@src/components/echart';
import './trade-detail.css';

const UP = '#e8463b'; // A-share red up
const DOWN = '#2f9e5b'; // green down
const DOT = '#f0a020'; // 富途式分红黄点 — trade markers on the axis
const ALL = ''; // the 全部 chip's value (portfolio overview; no real tsCode is empty)

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
  nav,
}: {
  tradeLog: TradeRecord[];
  start: string;
  end: string;
  nav?: { date: string; value: number }[]; // strategy equity curve → 收益率曲线(右轴)
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

  // 沪深300 daily close over the window → benchmark return curve (right axis).
  const [bench, setBench] = useState<{ date: string; close: number }[]>([]);
  useEffect(() => {
    fetchIndexSeries('000300.SH', start, end)
      .then((r) => setBench(r.points))
      .catch(() => setBench([]));
  }, [start, end]);

  // 全部 (code === ALL) → every instrument's fills, sorted by date; else this instrument's fills.
  const trades = useMemo(
    () =>
      code === ALL
        ? [...tradeLog].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        : tradeLog.filter((t) => t.code === code),
    [tradeLog, code],
  );

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
    // 全部 — no single-instrument K线; show the portfolio return curves (策略 vs 沪深300) full-width.
    if (code === ALL) {
      const navDates = (nav ?? []).map((n) => n.date);
      if (!navDates.length) return null;
      const nav0 = nav![0].value;
      const benchMap = new Map(bench.map((x) => [x.date, x.close]));
      const bench0 = bench[0]?.close;
      const stratRet = nav!.map((n) => +(((n.value / nav0 - 1) * 100).toFixed(2)));
      const benchRet = navDates.map((d) =>
        benchMap.has(d) && bench0 ? +(((benchMap.get(d)! / bench0 - 1) * 100).toFixed(2)) : null,
      );
      return {
        animation: false,
        legend: { top: 0, left: 60, itemGap: 14, textStyle: { color: '#8a9099', fontSize: 11 }, data: ['策略收益', '沪深300'] },
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        grid: [{ left: 60, right: 20, top: 30, bottom: 44 }],
        xAxis: [{ type: 'category', data: navDates, axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' }, axisLine: { lineStyle: { color: '#e8eaed' } } }],
        yAxis: [{ type: 'value', axisLabel: { formatter: (v: number) => `${v}%`, color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f3' } } }],
        dataZoom: [
          { type: 'inside', start: 0, end: 100 },
          { type: 'slider', bottom: 10, height: 20, start: 0, end: 100 },
        ],
        series: [
          { name: '策略收益', type: 'line', data: stratRet, showSymbol: false, connectNulls: true, itemStyle: { color: '#111827' }, lineStyle: { width: 2, color: '#111827' }, z: 4 },
          { name: '沪深300', type: 'line', data: benchRet, showSymbol: false, connectNulls: true, itemStyle: { color: '#8a9099' }, lineStyle: { width: 2, color: '#8a9099', type: 'dashed' }, z: 3 },
        ],
      };
    }
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
    const close = p.map((d) => d.close ?? NaN);
    const vols = p.map((d) => ({
      value: d.vol ?? NaN,
      itemStyle: { color: (d.close ?? 0) >= (d.open ?? 0) ? UP : DOWN },
    }));

    // MA5/20/60 over close (left price axis).
    const ma = (n: number): (number | null)[] =>
      close.map((_, i) => {
        if (i < n - 1) return null;
        let s = 0;
        for (let k = i - n + 1; k <= i; k++) s += close[k];
        return Number.isFinite(s) ? +(s / n).toFixed(2) : null;
      });

    // Return curves (right %, base = first value in the window): 策略(nav) + 沪深300(bench), by date.
    const navMap = new Map((nav ?? []).map((x) => [x.date, x.value]));
    const nav0 = nav?.[0]?.value;
    const benchMap = new Map(bench.map((x) => [x.date, x.close]));
    const bench0 = bench[0]?.close;
    const ret = (map: Map<string, number>, base?: number): (number | null)[] =>
      dates.map((d) => (map.has(d) && base ? +(((map.get(d)! / base - 1) * 100).toFixed(2)) : null));
    const stratRet = ret(navMap, nav0);
    const benchRet = ret(benchMap, bench0);

    let lo = Infinity;
    for (const c of candle) if (Number.isFinite(c[2])) lo = Math.min(lo, c[2]);
    const dots = trades.map((t) => ({ value: [t.date, lo], side: t.side }));

    return {
      animation: false,
      legend: {
        top: 0,
        left: 60,
        itemGap: 14,
        textStyle: { color: '#8a9099', fontSize: 11 },
        data: ['MA5', 'MA20', 'MA60', '策略收益', '沪深300'],
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 60, right: 56, top: 30, height: '54%' },
        { left: 60, right: 56, top: '68%', height: '17%' },
      ],
      xAxis: [
        { type: 'category', data: dates, boundaryGap: true, axisLabel: { show: false }, axisLine: { lineStyle: { color: '#e8eaed' } } },
        { type: 'category', gridIndex: 1, data: dates, axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' }, axisLine: { lineStyle: { color: '#e8eaed' } } },
      ],
      yAxis: [
        { type: 'value', scale: true, position: 'left', axisLabel: { color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f3' } } },
        { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        { type: 'value', position: 'right', axisLabel: { formatter: (v: number) => `${v}%`, color: '#8a9099' }, splitLine: { show: false } },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 10, height: 20, start: 0, end: 100 },
      ],
      series: [
        { name: 'K线', type: 'candlestick', xAxisIndex: 0, yAxisIndex: 0, data: candle, itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } },
        { name: 'MA5', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma(5), showSymbol: false, itemStyle: { color: '#f0a020' }, lineStyle: { width: 1, color: '#f0a020' }, z: 3 },
        { name: 'MA20', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma(20), showSymbol: false, itemStyle: { color: '#3b82f6' }, lineStyle: { width: 1, color: '#3b82f6' }, z: 3 },
        { name: 'MA60', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: ma(60), showSymbol: false, itemStyle: { color: '#a855f7' }, lineStyle: { width: 1, color: '#a855f7' }, z: 3 },
        { name: '策略收益', type: 'line', xAxisIndex: 0, yAxisIndex: 2, data: stratRet, showSymbol: false, connectNulls: true, itemStyle: { color: '#111827' }, lineStyle: { width: 1.5, color: '#111827' }, z: 4 },
        { name: '沪深300', type: 'line', xAxisIndex: 0, yAxisIndex: 2, data: benchRet, showSymbol: false, connectNulls: true, itemStyle: { color: '#8a9099' }, lineStyle: { width: 1.5, color: '#8a9099', type: 'dashed' }, z: 4 },
        { name: '量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols },
        { name: '交易', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, data: dots, symbol: 'circle', symbolSize: 9, itemStyle: { color: DOT, borderColor: '#fff', borderWidth: 1 }, z: 10 },
      ],
    };
  }, [code, series, trades, nav, bench]);

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
          <button
            className={classNames('jx-td-chip', { 'jx-td-chip--active': code === ALL })}
            onClick={() => setCode(ALL)}
          >
            <span className="jx-td-chipName">全部</span>
            <span className="jx-td-chipCount">{tradeLog.length}</span>
          </button>
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
          {code === ALL
            ? '全部标的成交明细;下方为策略与沪深300收益率曲线。价格为不复权真实成交价'
            : '交易点(黄)在 K 线下方横轴;点它 → 右侧定位。价格为不复权真实成交价'}
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

      <div
        className={classNames('jx-td-list', { 'jx-td-list--all': code === ALL })}
        ref={listRef}
      >
        <div className="jx-td-head">
          {code === ALL && <span>标的</span>}
          <span>日期</span>
          <span>方向</span>
          <span className="jx-td-num">数量</span>
          <span className="jx-td-num">价格</span>
          <span className="jx-td-num">金额</span>
        </div>
        {trades.map((t, i) => (
          <div key={i} data-i={i} className={classNames('jx-td-row', { 'jx-td-row--active': i === active })}>
            {code === ALL && (
              <span className="jx-td-inst">
                <span className="jx-td-instName">{names[t.code] ?? t.code}</span>
                <span className="jx-td-instCode">{t.code}</span>
              </span>
            )}
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
