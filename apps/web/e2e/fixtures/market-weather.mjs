import {
  MARKET_WEATHER_INDEX_GROUPS,
  MARKET_WEATHER_INDUSTRY_GROUPS,
} from '../../../api/dist/src/market/registry/index-presets.js';
import {
  buildIndexWeatherSeries,
  buildIndustryWeatherSeries,
  industryWeatherToMarketWeather,
} from '../../../api/dist/src/market/state/compute.js';

/**
 * 使用真实气象聚合和固定行情，隔离市场页面浏览器回归。
 *
 * Isolate market-page browser regression with real weather aggregation and fixed prices.
 */
export async function installMarketWeatherFixture(context) {
  await context.route('**/api/**', (route) =>
    json(route, { error: 'Unexpected fixture request' }, 404),
  );
  await context.route('**/api/auth/dev/login', (route) => json(route, { success: true }));
  await context.route('**/api/auth/me', (route) =>
    json(route, { user: { id: 'market-fixture-user', email: 'market@test.com', name: null } }),
  );
  await context.route('**/api/maintenance/version', (route) =>
    json(route, { revision: 'market-weather-fixture' }),
  );
  await context.route('**/api/maintenance/status', (route) =>
    json(route, {
      active: false,
      running: false,
      phase: 'idle',
      runId: null,
      kind: null,
      targetDate: '20260331',
      revision: 1,
      coverage: [],
      stage: null,
      startedAt: null,
      heartbeatAt: null,
      error: null,
      retryAfterSeconds: 0,
    }),
  );
  await context.route('**/api/app/market/weather**', (route) => {
    const query = new URL(route.request().url()).searchParams;

    return json(route, weatherSeries(query.get('dimension'), query.get('frequency')));
  });
}

function weatherSeries(dimension, frequency) {
  const groups =
    dimension === 'industry'
      ? MARKET_WEATHER_INDUSTRY_GROUPS
      : MARKET_WEATHER_INDEX_GROUPS[dimension];
  const codes = groups.flatMap((group) => [...group.codes]);
  const dates = ['20260130', '20260227', '20260331'];
  const closes = dates.flatMap((tradeDate, month) =>
    codes.map((tsCode, index) => ({
      tsCode,
      tradeDate,
      close: 100 + month * ((index % 9) - 3),
      pe: 10 + month + index,
      pb: 1 + month / 10 + index / 10,
    })),
  );
  const indicators = dates.flatMap((tradeDate, month) =>
    codes.map((code, index) => ({
      indexCode: code,
      l1Code: code,
      l1Name: code === '801780.SI' ? '银行' : code,
      tradeDate,
      tradedCount: 100,
      return20: month / 100,
      excessReturn20: month / 200,
      positiveReturn20Ratio: 0.6,
      aboveMa20Ratio: 0.4 + month / 10,
      aboveMa60Ratio: 0.3 + month / 10,
      floatWeightedTurnoverRate: 1 + index / 10 + month / 10,
      amountShare: 0.03,
      topFiveAmountShare: 0.2,
    })),
  );

  if (dimension === 'industry') {
    return industryWeatherToMarketWeather(
      buildIndustryWeatherSeries(indicators, closes, frequency),
      groups,
    );
  }

  return buildIndexWeatherSeries(
    dimension,
    groups,
    closes,
    indicators,
    closes.map((row) => ({ ...row, peTtm: row.pe, source: 'official' })),
    codes.map((tsCode) => ({ tsCode, name: tsCode })),
    frequency,
  );
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
