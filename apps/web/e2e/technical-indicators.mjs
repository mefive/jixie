import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { technicalIndicatorStrategyCode } from './technical-indicator-strategy.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
let strategyId = null;

page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-technical-indicators@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed with status ${loginStatus}`);
  }

  const seed = await page.evaluate(async (code) => {
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Use ADX, Bollinger Bands, RSI, MACD, and KDJ to score the trend.',
        start: '20240101',
        end: '20241231',
        initialCash: 1_000_000,
        code,
      }),
    });
    return { status: response.status, body: await response.json() };
  }, technicalIndicatorStrategyCode);
  if (seed.status !== 200 || !seed.body.id) {
    throw new Error(`strategy creation failed: ${JSON.stringify(seed)}`);
  }
  strategyId = seed.body.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });

  const backtestResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await page.getByRole('button', { name: '运行回测' }).click();
  const backtestResponse = await backtestResponsePromise;
  if (backtestResponse.status() !== 200) {
    throw new Error(
      `backtest submission failed: ${backtestResponse.status()} ${await backtestResponse.text()}`,
    );
  }

  const completion = await Promise.race([
    page
      .locator('.jx-lab-metricValue')
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => 'success'),
    page
      .getByText('回测失败：', { exact: false })
      .waitFor({ timeout: 120_000 })
      .then(() => 'failure'),
  ]);
  if (completion === 'failure') {
    const logText = await page
      .locator('.jx-logView')
      .textContent()
      .catch(() => '');
    throw new Error(`backtest failed in the UI: ${logText}`);
  }

  const saved = await page.evaluate(
    async (id) => await (await fetch(`/api/app/strategies/${id}`)).json(),
    strategyId,
  );
  if (saved.config.code !== technicalIndicatorStrategyCode || saved.lastResult?.trades <= 0) {
    throw new Error(`saved strategy/result mismatch: ${JSON.stringify(saved)}`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${JSON.stringify(pageErrors)}`);
  }

  const screenshotPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../acceptance/technical-indicators-e2e.png',
  );
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(
    `[technical-indicators] PASS id=${strategyId} trades=${saved.lastResult.trades} screenshot=${screenshotPath}`,
  );
} finally {
  if (strategyId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/strategies/${id}`, { method: 'DELETE' });
      }, strategyId)
      .catch(() => {});
  }
  await browser.close();
}
