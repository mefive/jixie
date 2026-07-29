import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../public/help/zh/backtesting/', import.meta.url).pathname;
const STRATEGY_NAME = '帮助文档：参数扫描';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-parameter-scan-e2e]', ...args);
let strategyId = null;

try {
  await login();
  await cleanup();
  strategyId = await seedStrategy();
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });

  await page.getByRole('button', { name: '参数扫描' }).first().click();
  const dialog = page.getByRole('dialog', { name: '参数稳健性扫描' });
  await dialog.waitFor();
  const dimensions = page.locator('.jx-parameterScan-dimension');
  await dimensions.first().locator('.ant-input').fill('2, 3');
  await page.getByRole('checkbox', { name: '扫描第二个参数' }).check();
  await dimensions.nth(1).locator('.ant-input').fill('100, 200');

  await annotatedScreenshot(page, `${OUTPUT}parameter-scan-settings-01.png`, [
    { locator: dimensions.first(), number: 1 },
    { locator: dimensions.nth(1), number: 2 },
    { locator: page.getByRole('checkbox', { name: '同时运行样本内 / 样本外' }), number: 3 },
    { locator: page.getByRole('button', { name: '开始扫描' }), number: 4 },
  ]);

  await page.getByRole('button', { name: '开始扫描' }).click();
  await page.getByRole('tab', { name: '参数扫描' }).click();
  await Promise.race([
    page.locator('.jx-parameterScan-chart canvas').first().waitFor({ timeout: 120_000 }),
    page.locator('.jx-parameterScan-error').waitFor({ timeout: 120_000 }),
  ]);
  const scanError = await page
    .locator('.jx-parameterScan-error')
    .textContent()
    .catch(() => null);
  if (scanError) {
    throw new Error(`parameter scan failed: ${scanError}`);
  }
  const rows = page.locator('.jx-parameterScan-table .ant-table-row[data-row-key]');
  const rowCount = await rows.count();
  if (rowCount !== 4) {
    throw new Error(`expected four scan cells, got ${rowCount}`);
  }

  await annotatedScreenshot(page, `${OUTPUT}parameter-scan-results-01.png`, [
    { locator: page.locator('.jx-parameterScan-history'), number: 1 },
    { locator: page.locator('.jx-parameterScan-metric'), number: 2 },
    { locator: page.locator('.jx-parameterScan-chart'), number: 3 },
    { locator: page.locator('.jx-parameterScan-table'), number: 4 },
  ]);
  log(`parameter scan screenshots completed; cells=${rowCount}`);
} finally {
  await cleanup().catch((error) => log('cleanup failed:', error.message));
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function seedStrategy() {
  const code = [
    "let lastMonth = '';",
    'export default defineStrategy({',
    `  name: '${STRATEGY_NAME}',`,
    '  params: { lookback: 3, shares: 100 },',
    "  watch: ['510300.SH'],",
    '  onBar(ctx) {',
    "    const month = ctx.period('monthly');",
    '    const closes = ctx.history("510300.SH", "close", ctx.params.lookback);',
    '    if (month === lastMonth || closes.length < ctx.params.lookback) return;',
    '    lastMonth = month;',
    "    ctx.order('510300.SH', ctx.params.shares);",
    '  },',
    '});',
  ].join('\n');
  const seeded = await page.evaluate(
    async ({ name, strategyCode }) => {
      const response = await fetch('/api/app/strategies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          code: strategyCode,
          start: '20240101',
          end: '20240331',
          initialCash: 1_000_000,
          cost: { slippageBps: 2, impactCoef: 0.1 },
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { name: STRATEGY_NAME, strategyCode: code },
  );
  if (seeded.status !== 200 || !seeded.body.id) {
    throw new Error(`strategy seed failed: ${JSON.stringify(seeded)}`);
  }
  return seeded.body.id;
}

async function cleanup() {
  await page.evaluate(async (name) => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      if (strategy.name === name) {
        await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
      }
    }
  }, STRATEGY_NAME);
}

async function annotatedScreenshot(targetPage, path, marks) {
  const annotations = [];
  for (const mark of marks) {
    const target = mark.locator.first();
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(`annotation ${mark.number} target is not visible for ${path}`);
    }
    annotations.push({ ...box, number: mark.number });
  }

  await targetPage.evaluate((items) => {
    const layer = document.createElement('div');
    layer.dataset.helpAnnotations = 'true';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for (const item of items) {
      const outline = document.createElement('div');
      outline.style.cssText = [
        'position:absolute',
        `left:${Math.max(2, item.x - 4)}px`,
        `top:${Math.max(2, item.y - 4)}px`,
        `width:${Math.max(8, item.width + 8)}px`,
        `height:${Math.max(8, item.height + 8)}px`,
        'border:3px solid #e8463b',
        'border-radius:9px',
        'box-sizing:border-box',
        'box-shadow:0 0 0 2px rgba(255,255,255,.9)',
      ].join(';');
      const badge = document.createElement('div');
      badge.textContent = String(item.number);
      badge.style.cssText = [
        'position:absolute',
        `left:${Math.max(4, item.x - 15)}px`,
        `top:${Math.max(4, item.y - 15)}px`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border:2px solid #fff',
        'border-radius:999px',
        'background:#e8463b',
        'color:#fff',
        'font-size:15px',
        'font-weight:700',
        'line-height:1',
        'box-shadow:0 2px 7px rgba(0,0,0,.3)',
      ].join(';');
      layer.append(outline, badge);
    }
    document.body.append(layer);
  }, annotations);

  await targetPage.screenshot({ path });
  await targetPage
    .locator('[data-help-annotations="true"]')
    .evaluate((element) => element.remove());
  log('wrote', path.split('/').at(-1));
}
