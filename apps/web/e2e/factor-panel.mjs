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
      return { status: response.status, body: await response.json() };
    },
    { path, init },
  );

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-factor-panel-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: 'cross_asset_momentum_120',
      spec: {
        version: 1,
        analysisKind: 'panel',
        start: '20200101',
        end: '20250127',
        observationFrequency: 'monthly',
        assets: [
          { assetId: '510300.SH', assetClass: 'cn_equity' },
          { assetId: '513100.SH', assetClass: 'overseas_equity' },
          { assetId: '511010.SH', assetClass: 'fixed_income' },
          { assetId: '518880.SH', assetClass: 'gold' },
        ],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
        rankingScope: 'cross_asset',
        volatilityScaling: 'none',
        minimumAssetsPerPeriod: 3,
        portfolio: {
          topFraction: 0.25,
          bottomFraction: 0.25,
          transactionCostPerSide: 0.001,
        },
      },
      parentReportId: null,
      researchIntent: { version: 1, mode: 'exploratory', expectedDirection: 'unknown' },
    }),
  });
  if (run.status !== 200) {
    throw new Error(`panel run failed: ${run.status} ${JSON.stringify(run.body)}`);
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
    throw new Error(`timed out waiting for panel report ${reportId}`);
  }, run.body.reportId);
  const report = detail.researchPayload?.report;
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'panel' ||
    detail.researchSpec?.analysisKind !== 'panel' ||
    detail.researchPayload?.analysisKind !== 'panel' ||
    report?.assets?.length !== 4 ||
    report?.periods < 50 ||
    report?.observations !== report.periods * 4 ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.longShortNetAnnualized)
  ) {
    throw new Error(`invalid panel report: ${JSON.stringify(detail)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=cross_asset_momentum_120&report=${encodeURIComponent(run.body.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.getByText('跨资产排序证据', { exact: true }).waitFor();
  await page.getByText('纳指 ETF', { exact: true }).waitFor();
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-report.png` });

  await page.getByTestId('factor-use-in-lab').click();
  await page.waitForURL(/\/lab\?new=1&factorKey=cross_asset_momentum_120/, { timeout: 30_000 });
  const prompt = page.locator('.jx-lab-heroInput');
  await prompt.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const value = document.querySelector('.jx-lab-heroInput')?.value ?? '';
      return (
        value.includes('cross_asset_momentum_120') &&
        ['510300.SH', '513100.SH', '511010.SH', '518880.SH'].every((asset) => value.includes(asset))
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-panel-e2e] report=${run.body.reportId} periods=${report.periods} observations=${report.observations} rankIc=${report.rankIcMean.toFixed(4)} netLs=${report.longShortNetAnnualized.toFixed(4)} labPrefill=ok screenshot=1`,
  );
} finally {
  await context.close();
  await browser.close();
}
