import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/market-valuation/', import.meta.url)
  .pathname;
const EMAIL = 'e2e-help-market-valuation@test.com';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-market-valuation-e2e]', ...args);

try {
  await login();
  await captureMarket();
  await captureValuation();
  log('market and valuation screenshots completed');
} finally {
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async (email) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.status;
  }, EMAIL);
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function captureMarket() {
  await page.goto(`${BASE}/market`, { waitUntil: 'networkidle' });
  await page.locator('.jx-marketState-summary').waitFor({ timeout: 20_000 });
  await page.locator('.jx-marketState-chartCard canvas').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);

  await annotatedScreenshot(page, `${OUTPUT}market-overview-01.png`, [
    { locator: page.locator('.jx-marketState-scopeBar'), number: 1 },
    { locator: page.locator('.jx-marketState-summary'), number: 2 },
    { locator: page.locator('.jx-marketState-detailStrip'), number: 3 },
    { locator: page.locator('.jx-marketState-chartCard'), number: 4 },
    { locator: page.locator('.jx-marketState-method'), number: 5 },
  ]);

  await page.locator('.jx-marketState-scopeTrigger').click();
  const picker = page.locator('.jx-marketState-scopePicker');
  await picker.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}market-scope-01.png`, [
    { locator: page.locator('.jx-marketState-scopeTrigger'), number: 1 },
    { locator: picker.locator('.jx-marketState-scopeGroup--broad'), number: 2 },
    { locator: picker.locator('.jx-marketState-scopeGroup--boards'), number: 3 },
    { locator: picker.locator('.jx-marketState-scopeGroup--styles'), number: 4 },
  ]);

  const response = page.waitForResponse((item) =>
    item.url().includes('/api/app/market/state?scope=000300.SH'),
  );
  await picker.getByRole('option', { name: /沪深300/ }).click();
  if ((await response).status() !== 200) {
    throw new Error('CSI 300 market-state request failed');
  }
  await page.getByText('覆盖 300 只', { exact: false }).waitFor();
  await page
    .locator('.jx-marketState-chartCard .ant-segmented-item', { hasText: '趋势强度' })
    .click();
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}market-index-01.png`, [
    { locator: page.locator('.jx-marketState-scopeBar'), number: 1 },
    { locator: page.locator('.jx-marketState-summary'), number: 2 },
    { locator: page.locator('.jx-marketState-detailStrip'), number: 3 },
    { locator: page.locator('.jx-marketState-chartCard .ant-segmented'), number: 4 },
    { locator: page.locator('.jx-marketState-chartCard canvas'), number: 5 },
    { locator: page.locator('.jx-marketState-method'), number: 6 },
  ]);
}

async function captureValuation() {
  await page.goto(`${BASE}/valuation`, { waitUntil: 'networkidle' });
  await page.locator('.jx-valuation-summary').waitFor({ timeout: 20_000 });
  await page.locator('.jx-valuation-chartCard canvas').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);

  await annotatedScreenshot(page, `${OUTPUT}valuation-overview-01.png`, [
    { locator: page.locator('.jx-valuation-toolbar'), number: 1 },
    { locator: page.locator('.jx-valuation-summary'), number: 2 },
    { locator: page.locator('.jx-valuation-chartControls'), number: 3 },
    { locator: page.locator('.jx-valuation-chartCard canvas'), number: 4 },
    { locator: page.locator('.jx-valuation-method'), number: 5 },
  ]);

  await page.locator('.jx-valuation-indexSelect').click();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  await dropdown.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}valuation-index-01.png`, [
    { locator: page.locator('.jx-valuation-indexSelect'), number: 1 },
    { locator: dropdown, number: 2 },
  ]);

  const indexResponse = page.waitForResponse((item) =>
    item.url().includes('/api/app/market/indices/000905.SH/valuation'),
  );
  await dropdown.getByText('中证500 · 000905.SH', { exact: true }).click();
  if ((await indexResponse).status() !== 200) {
    throw new Error('CSI 500 valuation request failed');
  }
  await page.getByRole('heading', { name: '中证500历史估值' }).waitFor();
  await page
    .locator('.jx-valuation-chartControls .ant-segmented-item', { hasText: '市净率 PB' })
    .click();
  await page
    .locator('.jx-valuation-chartControls .ant-segmented-item', { hasText: '全部' })
    .click();
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}valuation-history-01.png`, [
    { locator: page.locator('.jx-valuation-toolbar'), number: 1 },
    { locator: page.locator('.jx-valuation-summary'), number: 2 },
    {
      locator: page.locator('.jx-valuation-chartControls').locator('.ant-segmented').nth(0),
      number: 3,
    },
    {
      locator: page.locator('.jx-valuation-chartControls').locator('.ant-segmented').nth(1),
      number: 4,
    },
    { locator: page.locator('.jx-valuation-chartCard canvas'), number: 5 },
    { locator: page.locator('.jx-valuation-method'), number: 6 },
  ]);
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
  await targetPage.evaluate(() => {
    document.querySelector('[data-help-annotations="true"]')?.remove();
  });
  log('wrote', path.split('/').at(-1));
}
