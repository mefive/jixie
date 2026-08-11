import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const FACTOR = 'commodity_warehouse_pressure_20';
const ASSETS = ['518880.SH', '159980.SZ', '159985.SZ'];
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
    throw new Error(`timed out waiting for warehouse-receipt report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-warehouse-receipt-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const catalog = await api('/api/app/factors/catalog');
  const template = catalog.body.find((factor) => factor.key === FACTOR);
  if (
    catalog.status !== 200 ||
    template?.kind !== 'commodity' ||
    template?.analysisKind !== 'time_series' ||
    template?.strategyKey != null ||
    JSON.stringify(template?.allowedAssets) !== JSON.stringify(ASSETS) ||
    JSON.stringify(template?.defaultAssets) !== JSON.stringify(ASSETS) ||
    !template?.unavailableAssetReasons?.['159981.SZ']?.includes('吨和桶')
  ) {
    throw new Error(`invalid warehouse-receipt catalog entry: ${JSON.stringify(template)}`);
  }

  await page.goto(`${BASE}/factors?factor=${FACTOR}`, { waitUntil: 'domcontentloaded' });
  await page.getByText('输入：商品仓单总量', { exact: true }).waitFor({ timeout: 30_000 });
  await page.getByText('窗口：21 个交易日', { exact: true }).waitFor();
  await page.getByRole('button', { name: '更多设置', exact: true }).click();
  const assetSelect = page.getByTestId('time-series-assets');
  await assetSelect.waitFor();
  const selectedAssets = await assetSelect.locator('.ant-select-selection-item').count();
  if (selectedAssets !== ASSETS.length) {
    throw new Error(`warehouse template selected ${selectedAssets} assets instead of 3`);
  }
  await page.getByTestId('time-series-asset-restriction').waitFor();
  await page.getByText('原油仓单同时存在吨和桶', { exact: false }).waitFor();
  await page.screenshot({
    path: `${SHOTS}commodity-warehouse-receipt-config.png`,
    fullPage: true,
  });
  await page.keyboard.press('Escape');

  const researchWindow = await api('/api/app/factor/research/window');
  const exploreEnd = researchWindow.body.exploreEnd;
  if (researchWindow.status !== 200 || !exploreEnd) {
    throw new Error(`research window unavailable: ${JSON.stringify(researchWindow)}`);
  }

  const invalidResponse = await page.request.post(`${BASE}/api/app/factor/analysis/run`, {
    data: {
      factor: FACTOR,
      spec: {
        version: 1,
        analysisKind: 'time_series',
        start: '20150105',
        end: exploreEnd,
        observationFrequency: 'daily',
        assets: [...ASSETS, '159981.SZ'],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: exploreEnd,
        },
        inference: { standardError: 'newey_west', lag: 'automatic' },
      },
      parentReportId: null,
      researchIntent: { version: 1, mode: 'exploratory', expectedDirection: 'unknown' },
    },
  });
  const invalidRun = { status: invalidResponse.status(), body: await invalidResponse.json() };
  if (invalidRun.status !== 400 || !invalidRun.body?.error?.message?.includes('159981.SZ')) {
    throw new Error(`SC asset was not rejected: ${JSON.stringify(invalidRun)}`);
  }

  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: FACTOR,
      spec: {
        version: 1,
        analysisKind: 'time_series',
        start: '20150105',
        end: exploreEnd,
        observationFrequency: 'daily',
        assets: ASSETS,
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: exploreEnd,
        },
        inference: { standardError: 'newey_west', lag: 'automatic' },
      },
      parentReportId: null,
      researchIntent: { version: 1, mode: 'exploratory', expectedDirection: 'unknown' },
    }),
  });
  if (run.status !== 200) {
    throw new Error(`warehouse-receipt run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await waitForReport(run.body.reportId);
  const report = detail.researchPayload?.report;
  const coveredAssets = report?.byAsset?.map((row) => row.assetId).sort();
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'time_series' ||
    detail.researchPayload?.analysisKind !== 'time_series' ||
    detail.researchSpec?.dataPolicy?.dataCutoff !== exploreEnd ||
    !detail.factorCodeSnapshot?.includes('commodity.warehouseReceipt.volume') ||
    report?.assets?.length !== ASSETS.length ||
    report?.periods < 1000 ||
    report?.observations < 4000 ||
    !report?.byAsset?.every(
      (row) =>
        row.observations > 500 &&
        Number.isFinite(row.correlation) &&
        Number.isFinite(row.regressionSlope) &&
        Number.isFinite(row.neweyWestTStat),
    ) ||
    JSON.stringify(coveredAssets) !== JSON.stringify(ASSETS.slice().sort())
  ) {
    throw new Error(`invalid warehouse-receipt report: ${JSON.stringify(detail)}`);
  }

  await page.goto(`${BASE}/factors?factor=${FACTOR}&report=${run.body.reportId}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('time-series-report').waitFor({ timeout: 30_000 });
  await page.getByText('输入：商品仓单总量', { exact: true }).waitFor();
  await page.getByText('逐资产信号表现', { exact: true }).waitFor();
  await page.getByText('仓单总量按下一上交所交易日可得', { exact: false }).waitFor();
  for (const asset of ['黄金 ETF', '有色金属期货 ETF', '豆粕期货 ETF']) {
    await page.getByText(asset, { exact: true }).first().waitFor();
  }
  if ((await page.getByText('能源化工期货 ETF', { exact: true }).count()) !== 0) {
    throw new Error('excluded crude-oil proxy appeared in the warehouse report');
  }
  if ((await page.getByTestId('factor-publication-card').count()) !== 0) {
    throw new Error('research-only warehouse template exposed a publication action');
  }
  await page.locator('.monaco-editor').waitFor({ state: 'visible', timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}commodity-warehouse-receipt-report.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(browserErrors.join('\n'));
  }
  console.log(
    JSON.stringify(
      {
        reportId: run.body.reportId,
        exploreEnd,
        periods: report.periods,
        observations: report.observations,
        byAsset: report.byAsset,
        screenshots: [
          `${SHOTS}commodity-warehouse-receipt-config.png`,
          `${SHOTS}commodity-warehouse-receipt-report.png`,
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
