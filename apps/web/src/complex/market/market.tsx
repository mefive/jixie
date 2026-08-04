import { Alert, Skeleton } from 'antd';
import { useTranslation } from 'react-i18next';
import { complex } from './complex';
import { MarketWeatherMap } from './industry-weather-map';
import './market.css';

export const Market = complex.component(() => {
  const store = complex.useStore();
  const { t } = useTranslation('valuation');
  const weatherSeries = store.weatherLoader.result;

  return (
    <div className="jx-market">
      <main className="jx-market-body">
        {store.weatherLoader.error ? (
          <Alert
            type="error"
            showIcon
            message={t('marketState.loadFailed')}
            description={store.weatherLoader.errorObject?.message}
          />
        ) : weatherSeries ? (
          <MarketWeatherMap
            series={weatherSeries}
            loading={store.weatherLoader.loading}
            dimension={store.weatherDimension}
            frequency={store.weatherFrequency}
            onDimensionChange={(dimension) => store.setWeatherDimension(dimension)}
            onFrequencyChange={(frequency) => store.setWeatherFrequency(frequency)}
          />
        ) : (
          <DashboardSkeleton />
        )}
      </main>
    </div>
  );
}, 'Market');

// Subcomponents and helpers.

function DashboardSkeleton() {
  return (
    <div className="jx-market-dashboardSkeleton">
      <Skeleton active paragraph={{ rows: 3 }} />
      <Skeleton active paragraph={{ rows: 9 }} />
    </div>
  );
}
