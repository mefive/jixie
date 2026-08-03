import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-market-state@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed with status ${loginStatus}`);
  }

  await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const weatherGroups = await page.locator('.jx-industryWeather-group').count();
  if (weatherGroups !== 6) {
    throw new Error(`expected 6 fixed industry weather groups, got ${weatherGroups}`);
  }
  const weatherCards = await page.locator('.jx-industryWeather-card').count();
  if (weatherCards !== 31) {
    throw new Error(`expected 31 industry weather cards, got ${weatherCards}`);
  }
  await page.screenshot({ path: `${SHOTS}market-weather-month.png` });

  const initialWeatherPeriod = await page
    .locator('.jx-industryWeather-periodReadout strong')
    .innerText();
  await page.getByRole('button', { name: '上一个周期' }).click();
  const previousWeatherPeriod = await page
    .locator('.jx-industryWeather-periodReadout strong')
    .innerText();
  if (previousWeatherPeriod === initialWeatherPeriod) {
    throw new Error('expected the weather timeline step to change the selected period');
  }
  await page.getByRole('button', { name: '下一个周期' }).click();

  const bankWeatherCard = page.locator('.jx-industryWeather-card').filter({ hasText: '银行' });
  if ((await bankWeatherCard.count()) !== 1) {
    throw new Error('expected one bank industry weather card');
  }
  await bankWeatherCard.click();
  await page.getByRole('dialog', { name: '银行' }).waitFor();
  await page.screenshot({ path: `${SHOTS}market-weather-history.png` });
  await page.getByRole('button', { name: '关闭' }).click();

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/market/industry-weather?frequency=quarter'),
    ),
    page.getByText('季', { exact: true }).click(),
  ]);
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const quarterPeriod = await page.locator('.jx-industryWeather-periodReadout strong').innerText();
  if (!quarterPeriod.includes('季度')) {
    throw new Error(`expected a quarterly weather period, got "${quarterPeriod}"`);
  }

  await page.locator('.jx-marketState-summary').waitFor();
  const metricCards = await page.locator('.jx-marketState-metricCard').count();
  if (metricCards !== 4) {
    throw new Error(`expected 4 market-state metric cards, got ${metricCards}`);
  }
  const marketHeaders = await page.locator('.jx-market-hero').count();
  if (marketHeaders !== 0) {
    throw new Error(`expected the market header to be removed, got ${marketHeaders}`);
  }
  const stylePairs = await page.locator('.jx-marketState-stylePair').count();
  if (stylePairs !== 3) {
    throw new Error(`expected 3 official style pairs, got ${stylePairs}`);
  }
  const officialStyleSources = await page
    .locator('.jx-marketState-styleBreadth')
    .filter({ hasText: '中证指数' })
    .count();
  if (officialStyleSources !== 3) {
    throw new Error(`expected 3 official style sources, got ${officialStyleSources}`);
  }
  await page.locator('.jx-marketState-industryMap canvas').waitFor({ timeout: 30_000 });
  const industryRows = await page.locator('.jx-marketState-industryTable tr[data-row-key]').count();
  if (industryRows !== 31) {
    throw new Error(`expected 31 Shenwan industry rows, got ${industryRows}`);
  }
  const valuationTags = await page.locator('.jx-marketState-valuationTag').count();
  if (valuationTags !== 31) {
    throw new Error(`expected 31 industry valuation tags, got ${valuationTags}`);
  }
  await page.screenshot({ path: `${SHOTS}market-dashboard-v1.png`, fullPage: true });
  await page.locator('.jx-marketState-industryMapCard').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}market-dashboard-map.png` });
  await page.locator('.jx-marketState-industryCard').scrollIntoViewIfNeeded();
  const firstIndustryRow = page.locator('.jx-marketState-industryTable tr[data-row-key]').first();
  await firstIndustryRow.click();
  if (!(await firstIndustryRow.getAttribute('class'))?.includes('industryRow--selected')) {
    throw new Error('expected the clicked industry row to become selected');
  }
  await page.screenshot({ path: `${SHOTS}market-dashboard-rotation.png` });

  await page.locator('.jx-marketState-scopeTrigger').click();
  const scopeOptions = await page.locator('.jx-marketState-scopeOption').count();
  if (scopeOptions !== 10) {
    throw new Error(`expected 10 market-state scopes, got ${scopeOptions}`);
  }
  await page.screenshot({ path: `${SHOTS}market-state-scope-picker.png` });

  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/market/state?scope=000300.SH')),
    page.locator('.jx-marketState-scopeOption').filter({ hasText: '沪深300' }).click(),
  ]);
  const indexCoverage = await page.locator('.jx-marketState-toolbarMeta').innerText();
  if (!indexCoverage.includes('覆盖 300 只')) {
    throw new Error(`expected CSI 300 coverage, got "${indexCoverage}"`);
  }

  const industryHeatCards = await page.locator('.jx-marketState-industryCard').count();
  if (industryHeatCards !== 1) {
    throw new Error(`expected one industry rotation table, got ${industryHeatCards}`);
  }

  await page.screenshot({ path: `${SHOTS}market-state-index-scope.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (mobileOverflow > 0) {
    throw new Error(`expected no mobile horizontal overflow, got ${mobileOverflow}px`);
  }
  await page.screenshot({ path: `${SHOTS}market-weather-mobile.png` });
  await page.locator('.jx-marketState-stylePair').first().waitFor();
  await page.screenshot({ path: `${SHOTS}market-dashboard-mobile.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.goto(`${BASE}/valuation`, { waitUntil: 'networkidle' });
  await page.locator('.jx-valuation-summary').waitFor();
  const valuationHeaders = await page.locator('.jx-valuation-hero').count();
  if (valuationHeaders !== 0) {
    throw new Error(`expected the valuation header to be removed, got ${valuationHeaders}`);
  }
  const valuationCards = await page.locator('.jx-valuation-metricCard').count();
  if (valuationCards !== 4) {
    throw new Error(`expected 4 valuation cards, got ${valuationCards}`);
  }
  await page.screenshot({ path: `${SHOTS}valuation.png`, fullPage: true });

  console.log(
    `[market-state-e2e] weatherGroups=${weatherGroups} weatherCards=${weatherCards} metrics=${metricCards} styles=${stylePairs} industries=${industryRows} scopes=${scopeOptions} headers=${marketHeaders + valuationHeaders} rotation=${industryHeatCards} valuation=${valuationCards}`,
  );
} finally {
  await browser.close();
}
