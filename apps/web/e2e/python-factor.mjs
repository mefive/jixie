import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
const suffix = Date.now().toString(36).slice(-7);
const email = `e2e-python-factor-${suffix}@test.com`;
const factorKey = `python_value_${suffix}`;
let factorId = '';

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
      const response = await fetch(`/api/app/factor/reports/${id}`, { cache: 'no-store' });
      const report = await response.json();
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for Python Factor report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByRole('menuitem', { name: '股票横截面因子' }).click();
  const modal = page.getByTestId('new-factor-modal');
  await modal.getByTestId('new-factor-name').fill('Python 盈利收益率');
  await modal.getByTestId('new-factor-key').fill(factorKey);
  await modal.getByRole('button', { name: /创\s*建/ }).click();
  await page.waitForURL(/\/factors\?factor=[^&]+/, { timeout: 30_000 });
  factorId = new URL(page.url()).searchParams.get('factor') ?? '';
  if (!factorId) {
    throw new Error(`Python Factor id missing from ${page.url()}`);
  }

  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByText('Python · py-v1', { exact: true }).waitFor();
  const resource = await api(`/api/app/factors/custom/${factorId}`);
  if (
    !resource.ok ||
    resource.body.language !== 'python' ||
    resource.body.runtimeVersion !== 'py-v1' ||
    !resource.body.code.includes('Factor.cross_sectional') ||
    !resource.body.code.includes('bar.pe_ttm')
  ) {
    throw new Error(`new Factor did not use Python by default: ${JSON.stringify(resource)}`);
  }

  const editor = page.locator('.jx-factor-code .monaco-editor');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\ndef probe(bar: FactorBar) -> float | None:\n    return bar.');
  await page.keyboard.press('Control+Space');
  const suggestion = page.locator('.suggest-widget.visible').getByText('pe_ttm', { exact: true });
  await suggestion.waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${SHOTS}13a-python-factor-sdk.png`, fullPage: true });
  await page.keyboard.press('Escape');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page
    .locator('.jx-factor-code .view-lines')
    .getByText('factor = Factor.cross_sectional', { exact: false })
    .waitFor({ timeout: 30_000 });

  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: factorId,
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
    throw new Error(`Python Factor report failed to start: ${JSON.stringify(run)}`);
  }
  const report = await waitForReport(run.body.reportId);
  if (
    report.status !== 'done' ||
    report.language !== 'python' ||
    report.runtimeVersion !== 'py-v1' ||
    !report.factorCodeSnapshot?.includes('Factor.cross_sectional')
  ) {
    throw new Error(`Python Factor report lost runtime lineage: ${JSON.stringify(report)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(factorId)}&report=${encodeURIComponent(report.id)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-factor-methodology').waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.getByText('Python · py-v1', { exact: true }).waitFor();
  await page
    .locator('.jx-factor-code .view-lines')
    .getByText('factor = Factor.cross_sectional', { exact: false })
    .waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}13b-python-factor-report.png`, fullPage: true });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[python-factor-e2e] PASS email=${email} factor=${factorId} report=${report.id} screenshots=2`,
  );
} finally {
  await context.close();
  await browser.close();
}
