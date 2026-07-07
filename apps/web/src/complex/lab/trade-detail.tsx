import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Spin } from 'antd';
import type { StockSeries, TradeRecord } from '@jixie/shared';
import { fetchStockSeries, fetchNames, fetchIndexSeries } from '@src/api/client';
import { EChart, type ECOption } from '@src/components/echart';
import './trade-detail.css';

const UP = '#e8463b'; // A-share red up
const DOWN = '#2f9e5b'; // green down
const DOT = '#f0a020'; // Futu-style dividend yellow dot — trade markers on the axis

/**
 * Trade detail — the traded stock's full candlestick + volume, with each trade as a yellow dot pinned to the bottom
 * axis (Futu-style, not on the price line). Click a dot to scroll the right list to that fill. Multi-stock
 * strategies get a code picker (default the most-traded). Prices are unadjusted (raw) — the real trade prices
 * shown in the list (ex-dividend/ex-rights gaps are real); the engine accounts internally in after-adjustment (hfq) prices.
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
  nav?: { date: string; value: number }[]; // strategy equity curve → return curve (right axis)
}) {
  const { t } = useTranslation('lab');
  const codes = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of tradeLog) {
      c.set(t.code, (c.get(t.code) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => b[1] - a[1]); // [code, count] by count desc
  }, [tradeLog]);

  const [code, setCode] = useState(codes[0]?.[0] ?? ''); // instrument whose candlestick shows (always a real code)
  const [showAll, setShowAll] = useState(false); // All: list + trade dots span every instrument (candlestick unchanged)
  const [names, setNames] = useState<Record<string, string>>({});
  const [series, setSeries] = useState<StockSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Names for the traded-instruments queue (bulk, once).
  useEffect(() => {
    if (!codes.length) {
      return;
    }
    fetchNames(codes.map((c) => c[0]))
      .then(setNames)
      .catch(() => {});
  }, [codes]);

  // CSI 300 daily close over the window → benchmark return curve (right axis).
  const [bench, setBench] = useState<{ date: string; close: number }[]>([]);
  useEffect(() => {
    fetchIndexSeries('000300.SH', start, end)
      .then((r) => setBench(r.points))
      .catch(() => setBench([]));
  }, [start, end]);

  // All → every instrument's fills, sorted by date (drives both the list and the trade dots); else
  // just the shown instrument's. The candlestick/MA come from `code` regardless.
  const trades = useMemo(
    () =>
      showAll
        ? [...tradeLog].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        : tradeLog.filter((t) => t.code === code),
    [tradeLog, code, showAll],
  );

  useEffect(() => {
    if (!code) {
      return;
    }
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
    if (!series) {
      return null;
    }
    const p = series.points;
    const dates = p.map((d) => d.date);
    // Unadjusted (raw) prices — so the chart's price level matches the real fill prices shown in the list
    // (ex-dividend/ex-rights gaps are real). The trade dots are pinned to the axis, so they don't depend on this choice.
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
        if (i < n - 1) {
          return null;
        }
        let s = 0;
        for (let k = i - n + 1; k <= i; k++) {
          s += close[k];
        }
        return Number.isFinite(s) ? +(s / n).toFixed(2) : null;
      });

    // Return curves (right %, base = first value in the window): strategy (nav) + CSI 300 (bench), by date.
    const navMap = new Map((nav ?? []).map((x) => [x.date, x.value]));
    const nav0 = nav?.[0]?.value;
    const benchMap = new Map(bench.map((x) => [x.date, x.close]));
    const bench0 = bench[0]?.close;
    const ret = (map: Map<string, number>, base?: number): (number | null)[] =>
      dates.map((d) => (map.has(d) && base ? +((map.get(d)! / base - 1) * 100).toFixed(2) : null));
    const stratRet = ret(navMap, nav0);
    const benchRet = ret(benchMap, bench0);

    let lo = Infinity;
    for (const c of candle) {
      if (Number.isFinite(c[2])) {
        lo = Math.min(lo, c[2]);
      }
    }
    const dots = trades.map((t) => ({ value: [t.date, lo], side: t.side }));

    return {
      animation: false,
      legend: {
        top: 0,
        left: 60,
        itemGap: 14,
        textStyle: { color: '#8a9099', fontSize: 11 },
        data: ['MA5', 'MA20', 'MA60', t('seriesStrategyReturn'), t('seriesBenchmark')],
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: [
        { left: 60, right: 56, top: 30, height: '54%' },
        { left: 60, right: 56, top: '68%', height: '17%' },
      ],
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: true,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: '#e8eaed' } },
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          axisLabel: { formatter: (d: string) => d.slice(0, 6), color: '#8a9099' },
          axisLine: { lineStyle: { color: '#e8eaed' } },
        },
      ],
      yAxis: [
        {
          type: 'value',
          scale: true,
          position: 'left',
          axisLabel: { color: '#8a9099' },
          splitLine: { lineStyle: { color: '#f0f1f3' } },
        },
        { gridIndex: 1, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: 'value',
          position: 'right',
          axisLabel: { formatter: (v: number) => `${v}%`, color: '#8a9099' },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 },
        { type: 'slider', xAxisIndex: [0, 1], bottom: 10, height: 20, start: 0, end: 100 },
      ],
      series: [
        {
          name: t('seriesKline'),
          type: 'candlestick',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: candle,
          itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN },
        },
        {
          name: 'MA5',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ma(5),
          showSymbol: false,
          itemStyle: { color: '#f0a020' },
          lineStyle: { width: 1, color: '#f0a020' },
          z: 3,
        },
        {
          name: 'MA20',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ma(20),
          showSymbol: false,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 1, color: '#3b82f6' },
          z: 3,
        },
        {
          name: 'MA60',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: ma(60),
          showSymbol: false,
          itemStyle: { color: '#a855f7' },
          lineStyle: { width: 1, color: '#a855f7' },
          z: 3,
        },
        {
          name: t('seriesStrategyReturn'),
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 2,
          data: stratRet,
          showSymbol: false,
          connectNulls: true,
          itemStyle: { color: '#111827' },
          lineStyle: { width: 1.5, color: '#111827' },
          z: 4,
        },
        {
          name: t('seriesBenchmark'),
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 2,
          data: benchRet,
          showSymbol: false,
          connectNulls: true,
          itemStyle: { color: '#8a9099' },
          lineStyle: { width: 1.5, color: '#8a9099', type: 'dashed' },
          z: 4,
        },
        { name: t('seriesVolume'), type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: vols },
        {
          name: t('seriesTrade'),
          type: 'scatter',
          xAxisIndex: 0,
          yAxisIndex: 0,
          data: dots,
          symbol: 'circle',
          symbolSize: 9,
          itemStyle: { color: DOT, borderColor: '#fff', borderWidth: 1 },
          z: 10,
        },
      ],
    };
  }, [series, trades, nav, bench, t]);

  const pick = (date: string) => {
    const idx = trades.findIndex((t) => t.date === date);
    if (idx < 0) {
      return;
    }
    setActive(idx);
    listRef.current
      ?.querySelector(`[data-i="${idx}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div className="jx-td">
      <div className="jx-td-chart">
        <div className="jx-td-queue">
          <button
            className={classNames('jx-td-chip', { 'jx-td-chip--active': showAll })}
            onClick={() => setShowAll(true)}
          >
            <span className="jx-td-chipName">{t('tdAll')}</span>
            <span className="jx-td-chipCount">{tradeLog.length}</span>
          </button>
          {codes.map(([c, n]) => (
            <button
              key={c}
              className={classNames('jx-td-chip', { 'jx-td-chip--active': !showAll && c === code })}
              onClick={() => {
                setCode(c);
                setShowAll(false);
              }}
              title={`${names[c] ?? ''} ${c}`}
            >
              <span className="jx-td-chipName">{names[c] ?? c}</span>
              <span className="jx-td-chipCode">{c}</span>
              <span className="jx-td-chipCount">{n}</span>
            </button>
          ))}
        </div>
        <div className="jx-td-hint">{showAll ? t('tdHintAll') : t('tdHintSingle')}</div>
        {loading || !option ? (
          <div className="jx-td-loading">{loading ? <Spin /> : t('tdNoData')}</div>
        ) : (
          <EChart
            option={option}
            className="jx-td-canvas"
            onClick={(p: any) => {
              if (p.seriesName === t('seriesTrade')) {
                pick(p.value[0]);
              }
            }}
          />
        )}
      </div>

      <div className={classNames('jx-td-list', { 'jx-td-list--all': showAll })} ref={listRef}>
        <div className="jx-td-head">
          {showAll && <span>{t('tdColInstrument')}</span>}
          <span>{t('tdColDate')}</span>
          <span>{t('tdColSide')}</span>
          <span className="jx-td-num">{t('tdColShares')}</span>
          <span className="jx-td-num">{t('tdColPrice')}</span>
          <span className="jx-td-num">{t('tdColAmount')}</span>
        </div>
        {trades.map((trade, i) => (
          <div
            key={i}
            data-i={i}
            className={classNames('jx-td-row', { 'jx-td-row--active': i === active })}
          >
            {showAll && (
              <span className="jx-td-inst">
                <span className="jx-td-instName">{names[trade.code] ?? trade.code}</span>
                <span className="jx-td-instCode">{trade.code}</span>
              </span>
            )}
            <span>{fmtDate(trade.date)}</span>
            <span className={trade.side === 'buy' ? 'text-up' : 'text-down'}>
              {trade.side === 'buy' ? t('sideBuy') : t('sideSell')}
            </span>
            <span className="jx-td-num">
              {Math.round(trade.realShares ?? trade.shares).toLocaleString()}
            </span>
            <span className="jx-td-num">{(trade.realPrice ?? trade.price).toFixed(2)}</span>
            <span className="jx-td-num">
              {(trade.amount / 10000).toFixed(1)}
              {t('unitWan')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtDate(d: string): string {
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}
