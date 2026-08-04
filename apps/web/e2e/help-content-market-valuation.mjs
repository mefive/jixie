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
  await assertWeatherDimension('申万行业', 6, 31);
  await page.waitForTimeout(400);

  await annotatedScreenshot(page, `${OUTPUT}market-weather-overview-01.png`, [
    { locator: page.locator('.jx-industryWeather-dimension'), number: 1 },
    { locator: page.locator('.jx-industryWeather-frequency'), number: 2 },
    { locator: page.locator('.jx-industryWeather-brief'), number: 3 },
    { locator: page.locator('.jx-industryWeather-group').first(), number: 4 },
  ]);

  await switchWeatherDimension('规模宽基', 'scale', 4, 10);
  await switchWeatherDimension('市场板块', 'board', 3, 8);
  await switchWeatherDimension('风格策略', 'style', 7, 16);
  await page.locator('.jx-industryWeather-head').scrollIntoViewIfNeeded();
  await annotatedScreenshot(page, `${OUTPUT}market-weather-dimensions-01.png`, [
    {
      locator: page
        .locator('.jx-industryWeather-dimension .ant-segmented-item')
        .filter({ hasText: '申万行业' }),
      number: 1,
    },
    {
      locator: page
        .locator('.jx-industryWeather-dimension .ant-segmented-item')
        .filter({ hasText: '规模宽基' }),
      number: 2,
    },
    {
      locator: page
        .locator('.jx-industryWeather-dimension .ant-segmented-item')
        .filter({ hasText: '市场板块' }),
      number: 3,
    },
    {
      locator: page
        .locator('.jx-industryWeather-dimension .ant-segmented-item')
        .filter({ hasText: '风格策略' }),
      number: 4,
    },
  ]);

  const timeline = page.locator('.jx-industryWeather-timeline');
  await timeline.scrollIntoViewIfNeeded();
  await annotatedScreenshot(page, `${OUTPUT}market-weather-playback-01.png`, [
    { locator: page.getByRole('button', { name: '上一个周期' }), number: 1 },
    { locator: page.getByRole('button', { name: '播放' }), number: 2 },
    { locator: page.getByRole('button', { name: '下一个周期' }), number: 3 },
    { locator: page.locator('.jx-industryWeather-slider'), number: 4 },
    { locator: page.locator('.jx-industryWeather-range'), number: 5 },
  ]);

  await switchWeatherDimension('申万行业', 'industry', 6, 31);
  const bankCard = page.locator('.jx-industryWeather-card').filter({ hasText: '银行' });
  await bankCard.scrollIntoViewIfNeeded();
  await bankCard.click();
  const drawer = page.getByRole('dialog', { name: '银行' });
  await drawer.waitFor();
  await page.waitForTimeout(500);
  await annotatedScreenshot(page, `${OUTPUT}market-weather-detail-01.png`, [
    { locator: drawer.locator('.jx-industryWeather-drawerState'), number: 1 },
    { locator: drawer.locator('.jx-industryWeather-drawerMetrics'), number: 2 },
    { locator: drawer.locator('.jx-industryWeather-historyStrip'), number: 3 },
    { locator: drawer.locator('.jx-industryWeather-historyList'), number: 4 },
  ]);
  await page.getByRole('button', { name: '关闭' }).click();
}

async function switchWeatherDimension(label, dimension, groups, cards) {
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes(`/market/weather?dimension=${dimension}&frequency=month`),
    ),
    page.getByText(label, { exact: true }).click(),
  ]);
  await assertWeatherDimension(label, groups, cards);
}

async function assertWeatherDimension(label, expectedGroups, expectedCards) {
  await page.locator('.jx-industryWeather-card').first().waitFor({ timeout: 30_000 });
  const groups = await page.locator('.jx-industryWeather-group').count();
  const cards = await page.locator('.jx-industryWeather-card').count();
  if (groups !== expectedGroups || cards !== expectedCards) {
    throw new Error(
      `${label}: expected ${expectedGroups} groups/${expectedCards} cards, got ${groups}/${cards}`,
    );
  }
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
