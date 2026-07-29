import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../public/help/zh/backtesting/', import.meta.url).pathname;
const PREFIX = '帮助文档资产：';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-etf-futures-e2e]', ...args);

try {
  await login();
  await cleanup();
  await captureEtfEntry();
  await captureEtfTrades();
  await captureFuturesTrades();
  await captureMixedStrategy();
  log('ETF and futures screenshots completed');
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
      body: JSON.stringify({ email: 'e2e-help-assets@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => {
    localStorage.setItem('jx-locale', 'zh');
    localStorage.removeItem('jx-lab-recents');
  });
}

async function captureEtfEntry() {
  await page.goto(`${BASE}/lab?new=1`, { waitUntil: 'domcontentloaded' });
  const example = page.getByRole('button', { name: '主要ETF轮动' });
  await example.waitFor({ timeout: 20_000 });
  await annotatedScreenshot(page, `${OUTPUT}etf-entry-01.png`, [
    { locator: page.getByRole('heading', { name: '新建策略' }), number: 1 },
    { locator: page.locator('.jx-lab-heroBox'), number: 2 },
    { locator: example, number: 3 },
    { locator: page.getByText('或直接写代码', { exact: false }), number: 4 },
  ]);
}

async function captureEtfTrades() {
  const name = `${PREFIX}ETF 成交`;
  const code = [
    'let entered = false;',
    'let exited = false;',
    'export default defineStrategy({',
    `  name: '${name}',`,
    "  watch: ['510300.SH'],",
    '  onBar(ctx) {',
    '    if (!entered) {',
    "      ctx.order('510300.SH', 100);",
    '      entered = true;',
    "    } else if (!exited && ctx.date >= '20240110') {",
    "      ctx.exit('510300.SH');",
    '      exited = true;',
    '    }',
    '  },',
    '});',
  ].join('\n');
  const strategyId = await seedStrategy({
    name,
    code,
    start: '20240102',
    end: '20240115',
    initialCash: 100_000,
  });
  await openAndRun(strategyId);
  const tradesTab = page.locator('.jx-lab-resultTabs').getByRole('tab', { name: /交易明细/ });
  await tradesTab.click();
  const rows = page.locator('.jx-lab-tradesTab .jx-td-row');
  await rows.first().waitFor({ timeout: 15_000 });
  if ((await rows.count()) !== 2) {
    throw new Error(`expected two ETF fills, got ${await rows.count()}`);
  }
  if ((await page.locator('.jx-lab-tradesTab .jx-td-instType', { hasText: 'ETF' }).count()) !== 2) {
    throw new Error('ETF trade badges are missing');
  }
  await annotatedScreenshot(page, `${OUTPUT}etf-trades-01.png`, [
    { locator: tradesTab, number: 1 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-metrics'), number: 2 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-filters'), number: 3 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-list'), number: 4 },
  ]);
}

async function captureFuturesTrades() {
  const name = `${PREFIX}股指期货`;
  const code = [
    'let entered = false;',
    'let exited = false;',
    'export default defineStrategy({',
    `  name: '${name}',`,
    "  futures: ['IF.CFX'],",
    '  onBar(ctx) {',
    '    if (!entered) {',
    "      ctx.orderFuture('IF.CFX', 1);",
    '      entered = true;',
    "    } else if (!exited && ctx.date >= '20260624') {",
    "      ctx.exitFuture('IF.CFX');",
    '      exited = true;',
    '    }',
    '  },',
    '});',
  ].join('\n');
  const strategyId = await seedStrategy({
    name,
    code,
    start: '20260615',
    end: '20260630',
    initialCash: 5_000_000,
  });
  await openAndRun(strategyId);
  const tradesTab = page.locator('.jx-lab-resultTabs').getByRole('tab', { name: /交易明细/ });
  await tradesTab.click();
  const rows = page.locator('.jx-lab-tradesTab .jx-td-row');
  await rows.first().waitFor({ timeout: 15_000 });
  const futuresBadges = page.locator('.jx-lab-tradesTab .jx-td-instType', {
    hasText: '期货',
  });
  if ((await futuresBadges.count()) < 2) {
    throw new Error(`expected futures entry and exit fills, got ${await futuresBadges.count()}`);
  }
  await annotatedScreenshot(page, `${OUTPUT}futures-trades-01.png`, [
    { locator: page.locator('.jx-lab-code'), number: 1 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-metrics'), number: 2 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-head'), number: 3 },
    { locator: rows, number: 4 },
  ]);
}

async function captureMixedStrategy() {
  const name = `${PREFIX}股票期货混合`;
  const code = [
    'export default defineStrategy({',
    `  name: '${name}',`,
    "  watch: ['600519.SH'],",
    "  futures: ['IF.CFX'],",
    '  accounts: {',
    '    stock: { cashWeight: 0.8 },',
    '    futures: { cashWeight: 0.2 },',
    '  },',
    '  onBar(ctx) {',
    "    if (ctx.date !== '20260615') return;",
    "    ctx.setHoldings({ '600519.SH': 1 });",
    "    ctx.hedgeFuture('IF.CFX', 1);",
    '  },',
    '});',
  ].join('\n');
  const strategyId = await seedStrategy({
    name,
    code,
    start: '20260615',
    end: '20260630',
    initialCash: 10_000_000,
  });
  await openAndRun(strategyId);
  const metric = (label) => page.locator('.jx-lab-metric', { hasText: label });
  for (const label of ['股票账户权益', '期货账户权益', '期货保证金', '净敞口']) {
    await metric(label).waitFor();
  }
  await page.locator('.jx-lab-result canvas').first().waitFor({ timeout: 15_000 });
  await annotatedScreenshot(page, `${OUTPUT}mixed-results-01.png`, [
    { locator: metric('股票账户权益'), number: 1 },
    { locator: metric('期货账户权益'), number: 2 },
    { locator: metric('期货保证金'), number: 3 },
    { locator: metric('净敞口'), number: 4 },
  ]);

  const tradesTab = page.locator('.jx-lab-resultTabs').getByRole('tab', { name: /交易明细/ });
  await tradesTab.click();
  const rows = page.locator('.jx-lab-tradesTab .jx-td-row');
  await rows.first().waitFor({ timeout: 15_000 });
  const stockRow = rows.filter({
    has: page.locator('.jx-td-instType', { hasText: '股票' }),
  });
  const futuresRows = rows.filter({
    has: page.locator('.jx-td-instType', { hasText: '期货' }),
  });
  await stockRow.first().waitFor();
  await futuresRows.first().waitFor();
  await annotatedScreenshot(page, `${OUTPUT}mixed-trades-01.png`, [
    { locator: page.locator('.jx-lab-tradesTab .jx-td-metrics'), number: 1 },
    { locator: page.locator('.jx-lab-tradesTab .jx-td-filters'), number: 2 },
    { locator: stockRow, number: 3 },
    { locator: futuresRows, number: 4 },
  ]);
}

async function seedStrategy({ name, code, start, end, initialCash }) {
  const seeded = await page.evaluate(
    async (config) => {
      const response = await fetch('/api/app/strategies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...config,
          cost: { slippageBps: 2, impactCoef: 0.1 },
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { name, code, start, end, initialCash },
  );
  if (seeded.status !== 200 || !seeded.body.id) {
    throw new Error(`strategy seed failed: ${JSON.stringify(seeded)}`);
  }
  return seeded.body.id;
}

async function openAndRun(strategyId) {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '运行回测' }).click();
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
}

async function cleanup() {
  await page.evaluate(async (prefix) => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      if (strategy.name.startsWith(prefix)) {
        await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
      }
    }
  }, PREFIX);
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
