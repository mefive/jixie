import { lazy, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { BacktestSummary } from '@jixie/shared';
import { getStrategy } from '@src/api/client';
import './trade-page.css';

const TradeDetail = lazy(() => import('./trade-detail'));
type Strategy = Awaited<ReturnType<typeof getStrategy>>;

/** Standalone trade-detail page (opened from the modal's "open in page" button, `/trades?id=<strategyId>`). Loads
 * the strategy's last backtest result and renders the same candlestick + trade list, full-window. */
export default function TradePage() {
  const { t } = useTranslation('lab');
  const [sp] = useSearchParams();
  const id = sp.get('id') ?? '';
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) {
      setError(t('tpMissingId'));
      return;
    }
    getStrategy(id)
      .then(setStrategy)
      .catch(() => setError(t('tpNotFound')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const r = strategy?.lastResult as BacktestSummary | null | undefined;
  return (
    <div className="jx-tp">
      <main className="jx-tp-body">
        <div className="jx-tp-head">
          <h1 className="jx-tp-title">{t('tpTitle')}</h1>
          {strategy && (
            <span className="jx-tp-sub">
              {strategy.name}
              {r ? ` · ${t('tradesUnit', { count: r.trades.toLocaleString() })}` : ''}
            </span>
          )}
        </div>
        {error ? (
          <div className="jx-tp-empty jx-tp-empty--error">{error}</div>
        ) : !strategy ? (
          <div className="jx-tp-empty">{t('tpLoading')}</div>
        ) : !r?.tradeLog?.length ? (
          <div className="jx-tp-empty">{t('tpNoTrades')}</div>
        ) : (
          <Suspense fallback={<div className="jx-tp-empty">{t('tpLoadingChart')}</div>}>
            <TradeDetail tradeLog={r.tradeLog} start={r.start} end={r.end} nav={r.nav} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
