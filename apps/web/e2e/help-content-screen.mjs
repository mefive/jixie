import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SCREEN_OUTPUT = new URL('../public/help/zh/screening/', import.meta.url).pathname;
const STOCK_OUTPUT = new URL('../public/help/zh/stock-detail/', import.meta.url).pathname;
mkdirSync(SCREEN_OUTPUT, { recursive: true });
mkdirSync(STOCK_OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-screen-content-e2e]', ...args);

try {
  await login();
  await cleanup();
  await captureScreening();
  await captureStockDetail();
  log('screening and stock-detail screenshots completed');
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

async function captureScreening() {
  await page.evaluate(async () => {
    const response = await fetch('/api/app/screens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '低估值高股息大盘股',
        spec: {
          filters: [
            { field: 'peTtm', op: '<', value: 15 },
            { field: 'dvRatio', op: '>', value: 3 },
          ],
          sort: { field: 'totalMv', dir: 'desc' },
          limit: 50,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`saved screen seed failed: ${response.status}`);
    }
  });

  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.locator('.jx-screen-historyItem', { hasText: '低估值高股息大盘股' }).click();
  await page.locator('.jx-screen-table tbody tr.ant-table-row').first().waitFor({
    timeout: 20_000,
  });
  await annotatedScreenshot(page, `${SCREEN_OUTPUT}filter-results-01.png`, [
    { locator: page.locator('.jx-chips'), number: 1 },
    { locator: page.locator('.jx-screen-summary'), number: 2 },
    { locator: page.locator('.jx-screen-table'), number: 3 },
  ]);

  await page.getByRole('button', { name: '加条件' }).click();
  await page.getByText('现价(元)', { exact: true }).click();
  await page.locator('.jx-chips-chip').nth(2).waitFor();
  await page.keyboard.press('Escape');
  await page.getByTitle('从高到低').click();
  await page.getByTitle('从低到高').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.jx-screen-table .ant-spin-spinning').waitFor({
    state: 'detached',
    timeout: 10_000,
  });
  await annotatedScreenshot(page, `${SCREEN_OUTPUT}edit-sort-01.png`, [
    { locator: page.locator('.jx-chips-chip'), number: 1 },
    { locator: page.getByRole('button', { name: '加条件' }), number: 2 },
    { locator: page.locator('.jx-chips-sort'), number: 3 },
  ]);

  await page.locator('.jx-screen-nameInput').fill('低估值高股息（价格限制）');
  await page.getByRole('button', { name: '保存筛选' }).click();
  await page
    .locator('.jx-screen-historyItem', { hasText: '低估值高股息（价格限制）' })
    .waitFor({ timeout: 10_000 });
  await annotatedScreenshot(page, `${SCREEN_OUTPUT}save-reuse-01.png`, [
    { locator: page.locator('.jx-screen-nameInput'), number: 1 },
    { locator: page.getByRole('button', { name: '保存筛选' }), number: 2 },
    {
      locator: page.locator('.jx-screen-sidebarSection', { hasText: '已保存筛选' }),
      number: 3,
    },
  ]);

  await page.getByRole('button', { name: '新对话' }).click();
  await page.locator('.jx-screen-chatHero').waitFor();
  await annotatedScreenshot(page, `${SCREEN_OUTPUT}conversations-01.png`, [
    { locator: page.getByRole('button', { name: '新对话' }), number: 1 },
    { locator: page.locator('.jx-screen-chatHero textarea'), number: 2 },
    {
      locator: page.locator('.jx-screen-sidebarSection', { hasText: '历史对话' }),
      number: 3,
    },
    {
      locator: page.locator('.jx-screen-sidebarSection', { hasText: '已保存筛选' }),
      number: 4,
    },
  ]);
}

async function captureStockDetail() {
  await page.goto(`${BASE}/stock/600519.SH`, { waitUntil: 'networkidle' });
  await page.locator('.jx-stock-chart canvas').waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800);
  await annotatedScreenshot(page, `${STOCK_OUTPUT}chart-overview-01.png`, [
    { locator: page.locator('.jx-stock-title'), number: 1 },
    { locator: page.locator('.jx-stock-toggle').nth(0), number: 2 },
    { locator: page.locator('.jx-stock-toggle').nth(1), number: 3 },
    { locator: page.locator('.jx-stock-chart'), number: 4 },
  ]);

  await page.getByText('后复权', { exact: true }).click();
  await page.getByText('对数', { exact: true }).click();
  await page.waitForTimeout(700);
  await annotatedScreenshot(page, `${STOCK_OUTPUT}adjustments-01.png`, [
    { locator: page.locator('.jx-stock-toggle').nth(0), number: 1 },
    { locator: page.locator('.jx-stock-toggle').nth(1), number: 2 },
    { locator: page.locator('.jx-stock-chart'), number: 3 },
  ]);
}

async function cleanup() {
  await page.evaluate(async () => {
    const screens = await (await fetch('/api/app/screens')).json();
    for (const screen of screens) {
      await fetch(`/api/app/screens/${screen.id}`, { method: 'DELETE' });
    }
    const conversations = await (await fetch('/api/app/screen/conversations')).json();
    for (const conversation of conversations) {
      await fetch(`/api/app/screen/conversations/${conversation.id}`, { method: 'DELETE' });
    }
  });
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
