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

  // A real API run proves identical in-flight inputs reuse one report/job, and the UI can restore the
  // running report after refresh and after switching factors. Keep the range short so the E2E remains cheap.
  const runningFixture = await page.evaluate(async () => {
    const windowResponse = await fetch('/api/app/factor/research/window');
    const window = await windowResponse.json();
    const body = {
      factor: 'ep',
      spec: {
        version: 2,
        freq: 'month',
        start: '20200101',
        end: window.exploreEnd,
        neutral: 'none',
        universe: {
          minimumListingDays: 365,
          liquidityDropFraction: 0.25,
          minimumCandidates: 100,
        },
        missing: { minimumWindowCoverage: 2 / 3 },
        outliers: {
          factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
          forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
        },
        costs: {
          commissionPerSide: 0.00025,
          stampDutySellSide: 0.0005,
          slippagePerSide: 0.001,
        },
      },
      parentReportId: null,
      researchIntent: {
        version: 1,
        mode: 'exploratory',
        expectedDirection: 'unknown',
      },
    };
    const run = () =>
      fetch('/api/app/factor/analysis/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((response) => response.json());
    const [first, second] = await Promise.all([run(), run()]);
    return { first, second };
  });
  if (
    runningFixture.first.reportId !== runningFixture.second.reportId ||
    runningFixture.first.jobId !== runningFixture.second.jobId
  ) {
    throw new Error(
      `identical running variants were not reused: ${JSON.stringify(runningFixture)}`,
    );
  }
  await page.goto(
    `${BASE}/factors?factor=ep&report=${encodeURIComponent(runningFixture.first.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-factor-historyTrigger').waitFor({ timeout: 15000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (reportId) => new URL(location.href).searchParams.get('report') === reportId,
    runningFixture.first.reportId,
  );
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '账面市值比' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.waitForFunction(
    (reportId) => new URL(location.href).searchParams.get('report') === reportId,
    runningFixture.first.reportId,
  );
  await page.screenshot({ path: `${SHOTS}7m-factor-running-resume.png` });
  await page.waitForFunction(
    async (jobId) => {
      const job = await fetch(`/api/app/factor/analysis/job/${jobId}`).then((response) =>
        response.json(),
      );
      return job.status !== 'running';
    },
    runningFixture.first.jobId,
    { timeout: 180000 },
  );
  const firstReportId = new URL(page.url()).searchParams.get('report');
  const selectedDetail = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      const detail = await fetch(`/api/app/factor/reports/${reportId}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (detail.status === 'done' && detail.payload?.methodology) {
        return detail;
      }
      if (detail.status === 'error' || detail.status === 'stale') {
        return detail;
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    throw new Error(`report ${reportId} timed out`);
  }, firstReportId);
  if (selectedDetail.factor !== 'ep' || selectedDetail.id !== firstReportId) {
    throw new Error('default report did not restore by stable id');
  }
  if (
    selectedDetail.spec.version !== 2 ||
    !selectedDetail.payload?.methodology ||
    selectedDetail.payload.methodology.stages.length !== 4
  ) {
    throw new Error(
      `V2 report did not retain its methodology audit: ${JSON.stringify({
        status: selectedDetail.status,
        version: selectedDetail.spec?.version,
        hasPayload: !!selectedDetail.payload,
        hasMethodology: !!selectedDetail.payload?.methodology,
        stages: selectedDetail.payload?.methodology?.stages?.length,
      })}`,
    );
  }
  await page.locator('.jx-factor-methodology').waitFor();
  await page.screenshot({ path: `${SHOTS}7o-factor-methodology.png` });
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
  await guardPage.locator('.jx-factor-runButton').click();
  await guardPage.getByText('运行前研究卡').waitFor();
  await guardPage.screenshot({ path: `${SHOTS}7n-factor-research-card.png` });
  await guardPage.locator('.jx-factor-researchModal .ant-modal-close').click();
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

  // Real API lifecycle for the new discipline layer: hypothesis explore → sealed holdout → reveal.
  const holdoutLifecycle = await page.evaluate(async () => {
    const json = async (path, init) => {
      const response = await fetch(path, init);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`${path}: ${JSON.stringify(body)}`);
      }
      return body;
    };
    const waitForJob = async (jobId) => {
      const deadline = Date.now() + 180000;
      while (Date.now() < deadline) {
        const job = await json(`/api/app/factor/analysis/job/${jobId}`);
        if (job.status !== 'running') {
          if (job.status !== 'done') {
            throw new Error(`job ${jobId} ended as ${job.status}`);
          }
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      throw new Error(`job ${jobId} timed out`);
    };
    const window = await json('/api/app/factor/research/window');
    const nonce = Date.now();
    const code = `export default defineFactor({
  name: 'E2E holdout ${nonce}',
  compute: (bar) => (bar.close ? bar.close + ${nonce % 97} : null),
});\n`;
    const factor = await json('/api/app/factors/custom', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `E2E holdout ${nonce}`, code }),
    });
    const explore = await json('/api/app/factor/analysis/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        factor: factor.id,
        spec: {
          version: 2,
          freq: 'month',
          start: '20220101',
          end: window.exploreEnd,
          neutral: 'none',
          universe: {
            minimumListingDays: 365,
            liquidityDropFraction: 0.25,
            minimumCandidates: 100,
          },
          missing: { minimumWindowCoverage: 2 / 3 },
          outliers: {
            factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
            forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
          },
          costs: {
            commissionPerSide: 0.00025,
            stampDutySellSide: 0.0005,
            slippagePerSide: 0.001,
          },
        },
        researchIntent: {
          version: 1,
          mode: 'hypothesis',
          hypothesis: 'Higher close ranks predict higher next-month returns.',
          expectedDirection: 'positive',
          primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0 },
        },
      }),
    });
    await waitForJob(explore.jobId);
    const exploreDetail = await json(`/api/app/factor/reports/${explore.reportId}`);
    if (
      exploreDetail.spec.version !== 2 ||
      !exploreDetail.payload?.methodology ||
      exploreDetail.payload.methodology.dataCutoff > window.exploreEnd
    ) {
      throw new Error('V2 explore report is missing its reproducibility snapshot');
    }
    if (!exploreDetail.holdout?.eligible) {
      throw new Error(`explore was not holdout eligible: ${JSON.stringify(exploreDetail.holdout)}`);
    }
    const holdout = await json(`/api/app/factor/reports/${explore.reportId}/holdout`, {
      method: 'POST',
    });
    await waitForJob(holdout.jobId);
    const sealed = await json(`/api/app/factor/reports/${holdout.reportId}`);
    const sealedJob = await json(`/api/app/factor/analysis/job/${holdout.jobId}`);
    if (!sealed.sealed || sealed.payload || sealed.metrics || sealedJob.logs.length) {
      throw new Error('sealed holdout leaked result data');
    }
    const revealed = await json(`/api/app/factor/reports/${holdout.reportId}/reveal`, {
      method: 'POST',
    });
    if (!revealed.payload || !revealed.revealedAt || revealed.sealed) {
      throw new Error('revealed holdout did not return its result');
    }
    const revealedAgain = await json(`/api/app/factor/reports/${holdout.reportId}/reveal`, {
      method: 'POST',
    });
    if (revealedAgain.revealedAt !== revealed.revealedAt) {
      throw new Error('reveal was not idempotent');
    }
    await json(`/api/app/factors/custom/${factor.id}`, { method: 'DELETE' });
    const retained = await json(`/api/app/factor/reports/${holdout.reportId}`);
    if (!retained.payload) {
      throw new Error('deleting a custom factor erased its research audit trail');
    }
    return { exploreReportId: explore.reportId, holdoutReportId: holdout.reportId };
  });
  console.log(
    `[factor-history-e2e] restored=${firstReportId} switched=${secondReportId} options=${optionCount} holdout=${holdoutLifecycle.holdoutReportId} guards=ok`,
  );
} finally {
  await context.close();
  await browser.close();
}
