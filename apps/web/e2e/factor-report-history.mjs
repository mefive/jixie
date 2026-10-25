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

  const api = (path, body) =>
    page.evaluate(
      async ({ path, body }) => {
        const response = await fetch(
          `/api/app/factors/${path}`,
          body === undefined
            ? undefined
            : {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              },
        );
        return { status: response.status, body: await response.json() };
      },
      { path, body },
    );
  const waitForReport = (id) =>
    page.evaluate(async (reportId) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const response = await fetch(`/api/app/factors/analysis-reports/${reportId}`);
        const detail = await response.json();
        if (detail.status === 'done') {
          return detail;
        }
        if (!response.ok || ['error', 'stale'].includes(detail.status)) {
          throw new Error(`report failed: ${JSON.stringify(detail)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      throw new Error(`report ${reportId} timed out`);
    }, id);
  const copied = await api('ep/copy', {});
  if (copied.status !== 200) {
    throw new Error(`copy failed: ${JSON.stringify(copied)}`);
  }
  const factorId = copied.body.id;
  const spec = {
    version: 2,
    freq: 'month',
    start: '20230101',
    end: '20241231',
    neutral: 'none',
    universe: { minimumListingDays: 365, liquidityDropFraction: 0.25, minimumCandidates: 100 },
    missing: { minimumWindowCoverage: 2 / 3 },
    outliers: {
      factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
      forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
    },
    costs: { commissionPerSide: 0.00025, stampDutySellSide: 0.0005, slippagePerSide: 0.001 },
  };
  const run = async () => {
    const submitted = await api('analyses', { factor: factorId, spec });
    if (submitted.status !== 200) {
      throw new Error(`submit failed: ${JSON.stringify(submitted)}`);
    }
    return waitForReport(submitted.body.reportId);
  };
  const obsolete = await run();
  const bound = await run();
  const retainedDraft = await api(`analysis-reports?factor=${factorId}`);
  if (
    retainedDraft.body.items.length !== 1 ||
    retainedDraft.body.items[0].id !== bound.id ||
    (await api(`analysis-reports/${obsolete.id}`)).status !== 404
  ) {
    throw new Error(`draft retention failed: ${JSON.stringify(retainedDraft)}`);
  }

  await page.goto(`${BASE}/factors?factor=${factorId}&report=${obsolete.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page
    .getByText(/报告不存在或已被清理|Report not found or already removed/)
    .first()
    .waitFor();
  if (new URL(page.url()).searchParams.get('report') !== obsolete.id) {
    throw new Error('a removed report link silently selected a different report');
  }
  await page.screenshot({ path: `${SHOTS}7g-factor-report-removed.png` });
  await page.goto(`${BASE}/factors?factor=${factorId}&report=${bound.id}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.jx-factor-methodology').waitFor();
  if (await page.locator('.jx-factor-historyTrigger').count()) {
    throw new Error('one retained draft report should not show a report selector');
  }

  const published = await api(`${factorId}/publish`, { approvedReportId: bound.id });
  if (published.status !== 200) {
    throw new Error(`publish failed: ${JSON.stringify(published)}`);
  }
  const latest = await run();
  if (
    latest.factorCodeHash !== bound.factorCodeHash ||
    latest.factorCodeSnapshot !== bound.factorCodeSnapshot
  ) {
    throw new Error('a published rerun changed the saved implementation');
  }
  const retained = await api(`analysis-reports?factor=${factorId}`);
  if (
    retained.body.items.length !== 2 ||
    !(await api(`analysis-reports/${bound.id}`)).body.payload
  ) {
    throw new Error(`publication report was not retained: ${JSON.stringify(retained)}`);
  }
  const firstReportId = latest.id;
  await page.goto(`${BASE}/factors?factor=${factorId}&report=${firstReportId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.jx-factor-methodology').waitFor();
  await page.screenshot({ path: `${SHOTS}7o-factor-methodology.png` });
  await page.screenshot({ path: `${SHOTS}7g-factor-history-button.png` });
  await page.locator('.jx-factor-historyTrigger').click();
  await page.locator('.jx-factor-historyModal').waitFor();
  await page.locator('.jx-factor-historyModal').getByText('发布绑定', { exact: true }).waitFor();
  await page
    .locator('.jx-factor-publicationLineage')
    .getByText(`发布绑定报告 ${bound.id.slice(-8)}`, { exact: true })
    .waitFor();
  const historyItems = page.locator('.jx-factor-historyItem');
  const optionCount = await historyItems.count();
  if (optionCount !== 2) {
    throw new Error(`expected two retained reports, got ${optionCount}`);
  }
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}7g-factor-history-desktop.png`, animations: 'disabled' });
  await historyItems.nth(1).click();
  const secondReportId = bound.id;
  await page.waitForFunction(
    (expected) => new URL(location.href).searchParams.get('report') === expected,
    secondReportId,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-methodology').waitFor();
  await page.waitForFunction(
    (expected) => new URL(location.href).searchParams.get('report') === expected,
    secondReportId,
  );

  await page.locator('.jx-factor-paramActions button').last().click();
  await page
    .locator('.jx-factor-paramPopover:visible .jx-factor-neutralSelect')
    .filter({ hasText: /^无$/ })
    .click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: '市值' })
    .first()
    .click();
  await page.locator('.jx-factor-reportWarning').waitFor();
  await page.screenshot({ path: `${SHOTS}7i-factor-report-outdated.png` });

  // 打开保留报告会恢复参数，因此未保存参数需要确认。
  // Opening a retained report restores its settings and requires confirmation for edited settings.
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
    spec: fixtureSpec,
    createdAt: '2026-07-14T08:00:00.000Z',
    error: 'E2E fixture',
  };
  await guardPage.route('**/api/app/factors/catalog', (route) =>
    route.fulfill({
      json: [{ key: 'e2e-factor', label: 'E2E 因子', kind: 'custom' }],
    }),
  );
  const pendingDraftSaves = [];
  const fixtureFactor = {
    id: 'e2e-factor',
    name: 'E2E 因子',
    code: fixtureCode,
    messages: [],
  };
  await guardPage.route('**/api/app/factors/e2e-factor', (route) => {
    // Keep autosave pending so both leave guards really see an unsaved draft.
    if (route.request().method() === 'PATCH') {
      pendingDraftSaves.push(route);
      return;
    }
    return route.fulfill({ json: fixtureFactor });
  });
  await guardPage.route('**/api/app/agent/turns/active**', (route) =>
    route.fulfill({ json: { turnId: null } }),
  );
  await guardPage.route('**/api/app/factors/analysis-reports/e2e-report', (route) =>
    route.fulfill({ json: { ...fixtureSummary, factorCodeSnapshot: fixtureCode } }),
  );
  await guardPage.route('**/api/app/factors/analysis-reports?*', (route) =>
    route.fulfill({ json: { items: [fixtureSummary] } }),
  );
  await guardPage.goto(`${BASE}/factors?factor=e2e-factor&report=e2e-report`, {
    waitUntil: 'domcontentloaded',
  });
  const editor = guardPage.locator('.jx-factor-code .monaco-editor');
  await editor.waitFor({ timeout: 15000 });
  await editor.click();
  await guardPage.keyboard.press('Meta+ArrowDown');
  const draftSaveRequest = guardPage.waitForRequest(
    (request) => request.method() === 'PATCH' && request.url().endsWith('/factors/e2e-factor'),
  );
  await guardPage.keyboard.type('// local edit');
  await draftSaveRequest;
  await guardPage.locator('.jx-factor-reportWarning').waitFor();
  await guardPage.screenshot({ path: `${SHOTS}7k-factor-code-outdated.png` });

  // New/switch/route-leave paths must not silently discard the edited source.
  await guardPage.getByRole('button', { name: '新建' }).click();
  await guardPage.getByRole('menuitem', { name: '股票横截面因子' }).click();
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
  await guardPage.locator('a[href="/strategy"]').click();
  await guardPage.locator('.ant-modal-confirm').waitFor();
  await guardPage.locator('.ant-modal-confirm-btns button').first().click();
  if (new URL(guardPage.url()).pathname !== '/factors') {
    throw new Error('canceling the route guard still left the factor workbench');
  }
  for (const route of pendingDraftSaves) {
    await route.fulfill({ json: { ...fixtureFactor, ...route.request().postDataJSON() } });
  }
  await guardPage.close();

  console.log(
    `[factor-history-e2e] restored=${firstReportId} switched=${secondReportId} options=${optionCount} guards=ok`,
  );
} finally {
  await context.close();
  await browser.close();
}
