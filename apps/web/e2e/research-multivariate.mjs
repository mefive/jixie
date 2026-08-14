import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const plan = {
  version: 1,
  question: {
    version: 1,
    kind: 'multivariate_time_series_relationship',
    text: '控制美国 headline CPI 后，美国 10 年实际利率变化是否与沪金主力连续月收益负相关？',
    hypothesis: {
      estimand: 'partial_regression_coefficient',
      focalPredictor: 'realYield',
      direction: 'negative',
      nullValue: 0,
    },
  },
  start: '20150101',
  end: '20260731',
  inputs: [
    {
      type: 'series',
      id: 'gold',
      source: { kind: 'instrument', assetType: 'future', id: 'AU.SHF' },
      measure: 'market.adjusted_close',
      transform: 'simple_return',
      label: '沪金主力连续',
    },
    {
      type: 'series',
      id: 'realYield',
      source: {
        kind: 'yield_curve',
        curveCode: 'us_treasury_real',
        curveType: 'par',
        termYears: 10,
      },
      measure: 'rates.yield_pct',
      transform: 'difference',
      label: '美国 10 年实际利率变化',
    },
    {
      type: 'series',
      id: 'headlineCpi',
      source: { kind: 'macro', seriesKey: 'us_cpi_u_all_items_nsa' },
      measure: 'macro.observation',
      transform: 'year_over_year',
      label: '美国 headline CPI 同比',
    },
  ],
  alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
  protocol: {
    kind: 'multivariate_time_series_relationship',
    version: 1,
    outcome: 'gold',
    predictors: [
      { input: 'realYield', role: 'focal', lag: 0 },
      { input: 'headlineCpi', role: 'control', lag: 0 },
    ],
    inference: { kind: 'newey_west', lag: 'automatic' },
    rollingWindow: 36,
  },
  outputs: [
    { kind: 'summary_table' },
    { kind: 'coefficient_plot' },
    { kind: 'partial_regression' },
    { kind: 'correlation_matrix' },
    { kind: 'rolling_coefficients' },
    { kind: 'conclusion' },
    { kind: 'formula' },
    { kind: 'python_example' },
    { kind: 'documentation' },
  ],
};

const title = '黄金、实际利率与通胀的多变量关系';
const now = new Date().toISOString();
const conversation = {
  id: 'e2e-multivariate-research',
  title,
  preview: 'MultivariateTimeSeries V1',
  createdAt: now,
  updatedAt: now,
};
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-multivariate@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  const actual = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, plan);
  if (
    actual.result.kind !== 'multivariate_time_series_relationship' ||
    actual.result.observations < 36 ||
    actual.result.coefficients.length !== 2 ||
    actual.result.partialRegression.length !== actual.result.observations ||
    actual.result.predictorCorrelations.length !== 4 ||
    actual.result.rolling.length < 1 ||
    actual.coverage.length !== 3 ||
    actual.fingerprints?.data.inputs.length !== 3 ||
    !actual.diagnostics.some((item) => item.code === 'macro_latest_value_backfill')
  ) {
    throw new Error(`invalid multivariate result: ${JSON.stringify(actual)}`);
  }

  await page.route('**/api/app/research/conversations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([conversation]),
    }),
  );
  await page.route('**/api/app/agent/conversations/e2e-multivariate-research/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: '实际利率是预先指定的核心变量，headline CPI 是控制变量；正式结论不根据显著性更换研究角色。',
              },
              { type: 'research', title, run: actual },
            ],
          },
        ],
      }),
    }),
  );
  let rerunPlan = null;
  await page.route('**/api/app/research/run', (route) => {
    rerunPlan = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...actual, plan: rerunPlan }),
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'networkidle' });
  await page.getByText(title, { exact: true }).click();
  await page.locator('.jx-researchResult-conclusion').waitFor({ timeout: 20_000 });
  await page.getByRole('columnheader', { name: '偏 R²' }).waitFor();
  if ((await page.locator('.jx-researchResult-tabs canvas').count()) < 1) {
    throw new Error('coefficient chart did not render');
  }
  await page.screenshot({
    path: `${SHOTS}research-multivariate-coefficients-zh.png`,
    fullPage: true,
  });
  await page.getByRole('tabpanel', { name: '系数与效应量' }).screenshot({
    path: `${SHOTS}research-multivariate-coefficients-panel-zh.png`,
  });

  await page.getByText('控制变量后的关系', { exact: true }).click();
  await page
    .getByRole('tabpanel', { name: '控制变量后的关系' })
    .locator('canvas')
    .first()
    .waitFor();
  await page.screenshot({
    path: `${SHOTS}research-multivariate-partial-zh.png`,
    fullPage: true,
  });
  await page.getByRole('tabpanel', { name: '控制变量后的关系' }).screenshot({
    path: `${SHOTS}research-multivariate-partial-panel-zh.png`,
  });
  await page.getByText('解释变量相关矩阵', { exact: true }).click();
  await page
    .getByRole('tabpanel', { name: '解释变量相关矩阵' })
    .locator('canvas')
    .first()
    .waitFor();
  await page.screenshot({
    path: `${SHOTS}research-multivariate-correlation-zh.png`,
    fullPage: true,
  });
  await page.getByRole('tabpanel', { name: '解释变量相关矩阵' }).screenshot({
    path: `${SHOTS}research-multivariate-correlation-panel-zh.png`,
  });

  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-researchResult-controls .ant-input-number input').first().fill('1');
  await page.screenshot({
    path: `${SHOTS}research-multivariate-controls-zh.png`,
    fullPage: true,
  });
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-researchResult-controls'));
  if (rerunPlan?.protocol?.predictors?.[0]?.lag !== 1) {
    throw new Error(`multivariate rerun did not preserve focal lag: ${JSON.stringify(rerunPlan)}`);
  }

  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Method & reproduction', { exact: true }).click();
  await page.getByText('Multivariate linear model', { exact: true }).waitFor();
  await page.getByText('Python example', { exact: true }).scrollIntoViewIfNeeded();
  await page.locator('.jx-researchResult-code').getByText('import pandas as pd').waitFor();
  await page.screenshot({
    path: `${SHOTS}research-multivariate-method-en.png`,
    fullPage: true,
  });
  console.log(
    `[research-multivariate-e2e] ${actual.result.observations} common observations, ${actual.result.rolling.length} rolling windows, deterministic rerun, charts, diagnostics, formulae, and Python teaching code passed`,
  );
} finally {
  await browser.close();
}
