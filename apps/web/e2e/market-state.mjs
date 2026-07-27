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
  await page.locator('.jx-marketState-summary').waitFor();
  const metricCards = await page.locator('.jx-marketState-metricCard').count();
  if (metricCards !== 4) {
    throw new Error(`expected 4 market-state metric cards, got ${metricCards}`);
  }
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
  await page.locator('.jx-valuation-heroStatusLabel').filter({ hasText: '沪深300' }).waitFor();
  const indexCoverage = await page.locator('.jx-valuation-heroStatusMeta').innerText();
  if (!indexCoverage.includes('覆盖 300 只')) {
    throw new Error(`expected CSI 300 coverage, got "${indexCoverage}"`);
  }

  const industryRows = await page
    .locator('.jx-marketState-industryTable tbody tr.ant-table-row')
    .count();
  if (industryRows !== 31) {
    throw new Error(`expected 31 industry rows, got ${industryRows}`);
  }

  await page.screenshot({ path: `${SHOTS}market-state-index-scope.png` });
  await page.locator('.jx-marketState-industryCard').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}market-state-industries.png` });

  await page.locator('.jx-valuation-sectionHead').scrollIntoViewIfNeeded();
  await page.locator('.jx-valuation-summary').waitFor();
  const valuationCards = await page.locator('.jx-valuation-metricCard').count();
  if (valuationCards !== 4) {
    throw new Error(`expected 4 valuation cards, got ${valuationCards}`);
  }

  console.log(
    `[market-state-e2e] metrics=${metricCards} scopes=${scopeOptions} industries=${industryRows} valuation=${valuationCards}`,
  );
} finally {
  await browser.close();
}
