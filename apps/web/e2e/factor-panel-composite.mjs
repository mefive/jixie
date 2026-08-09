import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
let compositeId = null;

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
      const report = await fetch(`/api/app/factor/reports/${id}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for panel composite report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-panel-composite-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '新建多因子合成' }).click();
  const modal = page.getByRole('dialog', { name: '新建多因子合成' });
  await modal.getByText('跨资产面板', { exact: true }).click();
  await modal.getByRole('textbox', { name: '名称' }).fill('动量低波多资产组合');
  await modal.getByText('跨资产120日动量', { exact: true }).waitFor();
  await modal.getByText('跨资产60日波动率', { exact: true }).waitFor();
  await modal.getByRole('button', { name: '保 存' }).click();
  await page.locator('.jx-factor-compositeWorkspace').waitFor({ timeout: 30_000 });

  const seeded = await api('/api/app/factors/catalog');
  const composite = seeded.body.find(
    (factor) => factor.kind === 'composite' && factor.label === '动量低波多资产组合',
  );
  if (
    seeded.status !== 200 ||
    !composite ||
    composite.analysisKind !== 'panel' ||
    composite.composite?.version !== 2 ||
    composite.composite.components?.length !== 2 ||
    composite.composite.components[1]?.direction !== 'negative'
  ) {
    throw new Error(`invalid panel composite catalog entry: ${JSON.stringify(seeded)}`);
  }
  compositeId = composite.key;

  const researchWindow = await api('/api/app/factor/research/window');
  const exploreEnd = researchWindow.body.exploreEnd;
  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: compositeId,
      spec: {
        version: 1,
        analysisKind: 'panel',
        start: '20200101',
        end: exploreEnd,
        observationFrequency: 'monthly',
        assets: [
          { assetId: '510300.SH', assetClass: 'cn_equity' },
          { assetId: '513100.SH', assetClass: 'overseas_equity' },
          { assetId: '511010.SH', assetClass: 'fixed_income' },
          { assetId: '511260.SH', assetClass: 'fixed_income' },
          { assetId: '511090.SH', assetClass: 'fixed_income' },
          { assetId: '518880.SH', assetClass: 'gold' },
          { assetId: '159985.SZ', assetClass: 'commodity' },
          { assetId: '159980.SZ', assetClass: 'commodity' },
          { assetId: '159981.SZ', assetClass: 'commodity' },
        ],
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
      researchIntent: {
        version: 1,
        mode: 'hypothesis',
        hypothesis: 'Momentum with a low-volatility overlay improves cross-asset ETF ranking.',
        expectedDirection: 'positive',
        primaryCriterion: { metric: 'panel_rank_ic_mean', operator: 'gt', value: 0 },
      },
    }),
  });
  if (run.status !== 200) {
    throw new Error(`panel composite run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await waitForReport(run.body.reportId);
  const frozenSource = JSON.parse(detail.factorCodeSnapshot);
  const report = detail.researchPayload?.report;
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'panel' ||
    frozenSource.kind !== 'panel_composite' ||
    frozenSource.definition?.version !== 2 ||
    frozenSource.components?.length !== 2 ||
    report?.periods < 50 ||
    report?.observations < 400 ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.longShortNetAnnualized)
  ) {
    throw new Error(`invalid panel composite report: ${JSON.stringify(detail)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(compositeId)}&report=${encodeURIComponent(run.body.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  const workspace = page.locator('.jx-factor-compositeWorkspace');
  await workspace.getByText('跨资产面板', { exact: false }).waitFor({ timeout: 30_000 });
  await workspace.getByText('跨资产120日动量', { exact: true }).waitFor();
  await workspace.getByText('跨资产60日波动率', { exact: true }).waitFor();
  await workspace.getByText('负向（越小越好）', { exact: true }).waitFor();
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-composite.png`, fullPage: true });

  const holdout = await api(`/api/app/factor/reports/${run.body.reportId}/holdout`, {
    method: 'POST',
  });
  if (holdout.status !== 200) {
    throw new Error(`panel composite holdout failed: ${JSON.stringify(holdout)}`);
  }
  const sealed = await waitForReport(holdout.body.reportId);
  if (
    sealed.status !== 'done' ||
    sealed.phase !== 'holdout' ||
    sealed.sealed !== true ||
    sealed.researchPayload != null ||
    sealed.factorCodeSnapshot !== detail.factorCodeSnapshot
  ) {
    throw new Error(`panel composite holdout snapshot drifted: ${JSON.stringify(sealed)}`);
  }

  if (browserErrors.length > 0) {
    throw new Error(browserErrors.join('\n'));
  }
  console.log(
    `[factor-panel-composite-e2e] PASS composite=${compositeId} report=${run.body.reportId} periods=${report.periods} observations=${report.observations}`,
  );
} finally {
  if (compositeId) {
    await page
      .evaluate(
        async (id) => fetch(`/api/app/factors/composites/${id}`, { method: 'DELETE' }),
        compositeId,
      )
      .catch(() => {});
  }
  await browser.close();
}
