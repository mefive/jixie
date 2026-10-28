import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let strategyId;
let documentId;

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await context.request.post(`${BASE}/api/auth/dev/login`, {
    data: { email: 'e2e@test.com' },
  });
  assert.equal(login.status(), 200);

  for (const code of ['IF.CFX', 'IF2609.CFX', 'AU.SHF']) {
    const response = await context.request.get(
      `${BASE}/api/app/market/instruments/future/${code}/series`,
    );
    assert.equal(response.status(), 400);
  }

  const config = {
    name: `e2e cash after futures retirement ${Date.now()}`,
    start: '20260615',
    end: '20260630',
    initialCash: 10_000_000,
    code: `export default defineStrategy({
      watch: ['600519.SH', '510300.SH'],
      onBar(ctx) {
        if (ctx.date !== '20260615') return;
        if ('futures' in ctx || 'future' in ctx || 'futureHistory' in ctx) throw new Error('Retired SDK leaked');
        if (ctx.portfolio.equity !== ctx.stock.equity) throw new Error('Capital split');
        ctx.stock.setTargetWeights({ '600519.SH': 0.5, '510300.SH': 0.5 });
      },
    });`,
  };
  const created = await context.request.post(`${BASE}/api/app/strategies`, { data: config });
  assert.equal(created.status(), 200);
  strategyId = (await created.json()).id;

  for (const field of [
    'futureCommissionRate',
    'futureCloseTodayRate',
    'futureSlippageTicks',
    'futureMarginRate',
  ]) {
    const rejected = await context.request.post(
      `${BASE}/api/app/strategies/${strategyId}/backtests`,
      {
        data: { ...config, cost: { [field]: 0 } },
      },
    );
    assert.equal(rejected.status(), 400, field);
  }

  await page.goto(`${BASE}/strategy?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-strategy-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '运行回测', exact: true }).click();
  await page.locator('.jx-strategy-metricValue').first().waitFor({ timeout: 120_000 });
  const saved = await (
    await context.request.get(`${BASE}/api/app/strategies/${strategyId}`)
  ).json();
  const result = saved.lastResult;
  assert.ok(result.tradeLog.some((trade) => trade.assetType === 'stock' && trade.side === 'buy'));
  assert.ok(result.tradeLog.some((trade) => trade.assetType === 'etf' && trade.side === 'buy'));
  assert.equal(result.sleeveNav[0].stockValue, config.initialCash);
  assert.ok(
    result.sleeveNav.every((point) => !('futureValue' in point) && !('futureMargin' in point)),
  );
  assert.deepEqual(result.allocationAnalysis.nav, result.nav);
  assert.equal(result.allocationAnalysis.reconciliation.reconciled, true);
  for (const [index, point] of result.sleeveNav.entries()) {
    assert.ok(Math.abs(point.stockValue - result.nav[index].value) < 1e-6);
  }
  assert.equal(await page.getByText('期货账户权益', { exact: true }).count(), 0);
  assert.equal(await page.getByText('期货保证金', { exact: true }).count(), 0);
  await page.screenshot({ path: `${SHOTS}futures-retirement-cash-zh.png`, fullPage: true });
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Reconciled to cash-account equity', { exact: true }).waitFor();
  assert.equal(await page.getByText('Futures sleeve', { exact: true }).count(), 0);
  await page.screenshot({ path: `${SHOTS}futures-retirement-cash-en.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}futures-retirement-cash-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
  const documentResponse = await context.request.post(`${BASE}/api/app/research/documents`, {
    data: { template: 'blank' },
  });
  assert.equal(documentResponse.status(), 200);
  const document = await documentResponse.json();
  documentId = document.id;
  await page.goto(`${BASE}/research?document=${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('research-document').waitFor();
  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.waitFor();
  await drawer.getByText('数据集', { exact: true }).click();
  for (const method of [
    'commodity_returns',
    'commodity_warehouse_receipts',
    'commodity_holdings',
    'futures_settlement',
  ]) {
    assert.equal(await page.getByTestId(`research-data-catalog-method-${method}`).count(), 0);
  }
  await drawer
    .getByRole('textbox', { name: '搜索股票、ETF、指数或数据读取方式' })
    .fill('000300.SH');
  await page.getByTestId('research-data-catalog-dataset-data.index_valuation:000300.SH').click();
  const configuration = page.getByTestId('research-data-catalog-dataset-config');
  await configuration.waitFor();
  assert.match(await configuration.innerText(), /data\.index_valuation\([\s\S]*000300\.SH/);
  await configuration.screenshot({ path: `${SHOTS}futures-retirement-index-snippet.png` });
  await page.getByTestId('research-data-catalog-insert').click();
  await page.getByText('已插入当前 Python Cell', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('[futures-retirement] cash, ETF, rejected costs and retired routes passed');
} finally {
  if (documentId) {
    await context.request
      .delete(`${BASE}/api/app/research/documents/${documentId}`)
      .catch(() => {});
  }
  if (strategyId) {
    await context.request.delete(`${BASE}/api/app/strategies/${strategyId}`).catch(() => {});
  }
  await browser.close();
}
