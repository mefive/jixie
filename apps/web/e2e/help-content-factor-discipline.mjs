import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/factors/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-factor-discipline-e2e]', ...args);

try {
  await login();
  await openEarningsYield();
  await setShortExploreRange();
  await runHypothesisExplore();
  await captureResearchSummary();
  await captureOutdatedReport();
  await restoreExploreReport();
  await runAndCaptureHoldout();
  await captureCorrelation();
  log('factor discipline screenshots completed');
} finally {
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const email = `e2e-help-factor-discipline-${Date.now()}@test.com`;
  const status = await page.evaluate(async (loginEmail) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    return response.status;
  }, email);
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function openEarningsYield() {
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 20_000 });
  await page.locator('.jx-factor-paramSummary').waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.get('factor') === 'ep');
}

async function setShortExploreRange() {
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  const startInput = popover.locator('.ant-picker input').first();
  await startInput.click();
  await startInput.fill('2022-01-01');
  await startInput.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '更多设置' }).click();
  await popover.waitFor({ state: 'hidden' });
  await page.locator('.jx-factor-paramSummary', { hasText: '2022-01-01' }).waitFor();
}

async function runHypothesisExplore() {
  await page.locator('.jx-factor-runButton').click();
  const modal = page.locator('.jx-factor-researchModal');
  await modal.waitFor();
  await page.waitForTimeout(400);
  const textareas = modal.locator('textarea');
  await textareas.nth(0).fill('盈利收益率较高的股票，下一月收益排名倾向高于盈利收益率较低的股票。');
  await textareas
    .nth(1)
    .fill('估值较低的公司可能获得更高的后续收益，但需要排除规模和行业暴露后继续验证。');
  const threshold = modal.locator('.ant-input-number-input');
  await threshold.fill('0');

  await annotatedScreenshot(page, `${OUTPUT}factor-research-hypothesis-01.png`, [
    { locator: modal.getByRole('radiogroup'), number: 1 },
    { locator: textareas.nth(0), number: 2 },
    { locator: textareas.nth(1), number: 3 },
    { locator: modal.locator('.jx-factor-researchRow'), number: 4 },
    { locator: modal.getByRole('button', { name: '冻结研究卡并运行' }), number: 5 },
  ]);

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/factor/analysis/run',
  );
  await modal.getByRole('button', { name: '冻结研究卡并运行' }).click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(`explore submission failed: ${response.status()} ${await response.text()}`);
  }
  await waitForReport();
}

async function captureResearchSummary() {
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(400);
  const researchBar = page.locator('.jx-factor-researchBar');
  await researchBar.getByRole('button', { name: '验证保留段' }).waitFor();
  await annotatedScreenshot(page, `${OUTPUT}factor-research-summary-01.png`, [
    { locator: page.locator('.jx-factor-paramBar'), number: 1 },
    { locator: researchBar.locator('.jx-factor-researchHint'), number: 2 },
    { locator: researchBar.getByRole('button', { name: '验证保留段' }), number: 3 },
    { locator: page.locator('.jx-factor-resultHead'), number: 4 },
  ]);
}

async function captureOutdatedReport() {
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  const neutralField = popover.locator('.jx-factor-paramField').nth(2);
  await neutralField.locator('.jx-factor-neutralSelect').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: '市值' })
    .first()
    .click();
  await page.getByRole('button', { name: '更多设置' }).click();
  await popover.waitFor({ state: 'hidden' });
  await page.locator('.jx-factor-reportWarning').waitFor();

  await annotatedScreenshot(page, `${OUTPUT}factor-report-outdated-01.png`, [
    { locator: page.locator('.jx-factor-paramSummary'), number: 1 },
    { locator: page.locator('.jx-factor-runButton'), number: 2 },
    { locator: page.locator('.jx-factor-reportWarning'), number: 3 },
  ]);
}

async function restoreExploreReport() {
  const reportId = new URL(page.url()).searchParams.get('report');
  if (!reportId) {
    throw new Error('explore report id is missing from the URL');
  }
  await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(reportId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForReport();
  await page.locator('.jx-factor-paramSummary', { hasText: '· 无' }).waitFor();
}

async function runAndCaptureHoldout() {
  const holdoutButton = page
    .locator('.jx-factor-researchBar')
    .getByRole('button', { name: '验证保留段' });
  await holdoutButton.click();
  const holdoutConfirm = page.locator('.ant-modal-confirm');
  await holdoutConfirm.waitFor();
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}factor-holdout-confirm-01.png`, [
    { locator: holdoutConfirm.locator('.ant-modal-confirm-title'), number: 1 },
    { locator: holdoutConfirm.locator('.jx-factor-holdoutConfirm').first(), number: 2 },
    { locator: holdoutConfirm.locator('.jx-factor-holdoutMeta'), number: 3 },
    { locator: holdoutConfirm.getByRole('button', { name: '验证保留段' }), number: 4 },
  ]);

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/app\/factor\/reports\/[^/]+\/holdout$/.test(new URL(response.url()).pathname),
  );
  await holdoutConfirm.getByRole('button', { name: '验证保留段' }).click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(`holdout submission failed: ${response.status()} ${await response.text()}`);
  }
  const { reportId } = await response.json();
  await page.waitForFunction(
    (expectedReportId) => new URL(location.href).searchParams.get('report') === expectedReportId,
    reportId,
  );
  await page.getByText('Holdout 已计算完成', { exact: false }).waitFor({ timeout: 180_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Holdout 已计算完成', { exact: false }).waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.jx-factor-reportWarning'));
  await page.waitForTimeout(400);

  await annotatedScreenshot(page, `${OUTPUT}factor-holdout-sealed-01.png`, [
    { locator: page.locator('.jx-factor-paramBar'), number: 1 },
    { locator: page.locator('.jx-factor-sealed'), number: 2 },
    { locator: page.getByRole('button', { name: '揭示结果' }), number: 3 },
  ]);

  await page.locator('.jx-factor-historyTrigger').click();
  const history = page.locator('.jx-factor-historyModal');
  await history.waitFor();
  await page.waitForTimeout(400);
  const holdoutHistoryItem = history.locator('.jx-factor-historyItem', {
    hasText: 'Holdout · 未揭示',
  });
  const exploreHistoryItem = history.locator('.jx-factor-historyItem', { hasText: '探索' });
  await annotatedScreenshot(page, `${OUTPUT}factor-holdout-history-01.png`, [
    { locator: holdoutHistoryItem, number: 1 },
    { locator: exploreHistoryItem, number: 2 },
  ]);
  await history.locator('.ant-modal-close').click();

  await page.getByRole('button', { name: '揭示结果' }).click();
  const revealConfirm = page.locator('.ant-modal-confirm');
  await revealConfirm.waitFor();
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}factor-reveal-confirm-01.png`, [
    { locator: revealConfirm.locator('.ant-modal-confirm-title'), number: 1 },
    { locator: revealConfirm.locator('.ant-modal-confirm-content'), number: 2 },
    { locator: revealConfirm.getByRole('button', { name: '揭示结果' }), number: 3 },
  ]);

  const reveal = page.waitForResponse(
    (revealResponse) =>
      revealResponse.request().method() === 'POST' &&
      /\/api\/app\/factor\/reports\/[^/]+\/reveal$/.test(new URL(revealResponse.url()).pathname),
  );
  await revealConfirm.getByRole('button', { name: '揭示结果' }).click();
  const revealResponse = await reveal;
  if (revealResponse.status() !== 200) {
    throw new Error(
      `holdout reveal failed: ${revealResponse.status()} ${await revealResponse.text()}`,
    );
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  const criterionAlert = page
    .locator('.jx-factor-result .ant-alert')
    .filter({ hasText: '预设主要标准' });
  await criterionAlert.waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.jx-factor-reportWarning'));
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await annotatedScreenshot(page, `${OUTPUT}factor-holdout-revealed-01.png`, [
    { locator: criterionAlert, number: 1 },
    { locator: page.locator('.jx-factor-resultHead'), number: 2 },
    { locator: page.locator('.jx-factor-chart').first(), number: 3 },
  ]);
}

async function captureCorrelation() {
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '相关性矩阵' }).click();
  const modal = page.locator('.jx-factor-corrModal');
  await modal.waitFor();
  await page.waitForTimeout(400);
  const select = modal.locator('.jx-factor-corrSelect');
  await select.click();
  const dropdown = page.locator('.ant-select-dropdown:visible');
  for (const factorName of ['盈利收益率', '账面市值比', '股息率']) {
    await dropdown.locator('.ant-select-item-option', { hasText: factorName }).click();
  }
  await select.locator('input').press('Escape');
  await dropdown.waitFor({ state: 'hidden' });
  await annotatedScreenshot(page, `${OUTPUT}factor-correlation-settings-01.png`, [
    { locator: select, number: 1 },
    { locator: modal.locator('.jx-factor-corrHint'), number: 2 },
    { locator: modal.locator('.jx-factor-corrControls .ant-btn-primary'), number: 3 },
  ]);

  await modal.locator('.jx-factor-corrControls .ant-btn-primary').click();
  await modal.locator('.jx-factor-corrChart canvas').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(700);
  await annotatedScreenshot(page, `${OUTPUT}factor-correlation-result-01.png`, [
    { locator: select, number: 1 },
    { locator: modal.locator('.jx-factor-corrChart'), number: 2 },
    { locator: modal.locator('.jx-factor-chartCap'), number: 3 },
  ]);
}

async function waitForReport() {
  await page.locator('.jx-factor-methodology').waitFor({ timeout: 180_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-resultHead').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
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
