import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
const email = `e2e-factor-release-${Date.now()}@test.com`;
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') {
    browserErrors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async (loginEmail) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    return response.status;
  }, email);
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  const run = await page.evaluate(async () => {
    const response = await fetch('/api/app/factor/analysis/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        factor: 'ep',
        spec: {
          version: 5,
          freq: 'month',
          start: '20250101',
          end: '20250630',
          neutral: 'none',
          universe: {
            minimumListingDays: 365,
            liquidityDropFraction: 0.25,
            minimumCandidates: 100,
            excludeRiskWarnings: true,
            excludePendingDelisting: true,
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
          evaluationScope: {
            version: 1,
            universe: { kind: 'market', market: 'cn_a' },
            membership: 'point_in_time',
            rankingScope: 'global',
            diagnostics: [],
          },
        },
        parentReportId: null,
        researchIntent: {
          version: 1,
          mode: 'exploratory',
          expectedDirection: 'unknown',
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (run.status !== 200) {
    throw new Error(`factor release fixture failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const report = await fetch(`/api/app/factor/reports/${reportId}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for factor report ${reportId}`);
  }, run.body.reportId);
  if (detail.status !== 'done' || !detail.factorCodeHash) {
    throw new Error(`approved report is not publishable: ${JSON.stringify(detail)}`);
  }

  await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(detail.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  const releaseCard = page.getByTestId('factor-release-card');
  await releaseCard.waitFor({ timeout: 30_000 });
  await page.getByTestId('factor-release-publish').click();
  const publishModal = page.locator('[data-testid="factor-release-modal"] .ant-modal:visible');
  await publishModal.waitFor();
  await publishModal.getByText('自动推导', { exact: false }).waitFor();
  await publishModal.locator('.ant-select').click();
  const maturityDropdown = page.locator('.ant-select-dropdown:visible');
  await maturityDropdown.getByText('生产（运行门槛尚未开放）').waitFor();
  await page.screenshot({
    path: `${SHOTS}7r-factor-release-approval.png`,
    fullPage: true,
  });
  await publishModal.locator('.ant-select').click();
  await page.locator('.ant-select-dropdown').waitFor({ state: 'hidden' });
  await publishModal.locator('.ant-modal-footer .ant-btn-primary').click();
  await publishModal.waitFor({ state: 'hidden', timeout: 30_000 });

  const releaseItem = releaseCard
    .locator('.jx-factor-releaseItem')
    .filter({ hasText: detail.id.slice(-8) })
    .first();
  await releaseItem.waitFor({ timeout: 30_000 });
  for (const expected of ['ep@v', '实验', '生效中', '价格', '基本面', '股票', '逐资产输出']) {
    await releaseItem.getByText(expected, { exact: false }).first().waitFor();
  }

  const published = await page.evaluate(async (reportId) => {
    const releases = await fetch('/api/app/factors/releases', { cache: 'no-store' }).then(
      (response) => response.json(),
    );
    return releases.find((release) => release.approvedReportId === reportId);
  }, detail.id);
  if (
    !published ||
    published.lifecycle !== 'active' ||
    published.outputScope !== 'asset' ||
    published.targetAssetClasses.join(',') !== 'equity' ||
    published.inputDomains.join(',') !== 'fundamental,price'
  ) {
    throw new Error(`invalid derived release contract: ${JSON.stringify(published)}`);
  }
  await page.screenshot({
    path: `${SHOTS}7s-factor-release-lineage.png`,
    fullPage: true,
  });

  await releaseItem.getByRole('button', { name: '退役' }).click();
  const retireModal = page.locator('.ant-modal-confirm:visible');
  await retireModal.waitFor();
  await retireModal.locator('.ant-modal-confirm-btns .ant-btn-primary').click();
  await releaseItem.getByText('已退役').waitFor({ timeout: 30_000 });
  const retired = await page.evaluate(async (releaseId) => {
    const response = await fetch(`/api/app/factors/releases/${releaseId}`, { cache: 'no-store' });
    return response.json();
  }, published.id);
  if (retired.lifecycle !== 'retired') {
    throw new Error(`release was not retired: ${JSON.stringify(retired)}`);
  }

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-release-e2e] report=${detail.id} release=${published.releaseKey}@v${published.version} screenshots=2`,
  );
} finally {
  await context.close();
  await browser.close();
}
