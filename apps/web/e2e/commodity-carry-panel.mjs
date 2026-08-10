import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const FACTOR = 'commodity_futures_carry_v1';
const ASSETS = [
  { assetId: '518880.SH', assetClass: 'gold' },
  { assetId: '159980.SZ', assetClass: 'commodity' },
  { assetId: '159981.SZ', assetClass: 'commodity' },
  { assetId: '159985.SZ', assetClass: 'commodity' },
];
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
    throw new Error(`timed out waiting for commodity carry report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-commodity-carry-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const catalog = await api('/api/app/factors/catalog');
  const template = catalog.body.find((factor) => factor.key === FACTOR);
  if (
    catalog.status !== 200 ||
    template?.kind !== 'commodity' ||
    template?.analysisKind !== 'panel' ||
    template?.strategyKey != null ||
    JSON.stringify(template?.targetAssetClasses) !== JSON.stringify(['commodity'])
  ) {
    throw new Error(`invalid commodity carry catalog entry: ${JSON.stringify(template)}`);
  }

  const researchWindow = await api('/api/app/factor/research/window');
  const exploreEnd = researchWindow.body.exploreEnd;
  if (researchWindow.status !== 200 || !exploreEnd) {
    throw new Error(`research window unavailable: ${JSON.stringify(researchWindow)}`);
  }
  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: FACTOR,
      spec: {
        version: 1,
        analysisKind: 'panel',
        start: '20150101',
        end: exploreEnd,
        observationFrequency: 'monthly',
        assets: ASSETS,
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: exploreEnd,
        },
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
    throw new Error(`commodity carry run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await waitForReport(run.body.reportId);
  const report = detail.researchPayload?.report;
  const coveredAssets = report?.coverage?.byAsset?.map((row) => row.assetId).sort();
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'panel' ||
    detail.researchPayload?.analysisKind !== 'panel' ||
    !detail.factorCodeSnapshot?.includes('commodity.futures.annualizedLogCarry') ||
    report?.assets?.length !== ASSETS.length ||
    report?.periods < 50 ||
    report?.observations < 200 ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.rankIcirAnnual) ||
    !Number.isFinite(report?.longShortNetAnnualized) ||
    JSON.stringify(coveredAssets) !== JSON.stringify(ASSETS.map((asset) => asset.assetId).sort())
  ) {
    throw new Error(`invalid commodity carry report: ${JSON.stringify(detail)}`);
  }

  await page.goto(`${BASE}/factors?factor=${FACTOR}&report=${run.body.reportId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.getByText('输入：商品期货年化 Carry', { exact: true }).waitFor();
  await page.getByText('Panel 排序证据', { exact: true }).waitFor();
  await page.getByText('期货真实月合约的期限结构只用于生成 Carry 特征', { exact: false }).waitFor();
  if ((await page.getByTestId('factor-publication-card').count()) !== 0) {
    throw new Error('research-only commodity carry exposed a publication action');
  }

  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  const universe = page.getByTestId('panel-universe');
  await universe.waitFor();
  const universeText = await universe.innerText();
  if (
    !ASSETS.every((asset) => universeText.includes(asset.assetId)) ||
    universeText.includes('510300.SH') ||
    universeText.includes('511010.SH')
  ) {
    throw new Error(`commodity panel leaked the broad universe: ${universeText}`);
  }
  await page.keyboard.press('Escape');
  await page.screenshot({ path: `${SHOTS}commodity-carry-panel-report.png`, fullPage: true });

  if (browserErrors.length > 0) {
    throw new Error(browserErrors.join('\n'));
  }
  console.log(
    JSON.stringify(
      {
        reportId: run.body.reportId,
        periods: report.periods,
        observations: report.observations,
        rankIcMean: report.rankIcMean,
        rankIcirAnnual: report.rankIcirAnnual,
        longShortNetAnnualized: report.longShortNetAnnualized,
        screenshot: `${SHOTS}commodity-carry-panel-report.png`,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
