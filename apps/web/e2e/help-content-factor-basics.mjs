import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/factors/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-factor-basics-e2e]', ...args);

try {
  await login();
  await openEarningsYield();
  await captureWorkspace();
  await captureSettings();
  await runAndCapture();
  log('factor basics screenshots completed');
} finally {
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-help-factor@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function openEarningsYield() {
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  const library = page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' });
  await library.click();
  const factor = page.locator('.jx-factor-libItem', { hasText: '盈利收益率' });
  await factor.waitFor({ timeout: 20_000 });
  await factor.click();
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 20_000 });
  await page.locator('.jx-factor-paramSummary').waitFor({ timeout: 20_000 });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() => new URL(location.href).searchParams.get('factor') === 'ep');
}

async function captureWorkspace() {
  await annotatedScreenshot(page, `${OUTPUT}factor-workspace-01.png`, [
    {
      locator: page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }),
      number: 1,
    },
    { locator: page.locator('.jx-factor-libItem--active'), number: 2 },
    { locator: page.locator('.jx-factor-presetBar'), number: 3 },
    { locator: page.locator('.jx-factor-paramBar'), number: 4 },
    { locator: page.locator('.jx-factor-dock'), number: 5 },
  ]);
}

async function captureSettings() {
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  const fields = popover.locator('.jx-factor-paramField');
  await annotatedScreenshot(page, `${OUTPUT}factor-settings-01.png`, [
    { locator: fields.nth(0), number: 1 },
    { locator: fields.nth(1), number: 2 },
    { locator: fields.nth(2), number: 3 },
    {
      locator: popover.locator('.jx-factor-paramSectionTitle', {
        hasText: '股票池与缺失值',
      }),
      number: 4,
    },
    { locator: popover.locator('.jx-factor-paramGrid').nth(0), number: 5 },
    { locator: popover.locator('.jx-factor-paramGrid').nth(1), number: 6 },
  ]);
  await page.getByRole('button', { name: '更多设置' }).click();
  await popover.waitFor({ state: 'hidden' });
}

async function runAndCapture() {
  const runButton = page.locator('.jx-factor-runButton');
  await runButton.click();
  const modal = page.locator('.jx-factor-researchModal');
  await modal.waitFor();
  await modal.getByText('纯探索', { exact: true }).click();
  await modal.getByText('本次结果标记为纯探索', { exact: false }).waitFor();
  await annotatedScreenshot(page, `${OUTPUT}factor-research-card-01.png`, [
    { locator: modal.getByRole('radiogroup'), number: 1 },
    { locator: modal.locator('.ant-alert'), number: 2 },
    { locator: modal.getByRole('button', { name: '冻结研究卡并运行' }), number: 3 },
  ]);

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/factor/analysis/run',
  );
  await modal.getByRole('button', { name: '冻结研究卡并运行' }).click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(`factor submission failed: ${response.status()} ${await response.text()}`);
  }

  await page.getByText('计算中', { exact: false }).first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await annotatedScreenshot(page, `${OUTPUT}factor-running-01.png`, [
    { locator: page.locator('.jx-factor-paramBar'), number: 1 },
    { locator: page.locator('.jx-factor-result'), number: 2 },
    { locator: page.locator('.jx-factor-dock'), number: 3 },
  ]);

  await page.locator('.jx-factor-methodology').waitFor({ timeout: 180_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-metrics').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await annotatedScreenshot(page, `${OUTPUT}factor-methodology-01.png`, [
    { locator: page.locator('.jx-factor-resultHead'), number: 1 },
    { locator: page.locator('.jx-factor-methodology'), number: 2 },
  ]);

  await page.locator('.jx-factor-result').evaluate((element) => {
    const chart = element.querySelector('.jx-factor-chart');
    if (chart instanceof HTMLElement) {
      element.scrollTop = chart.offsetTop - 24;
    }
  });
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}factor-overview-01.png`, [
    { locator: page.locator('.jx-factor-chart').first(), number: 1 },
    { locator: page.locator('.jx-factor-chartCap').first(), number: 2 },
    { locator: page.locator('.jx-factor-metrics').first(), number: 3 },
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
}
