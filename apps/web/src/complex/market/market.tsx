import { Alert, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { complex } from './complex';
import { MarketStateOverview } from './market-state-overview';
import '@src/complex/valuation/valuation.css';

export const Market = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('valuation');
  const marketState = store.marketStateLoader.result;

  return (
    <div className="jx-market">
      <main className="jx-market-body">
        {store.marketStateLoader.error ? (
          <Alert
            type="error"
            showIcon
            message={t('marketState.loadFailed')}
            description={store.marketStateLoader.errorObject?.message}
          />
        ) : marketState ? (
          <MarketStateOverview
            snapshot={marketState}
            loading={store.marketStateLoader.loading}
            weatherSeries={store.industryWeatherLoader.result}
            weatherLoading={store.industryWeatherLoader.loading}
            weatherFrequency={store.weatherFrequency}
            onScopeChange={(scope) => store.setMarketScope(scope)}
            onWeatherFrequencyChange={(frequency) => store.setWeatherFrequency(frequency)}
          />
        ) : (
          <DashboardSkeleton />
        )}
      </main>
    </div>
  );
}, 'Market');

// —— Subcomponents / helpers ——

function DashboardSkeleton() {
  return (
    <div className="jx-market-dashboardSkeleton">
      <Skeleton active paragraph={{ rows: 3 }} />
      <Skeleton active paragraph={{ rows: 9 }} />
    </div>
  );
}
