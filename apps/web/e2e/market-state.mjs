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
  await assertWeatherDimension(page, '申万行业', 6, 31);
  await page.screenshot({ path: `${SHOTS}market-weather-industry.png`, fullPage: true });

  const initialPeriod = await page.locator('.jx-industryWeather-periodReadout strong').innerText();
  await page.getByRole('button', { name: '上一个周期' }).click();
  const previousPeriod = await page.locator('.jx-industryWeather-periodReadout strong').innerText();
  if (previousPeriod === initialPeriod) {
    throw new Error('expected the weather timeline step to change the selected period');
  }
  await page.getByRole('button', { name: '下一个周期' }).click();

  const bankCard = page.locator('.jx-industryWeather-card').filter({ hasText: '银行' });
  await bankCard.click();
  await page.getByRole('dialog', { name: '银行' }).waitFor();
  await page.screenshot({ path: `${SHOTS}market-weather-history.png` });
  await page.getByRole('button', { name: '关闭' }).click();

  await switchDimension(page, '规模宽基', 'scale', 4, 10);
  await page.screenshot({ path: `${SHOTS}market-weather-scale.png`, fullPage: true });
  await switchDimension(page, '市场板块', 'board', 3, 8);
  await page.screenshot({ path: `${SHOTS}market-weather-board.png`, fullPage: true });
  await switchDimension(page, '风格策略', 'style', 7, 16);
  await page.screenshot({ path: `${SHOTS}market-weather-style.png`, fullPage: true });

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('/market/weather?dimension=style&frequency=quarter'),
    ),
    page.getByText('季', { exact: true }).click(),
  ]);
  const quarterPeriod = await page.locator('.jx-industryWeather-periodReadout strong').innerText();
  if (!quarterPeriod.includes('季度')) {
    throw new Error(`expected a quarterly weather period, got "${quarterPeriod}"`);
  }

  const legacyPanels = await page
    .locator('.jx-marketState-summary, .jx-marketState-industryMap, .jx-marketState-industryTable')
    .count();
  if (legacyPanels !== 0) {
    throw new Error(`expected a card-only market page, got ${legacyPanels} legacy panels`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (mobileOverflow > 0) {
    throw new Error(`expected no mobile horizontal overflow, got ${mobileOverflow}px`);
  }
  await page.screenshot({ path: `${SHOTS}market-weather-mobile.png`, fullPage: true });

  console.log(
    '[market-state-e2e] four card dimensions, timeline, drawer, and mobile layout passed',
  );
} finally {
  await browser.close();
}

async function switchDimension(page, label, dimension, groups, cards) {
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes(`/market/weather?dimension=${dimension}&frequency=month`),
    ),
    page.getByText(label, { exact: true }).click(),
  ]);
  await assertWeatherDimension(page, label, groups, cards);
}

async function assertWeatherDimension(page, label, expectedGroups, expectedCards) {
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const groups = await page.locator('.jx-industryWeather-group').count();
  const cards = await page.locator('.jx-industryWeather-card').count();
  if (groups !== expectedGroups || cards !== expectedCards) {
    throw new Error(
      `${label}: expected ${expectedGroups} groups/${expectedCards} cards, got ${groups}/${cards}`,
    );
  }
}
