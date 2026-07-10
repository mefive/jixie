import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

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

  const strategyId = await page.evaluate(async () => {
    const code = `export default defineStrategy({
  name: 'e2e 股票期货混合对冲',
  watch: ['600519.SH'],
  futures: ['IF.CFX'],
  accounts: {
    stock: { cashWeight: 0.8 },
    futures: { cashWeight: 0.2 },
  },
  onBar(ctx) {
    if (ctx.date !== '20260615') return;
    ctx.setHoldings({ '600519.SH': 1 });
    ctx.hedgeFuture('IF.CFX', 1);
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

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: '运行回测' }).click();
  await page.locator('.jx-lab-metric', { hasText: '股票账户权益' }).waitFor({ timeout: 120_000 });
  await page.locator('.jx-lab-result canvas').first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(600);

  const requiredMetrics = ['股票账户权益', '期货账户权益', '期货保证金', '净敞口'];
  for (const label of requiredMetrics) {
    const count = await page.locator('.jx-lab-metric', { hasText: label }).count();
    if (count !== 1) {
      throw new Error(`expected one ${label} metric, got ${count}`);
    }
  }

  const path = `${SHOTS}mixed-futures-result.png`;
  await page.screenshot({ path, fullPage: true });
  console.log(`[e2e] mixed futures screenshot: ${path}`);
} finally {
  await browser.close();
}
