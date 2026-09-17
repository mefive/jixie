import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const unexpectedRequests = [];
const strategyId = 'navigation-fixture';
const config = {
  name: 'Navigation fixture',
  start: '20240101',
  end: '20240331',
  initialCash: 100000,
  language: 'typescript',
  code: "export default defineStrategy({ name: 'Navigation fixture', onBar() {} });",
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body;
    if (pathname === '/api/auth/me') {
      body = { user: { id: 'navigation-user', email: 'navigation@test.com' } };
    } else if (pathname === '/api/maintenance/status') {
      body = { active: false, retryAfterSeconds: 0 };
    } else if (pathname === '/api/app/strategies') {
      body = [];
    } else if (pathname === `/api/app/strategies/${strategyId}`) {
      body = { id: strategyId, config, messages: [], lastResult: null };
    } else if (pathname === '/api/app/agent/turns/active') {
      body = { turnId: null };
    } else if (/\/(backtest-jobs|scan-jobs)\/active$/.test(pathname)) {
      body = null;
    } else if (
      /\/(backtest-reports|scan-reports|deployments)$/.test(pathname) ||
      pathname === '/api/app/factors/catalog'
    ) {
      body = [];
    } else {
      unexpectedRequests.push(pathname);
      return route.fulfill({
        status: 404,
        json: { error: { message: 'Unexpected fixture request' } },
      });
    }
    await route.fulfill({ json: body });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/strategy?new=1`);
  await page.locator('.jx-strategy-hero').waitFor();
  await page.getByRole('link', { name: '策略', exact: true }).waitFor();

  // The redirect preserves the entire URL before the workbench handles known parameters.
  const query = '?new=1&factorKey=missing-factor&extra=a%2Fb&extra=c';
  await page.goto(`${base}/lab${query}#retained`);
  await page.waitForURL(`${base}/strategy${query}#retained`);
  await page.locator('.jx-strategy-hero').waitFor();
  await page.screenshot({ path: `${screenshots}strategy-navigation-zh.png`, fullPage: true });

  await page.evaluate((id) => {
    localStorage.removeItem('jx-strategy-recents');
    localStorage.setItem('jx-lab-recents', JSON.stringify([id]));
  }, strategyId);
  await page.goto(`${base}/lab`);
  await page.waitForURL(`${base}/strategy?id=${strategyId}`);
  await page.locator('.jx-strategy-code .monaco-editor').waitFor();
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem('jx-strategy-recents'))),
    [strategyId],
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('jx-lab-recents')), null);

  await page.goto(`${base}/lab?id=${strategyId}&report=legacy-report&extra=keep#report`);
  await page.waitForURL(`${base}/strategy?id=${strategyId}&report=legacy-report&extra=keep#report`);
  await page.locator('.jx-strategy-code .monaco-editor').waitFor();

  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('link', { name: 'Strategy', exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}strategy-navigation-en.png`, fullPage: true });
  await page.getByRole('link', { name: 'Strategy', exact: true }).click();
  await page.waitForURL(`${base}/strategy`);
  await page.locator('.jx-strategy-code .monaco-editor').waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log('Strategy routes, legacy redirects, visits and bilingual navigation passed.');
} finally {
  await browser.close();
}
