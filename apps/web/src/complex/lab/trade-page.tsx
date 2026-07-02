import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BacktestSummary } from '@jixie/shared';
import { getStrategy } from '@src/api/client';
import { TopNav } from '@src/components/top-nav';
import './trade-page.css';

const TradeDetail = lazy(() => import('./trade-detail'));
type Strategy = Awaited<ReturnType<typeof getStrategy>>;

/** Standalone 交易详情 page (opened from the modal's 页面打开 button, `/trades?id=<strategyId>`). Loads
 * the strategy's last backtest result and renders the same K线 + trade list, full-window. */
export default function TradePage() {
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setError('缺少策略 id');
      return;
    }
    getStrategy(id)
      .then(setStrategy)
      .catch(() => setError('策略不存在或无权访问'));
  }, [id]);

  const r = strategy?.lastResult as BacktestSummary | null | undefined;
  return (
    <div className="jx-tp">
      <TopNav />
      <main className="jx-tp-body">
        <div className="jx-tp-head">
          <h1 className="jx-tp-title">交易详情</h1>
          {strategy && (
            <span className="jx-tp-sub">
              {strategy.name}
              {r ? ` · ${r.trades.toLocaleString()} 笔` : ''}
            </span>
          )}
        </div>
        {error ? (
          <div className="jx-tp-empty jx-tp-empty--error">{error}</div>
        ) : !strategy ? (
          <div className="jx-tp-empty">加载中……</div>
        ) : !r?.tradeLog?.length ? (
          <div className="jx-tp-empty">该策略暂无交易记录</div>
        ) : (
          <Suspense fallback={<div className="jx-tp-empty">加载图表……</div>}>
            <TradeDetail tradeLog={r.tradeLog} start={r.start} end={r.end} nav={r.nav} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
