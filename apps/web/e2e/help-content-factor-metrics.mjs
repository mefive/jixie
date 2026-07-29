import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../public/help/zh/factors/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-factor-metrics-e2e]', ...args);

try {
  await login();
  await openRawEarningsYieldReport();
  await captureDecilesAndRankIc();
  await captureCosts();
  await runNeutralizedAnalysis();
  log('factor metric screenshots completed');
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
      body: JSON.stringify({ email: 'e2e-help-factor-advanced@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function openRawEarningsYieldReport() {
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 20_000 });
  await page.locator('.jx-factor-paramSummary').waitFor({ timeout: 20_000 });

  const rawReportId = await page.evaluate(async () => {
    const response = await fetch('/api/app/factor/reports?factor=ep&limit=100');
    const reports = await response.json();
    return (
      reports.items.find(
        (report) =>
          report.status === 'done' && report.phase === 'explore' && report.spec?.neutral === 'none',
      )?.id ?? null
    );
  });
  if (rawReportId) {
    await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(rawReportId)}`, {
      waitUntil: 'domcontentloaded',
    });
    await waitForReport();
    return;
  }

  await runCurrentDraft();
}

async function captureDecilesAndRankIc() {
  const result = page.locator('.jx-factor-result');
  await result.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}factor-deciles-01.png`, [
    { locator: page.locator('.jx-factor-resultHead .ant-segmented'), number: 1 },
    { locator: page.locator('.jx-factor-chart').first(), number: 2 },
    { locator: page.locator('.jx-factor-chartCap').first(), number: 3 },
  ]);

  const firstMetrics = page.locator('.jx-factor-metrics').first();
  await firstMetrics.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const metricCards = firstMetrics.locator('.jx-factor-metric');
  await annotatedScreenshot(page, `${OUTPUT}factor-rank-ic-01.png`, [
    { locator: metricCards.nth(0), number: 1 },
    { locator: metricCards.nth(1), number: 2 },
    { locator: metricCards.nth(2), number: 3 },
    { locator: metricCards.nth(6), number: 4 },
  ]);

  const decayTitle = page.locator('.jx-factor-sectionTitle', { hasText: 'IC 衰减' });
  await decayTitle.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}factor-ic-decay-01.png`, [
    { locator: decayTitle, number: 1 },
    { locator: page.locator('.jx-factor-chart').nth(2), number: 2 },
    { locator: page.locator('.jx-factor-chartCap').nth(2), number: 3 },
  ]);
}

async function captureCosts() {
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  await popover.locator('.jx-factor-paramPopoverBody').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(300);
  const costGrid = popover.locator('.jx-factor-paramGrid').nth(2);
  const costFields = costGrid.locator('label');
  await annotatedScreenshot(page, `${OUTPUT}factor-cost-settings-01.png`, [
    {
      locator: popover.locator('.jx-factor-paramSectionTitle', {
        hasText: '单边交易成本',
      }),
      number: 1,
    },
    { locator: costFields.nth(0), number: 2 },
    { locator: costFields.nth(1), number: 3 },
    { locator: costFields.nth(2), number: 4 },
  ]);
  await page.getByRole('button', { name: '更多设置' }).click();
  await popover.waitFor({ state: 'hidden' });

  const costTitle = page.locator('.jx-factor-sectionTitle', {
    hasText: '多空净值 · 费前 vs 费后',
  });
  await costTitle.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}factor-cost-results-01.png`, [
    { locator: costTitle, number: 1 },
    { locator: page.locator('.jx-factor-chart').nth(1), number: 2 },
    { locator: page.locator('.jx-factor-chartCap').nth(1), number: 3 },
    { locator: page.locator('.jx-factor-metrics').nth(1), number: 4 },
  ]);
}

async function runNeutralizedAnalysis() {
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  await popover.locator('.jx-factor-paramPopoverBody').evaluate((element) => {
    element.scrollTop = 0;
  });
  const neutralField = popover.locator('.jx-factor-paramField').nth(2);
  await neutralField.locator('.jx-factor-neutralSelect').click();
  const dropdown = page.locator('.ant-select-dropdown:visible');
  await dropdown.waitFor();
  const sizeIndustryOption = dropdown.locator('.ant-select-item-option', {
    hasText: '市值+行业',
  });
  await sizeIndustryOption.click();
  await neutralField.getByText('市值+行业', { exact: true }).waitFor();
  await page.locator('.jx-factor-reportWarning').waitFor();
  await annotatedScreenshot(page, `${OUTPUT}factor-neutralization-setting-01.png`, [
    { locator: neutralField, number: 1 },
    { locator: popover.getByRole('button', { name: '重新运行' }), number: 2 },
  ]);
  await page.getByRole('button', { name: '更多设置' }).click();
  await popover.waitFor({ state: 'hidden' });

  await runCurrentDraft();
  await page.locator('.jx-factor-paramSummary', { hasText: '市值+行业' }).waitFor();
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}factor-neutralization-result-01.png`, [
    { locator: page.locator('.jx-factor-paramSummary'), number: 1 },
    { locator: page.locator('.jx-factor-resultHead'), number: 2 },
    { locator: page.locator('.jx-factor-chart').first(), number: 3 },
  ]);

  await page.locator('.jx-factor-historyTrigger').click();
  const history = page.locator('.jx-factor-historyModal');
  await history.waitFor();
  const raw = history.locator('.jx-factor-historyItem').filter({ hasText: '无' }).first();
  const neutralized = history
    .locator('.jx-factor-historyItem')
    .filter({ hasText: '市值+行业' })
    .first();
  await raw.scrollIntoViewIfNeeded();
  await neutralized.scrollIntoViewIfNeeded();
  await annotatedScreenshot(page, `${OUTPUT}factor-neutralization-history-01.png`, [
    { locator: neutralized, number: 1 },
    { locator: raw, number: 2 },
  ]);
}

async function runCurrentDraft() {
  const runButton = page.locator('.jx-factor-runButton');
  await runButton.click();
  const modal = page.locator('.jx-factor-researchModal');
  await modal.waitFor();
  await modal.getByText('纯探索', { exact: true }).click();
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
  await waitForReport();
}

async function waitForReport() {
  await page.locator('.jx-factor-methodology').waitFor({ timeout: 180_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-metrics').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-sectionTitle', { hasText: '多空净值' }).waitFor();
  await page.locator('.jx-factor-sectionTitle', { hasText: 'IC 衰减' }).waitFor();
  await page.waitForTimeout(800);
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
