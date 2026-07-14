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
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.locator('.jx-factor-historyTrigger').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => new URL(location.href).searchParams.has('report'));

  const firstReportId = new URL(page.url()).searchParams.get('report');
  const selectedDetail = await page.evaluate(async (reportId) => {
    return (await fetch(`/api/app/factor/reports/${reportId}`)).json();
  }, firstReportId);
  if (selectedDetail.factor !== 'ep' || selectedDetail.id !== firstReportId) {
    throw new Error('default report did not restore by stable id');
  }
  await page.screenshot({ path: `${SHOTS}7g-factor-history-button.png` });
  await page.locator('.jx-factor-historyTrigger').click();
  await page.locator('.jx-factor-historyModal').waitFor();
  const historyItems = page.locator('.jx-factor-historyItem');
  const optionCount = await historyItems.count();
  if (optionCount < 2) {
    throw new Error(`expected at least two historical reports, got ${optionCount}`);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}7g-factor-history-desktop.png` });
  await historyItems.nth(1).click();
  await page.waitForFunction(
    (previous) => new URL(location.href).searchParams.get('report') !== previous,
    firstReportId,
  );
  const secondReportId = new URL(page.url()).searchParams.get('report');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (expected) => new URL(location.href).searchParams.get('report') === expected,
    secondReportId,
  );
  await page.locator('.jx-factor-historyTrigger').waitFor({ timeout: 15000 });

  await page.locator('.jx-factor-paramActions button').last().click();
  await page.locator('.jx-factor-paramPopover:visible .jx-factor-neutralSelect').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: '市值' })
    .first()
    .click();
  await page.locator('.jx-factor-reportWarning').waitFor();
  await page.screenshot({ path: `${SHOTS}7i-factor-report-outdated.png` });

  // A historical report would replace the edited parameter draft, so it needs a strong confirmation.
  await page.locator('.jx-factor-paramActions button').last().click();
  await page.locator('.jx-factor-paramPopover').waitFor({ state: 'hidden' });
  await page.locator('.jx-factor-historyTrigger').click();
  await page.locator('.jx-factor-historyModal').waitFor();
  await page.locator('.jx-factor-historyItem--active').click();
  const historyGuard = page.locator('.ant-modal-confirm');
  await historyGuard.waitFor();
  const historyGuardButtons = historyGuard.locator('.ant-modal-confirm-btns button');
  await historyGuardButtons.first().waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}7j-factor-history-param-guard.png` });
  await historyGuardButtons.first().click();
  await page.locator('.jx-factor-historyModal .ant-modal-close').click();

  await page.setViewportSize({ width: 900, height: 760 });
  await page.locator('.jx-factor-historyTrigger').click();
  await page.locator('.jx-factor-historyModal').waitFor();
  const modalBox = await page.locator('.jx-factor-historyModal').boundingBox();
  if (!modalBox || modalBox.x < -1 || modalBox.x + modalBox.width > 902) {
    throw new Error(`report-history modal overflows narrow viewport: ${JSON.stringify(modalBox)}`);
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}7h-factor-history-narrow.png` });

  // Use deterministic mocked factor endpoints to exercise a custom-code edit without creating DB data.
  const guardPage = await context.newPage();
  const fixtureCode = `export default defineFactor({
  name: 'E2E factor',
  compute: (bar) => bar.close,
});\n`;
  const fixtureSpec = {
    version: 1,
    freq: 'month',
    start: '20200101',
    end: '20251231',
    neutral: 'none',
  };
  const fixtureSummary = {
    id: 'e2e-report',
    factor: 'e2e-factor',
    status: 'error',
    phase: 'explore',
    spec: fixtureSpec,
    createdAt: '2026-07-14T08:00:00.000Z',
    error: 'E2E fixture',
  };
  await guardPage.route('**/api/app/factors/catalog', (route) =>
    route.fulfill({
      json: [{ key: 'e2e-factor', label: 'E2E 因子', kind: 'custom' }],
    }),
  );
  await guardPage.route('**/api/app/factors/custom/e2e-factor', (route) =>
    route.fulfill({
      json: {
        id: 'e2e-factor',
        name: 'E2E 因子',
        code: fixtureCode,
        messages: [],
      },
    }),
  );
  await guardPage.route('**/api/app/factor/reports/e2e-report', (route) =>
    route.fulfill({ json: { ...fixtureSummary, factorCodeSnapshot: fixtureCode } }),
  );
  await guardPage.route('**/api/app/factor/reports?*', (route) =>
    route.fulfill({ json: { items: [fixtureSummary] } }),
  );
  await guardPage.goto(`${BASE}/factors?factor=e2e-factor&report=e2e-report`, {
    waitUntil: 'domcontentloaded',
  });
  const editor = guardPage.locator('.jx-factor-code .monaco-editor');
  await editor.waitFor({ timeout: 15000 });
  await editor.click();
  await guardPage.keyboard.press('Meta+ArrowDown');
  await guardPage.keyboard.type('// local edit');
  await guardPage.locator('.jx-factor-reportWarning').waitFor();
  await guardPage.screenshot({ path: `${SHOTS}7k-factor-code-outdated.png` });

  // New/switch/route-leave paths must not silently discard the edited source.
  await guardPage.getByRole('button', { name: '新建' }).click();
  const discardGuard = guardPage.locator('.ant-modal-confirm');
  await discardGuard.waitFor();
  const discardGuardButtons = discardGuard.locator('.ant-modal-confirm-btns button');
  await discardGuardButtons.first().waitFor();
  await guardPage.waitForTimeout(300);
  await guardPage.screenshot({ path: `${SHOTS}7l-factor-discard-guard.png` });
  await discardGuardButtons.first().click();
  if (!new URL(guardPage.url()).searchParams.has('factor')) {
    throw new Error('canceling the discard guard still replaced the current factor');
  }
  await guardPage.locator('a[href="/lab"]').click();
  await guardPage.locator('.ant-modal-confirm').waitFor();
  await guardPage.locator('.ant-modal-confirm-btns button').first().click();
  if (new URL(guardPage.url()).pathname !== '/factors') {
    throw new Error('canceling the route guard still left the factor workbench');
  }
  await guardPage.close();
  console.log(
    `[factor-history-e2e] restored=${firstReportId} switched=${secondReportId} options=${optionCount} guards=ok`,
  );
} finally {
  await context.close();
  await browser.close();
}
