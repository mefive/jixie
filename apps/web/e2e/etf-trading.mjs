import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let strategyId = '';

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-etf@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '主要ETF轮动' }).waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}etf-1-lab-entry.png` });

  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '想找什么股票或ETF？' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: '比较沪深300ETF和黄金ETF近一年表现' }).waitFor();
  await page.screenshot({ path: `${SHOTS}etf-2-research-entry.png` });

  strategyId = await page.evaluate(async () => {
    const code = `let entered = false;
let exited = false;
export default defineStrategy({
  name: 'e2e ETF 成交链路',
  watch: ['510300.SH'],
  onBar(ctx) {
    if (!entered) {
      ctx.order('510300.SH', 100);
      entered = true;
    } else if (!exited && ctx.date >= '20240110') {
      ctx.exit('510300.SH');
      exited = true;
    }
  },
});`;
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'e2e ETF 成交链路',
        start: '20240102',
        end: '20240115',
        initialCash: 100_000,
        code,
      }),
    });
    const strategy = await response.json();
    if (!response.ok) {
      throw new Error(`strategy seed failed: ${JSON.stringify(strategy)}`);
    }
    return strategy.id;
  });

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '运行回测' }).click();
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 60_000 });
  await page
    .locator('.jx-lab-resultTabs')
    .getByRole('tab', { name: /交易明细/ })
    .click();
  await page.locator('.jx-lab-tradesTab .jx-td-row').first().waitFor({ timeout: 10_000 });
  await page.locator('.jx-lab-tradesTab .jx-td-canvas canvas').first().waitFor({ timeout: 10_000 });

  const badgeCount = await page
    .locator('.jx-lab-tradesTab .jx-td-chipType', { hasText: 'ETF' })
    .count();
  if (badgeCount !== 1) {
    throw new Error(`expected one ETF badge, got ${badgeCount}`);
  }
  const instrumentName = await page
    .locator('.jx-lab-tradesTab .jx-td-chipName')
    .nth(1)
    .textContent();
  if (!instrumentName?.includes('沪深300ETF')) {
    throw new Error(`unexpected ETF instrument name: ${instrumentName}`);
  }
  const tradeRows = await page.locator('.jx-lab-tradesTab .jx-td-row').count();
  if (tradeRows !== 2) {
    throw new Error(`expected two ETF fills, got ${tradeRows}`);
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}etf-3-trade-detail.png`, fullPage: true });
  console.log(`[e2e] ETF product path passed; screenshots in ${SHOTS}`);
} finally {
  if (strategyId) {
    await page
      .evaluate((id) => fetch(`/api/app/strategies/${id}`, { method: 'DELETE' }), strategyId)
      .catch(() => {});
  }
  await browser.close();
}
