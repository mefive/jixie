import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
let strategyId = '';

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  strategyId = await page.evaluate(async () => {
    const code = `export default defineStrategy({
  name: 'e2e 股票期货混合对冲',
  watch: ['600519.SH'],
  accounts: {
    stock: { cashWeight: 0.8 },
    futures: { cashWeight: 0.2 },
  },
  onBar(ctx) {
    if (ctx.date !== '20260615') return;
    ctx.stock.setTargetWeights({ '600519.SH': 1 });
    ctx.futures.hedgeStock('IF.CFX', 1);
  },
});`;
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e 股票期货混合对冲',
        start: '20260615',
        end: '20260630',
        initialCash: 10_000_000,
        code,
      }),
    });
    const strategy = await response.json();
    if (!response.ok) {
      throw new Error(`strategy seed failed: ${JSON.stringify(strategy)}`);
    }
    return strategy.id;
  });

  await page.goto(`${BASE}/strategy?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-strategy-code .monaco-editor').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '运行回测' }).click();
  await page
    .locator('.jx-strategy-metric', { hasText: '股票账户权益' })
    .waitFor({ timeout: 120_000 });
  await page.locator('.jx-strategy-result canvas').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const requiredMetrics = ['股票账户权益', '期货账户权益', '期货保证金', '净敞口'];
  for (const label of requiredMetrics) {
    const count = await page.locator('.jx-strategy-metric', { hasText: label }).count();
    if (count !== 1) {
      throw new Error(`expected one ${label} metric, got ${count}`);
    }
  }

  const saved = await page.evaluate(async (id) => {
    const response = await fetch(`/api/app/strategies/${id}`);
    if (!response.ok) {
      throw new Error(`Cannot read completed strategy: ${response.status}`);
    }
    return response.json();
  }, strategyId);
  const result = saved.lastResult;
  assert.ok(result.tradeLog.some((trade) => trade.assetType === 'future' && trade.side === 'sell'));
  assert.ok(result.tradeLog.some((trade) => trade.assetType !== 'future' && trade.side === 'buy'));
  assert.equal(result.sleeveNav[0].stockValue, 8_000_000);
  assert.equal(result.sleeveNav[0].futureValue, 2_000_000);
  assert.deepEqual(
    result.nav.map((point) => point.date),
    result.sleeveNav.map((point) => point.date),
  );
  for (const [index, point] of result.sleeveNav.entries()) {
    // Persisted JSON and addition can differ below a millionth of a yuan.
    assert.ok(Math.abs(result.nav[index].value - (point.stockValue + point.futureValue)) < 1e-6);
  }
  assert.equal(result.allocationAnalysis.scope, 'cash_account');
  assert.equal(result.allocationAnalysis.reconciliation.reconciled, true);
  assert.deepEqual(
    result.allocationAnalysis.nav,
    result.sleeveNav.map((point) => ({
      date: point.date,
      value: point.stockValue,
    })),
  );

  const path = `${SHOTS}mixed-futures-result.png`;
  await page.screenshot({ path, fullPage: true });
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Futures sleeve', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}mixed-futures-result-en.png`, fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log(`[e2e] mixed futures screenshot: ${path}`);
} finally {
  if (strategyId) {
    await page
      .evaluate((id) => fetch(`/api/app/strategies/${id}`, { method: 'DELETE' }), strategyId)
      .catch(() => {});
  }
  await browser.close();
}
