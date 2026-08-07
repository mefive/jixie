import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { path, init },
  );

const waitForReport = (reportId) =>
  page.evaluate(async (id) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const report = await fetch(`/api/app/factor/reports/${id}`, { cache: 'no-store' }).then(
        (response) => response.json(),
      );
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for factor report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-factor-publication-${Date.now()}@test.com` }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const copied = await api('/api/app/factors/custom/ep/copy', { method: 'POST' });
  if (!copied.ok || copied.body.key !== 'ep_v2' || copied.body.status !== 'draft') {
    throw new Error(`preset copy failed: ${JSON.stringify(copied)}`);
  }

  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: copied.body.id,
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
      researchIntent: { version: 1, mode: 'exploratory', expectedDirection: 'unknown' },
    }),
  });
  if (!run.ok) {
    throw new Error(`factor report failed to start: ${JSON.stringify(run)}`);
  }
  const report = await waitForReport(run.body.reportId);
  if (report.status !== 'done' || !report.factorCodeHash) {
    throw new Error(`report is not publishable: ${JSON.stringify(report)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${copied.body.id}&report=${encodeURIComponent(report.id)}`,
    { waitUntil: 'domcontentloaded' },
  );
  const card = page.getByTestId('factor-publication-card');
  await card.waitFor({ timeout: 30_000 });
  await card.getByTestId('factor-publish').click();
  const publishModal = page.locator('.ant-modal-confirm:visible');
  await publishModal.getByText('ep_v2', { exact: false }).waitFor();
  await publishModal.getByRole('button', { name: /发\s*布/ }).click();
  await publishModal.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('.jx-factor-keyBar').getByText('已发布', { exact: true }).waitFor({
    timeout: 30_000,
  });

  const published = await api(`/api/app/factors/custom/${copied.body.id}`);
  if (
    !published.ok ||
    published.body.status !== 'published' ||
    published.body.strategyKey !== 'ep_v2' ||
    published.body.approvedReportId !== report.id ||
    published.body.codeHash !== report.factorCodeHash
  ) {
    throw new Error(`invalid published Factor: ${JSON.stringify(published)}`);
  }
  await page.screenshot({ path: `${SHOTS}7r-factor-publication.png`, fullPage: true });

  await card.getByRole('button', { name: '复制' }).click();
  await page.waitForURL(/\/factors\?factor=[^&]+$/, { timeout: 30_000 });
  const copyId = new URL(page.url()).searchParams.get('factor');
  const independentCopy = await api(`/api/app/factors/custom/${copyId}`);
  if (
    !independentCopy.ok ||
    independentCopy.body.key !== 'ep_v3' ||
    independentCopy.body.status !== 'draft' ||
    independentCopy.body.approvedReportId != null
  ) {
    throw new Error(
      `published copy was not an independent draft: ${JSON.stringify(independentCopy)}`,
    );
  }

  const archived = await api(`/api/app/factors/custom/${copied.body.id}/archive`, {
    method: 'POST',
  });
  if (!archived.ok || archived.body.status !== 'archived') {
    throw new Error(`Factor archive failed: ${JSON.stringify(archived)}`);
  }
  await page.goto(
    `${BASE}/factors?factor=${copied.body.id}&report=${encodeURIComponent(report.id)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-factor-keyBar').getByText('已归档', { exact: true }).waitFor({
    timeout: 30_000,
  });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  const archivedDetail = await api(`/api/app/factors/custom/${copied.body.id}`);
  if (archivedDetail.body.status !== 'archived' || archivedDetail.body.strategyKey !== undefined) {
    throw new Error(`Factor was not archived cleanly: ${JSON.stringify(archivedDetail)}`);
  }
  await page.screenshot({ path: `${SHOTS}7s-factor-archived.png`, fullPage: true });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-publication-e2e] factor=${copied.body.id} key=ep_v2 copy=ep_v3 report=${report.id} screenshots=2`,
  );
} finally {
  await context.close();
  await browser.close();
}
