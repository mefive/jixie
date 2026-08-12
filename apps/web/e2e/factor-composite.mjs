import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let compositeId = null;

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-factor-composite@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '新建多因子合成' }).click();
  const modal = page.getByRole('dialog', { name: '新建多因子合成' });
  await modal.getByRole('textbox', { name: '名称' }).fill('e2e质量价值等权');
  await modal.getByRole('button', { name: '保 存' }).click();
  await page.locator('.jx-factor-compositeWorkspace').waitFor({ timeout: 15_000 });

  const seeded = await page.evaluate(async () => {
    const catalog = await fetch('/api/app/factors/catalog').then((response) => response.json());
    const composite = catalog.find(
      (factor) => factor.kind === 'composite' && factor.label === 'e2e质量价值等权',
    );
    if (!composite) {
      return { error: 'created composite missing from catalog' };
    }
    const definition = {
      version: 1,
      name: composite.label,
      standardization: 'rank',
      weighting: 'equal',
      components: [
        { factor: 'ep', direction: 'positive' },
        { factor: 'roe', direction: 'positive' },
      ],
    };
    const updated = await fetch(`/api/app/factors/composites/${composite.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition }),
    });
    if (!updated.ok) {
      return { error: `update failed: ${updated.status} ${await updated.text()}` };
    }
    return { id: composite.key, definition };
  });
  if (seeded.error) {
    throw new Error(seeded.error);
  }
  compositeId = seeded.id;

  await page.goto(`${BASE}/factors?factor=${encodeURIComponent(compositeId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.jx-factor-compositeWorkspace', { hasText: '盈利收益率' }).waitFor({
    timeout: 15_000,
  });
  await page.locator('.jx-factor-compositeWorkspace', { hasText: 'ROE质量' }).waitFor();

  const run = await page.evaluate(
    async ({ factor, definition }) => {
      const response = await fetch('/api/app/factor/analysis/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          factor,
          spec: {
            version: 6,
            freq: 'month',
            start: '20230101',
            end: '20250630',
            neutral: 'size_industry',
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
            inference: {
              version: 1,
              standardError: 'newey_west',
              lag: 'automatic',
              confidenceLevel: 0.95,
              famaMacbeth: {
                controlSet: 'cn_equity_style_v1',
                standardization: 'population_zscore',
                minimumPeriods: 12,
                minimumObservationsPerPeriod: 100,
                momentumLookbackTradingDays: 252,
                momentumSkipTradingDays: 21,
              },
            },
            composite: definition,
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
    },
    { factor: compositeId, definition: seeded.definition },
  );
  if (run.status !== 200) {
    throw new Error(`composite run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/app/factor/reports/${reportId}`, {
        cache: 'no-store',
      });
      if (response.ok) {
        const report = await response.json();
        if (['done', 'error', 'stale'].includes(report.status)) {
          return report;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for composite report ${reportId}`);
  }, run.body.reportId);
  if (
    detail.status !== 'done' ||
    detail.spec?.version !== 6 ||
    !detail.payload?.methodology ||
    detail.payload?.robustInference?.famaMacbeth?.status !== 'available'
  ) {
    throw new Error(`invalid composite report: ${JSON.stringify(detail)}`);
  }
  const frozen = JSON.parse(detail.factorCodeSnapshot);
  if (frozen.kind !== 'composite' || frozen.components.length !== 2) {
    throw new Error(`invalid frozen composite source: ${detail.factorCodeSnapshot}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(compositeId)}&report=${encodeURIComponent(run.body.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-factor-methodology', { hasText: 'v6' }).waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-methodology', { hasText: '2 个成分' }).waitFor();
  await page.getByTestId('factor-robust-inference').waitFor();
  await page.screenshot({ path: `${SHOTS}7f-factor-composite.png` });
} finally {
  if (compositeId) {
    await page.evaluate(
      (id) => fetch(`/api/app/factors/composites/${id}`, { method: 'DELETE' }),
      compositeId,
    );
  }
  await browser.close();
}
