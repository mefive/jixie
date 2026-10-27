import assert from 'node:assert/strict';
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
  if (message.type() === 'error') {
    browserErrors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-factor-scope@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.goto(`${BASE}/factors?factor=ep`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-paramSummary').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '更多设置' }).click();
  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();

  const selectSetting = async (label, option) => {
    const field = popover.locator('.jx-factor-paramField', { hasText: label });
    await field.locator('.ant-select').click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: option })
      .click();
  };
  assert.equal(await popover.getByText('排序范围', { exact: true }).count(), 0);
  assert.equal(await popover.getByRole('checkbox', { name: '行业', exact: true }).count(), 0);
  await selectSetting('研究范围', '沪深 300');
  for (const label of ['市值分层', '流动性分层']) {
    await popover.getByRole('checkbox', { name: label }).check();
  }
  await page.keyboard.press('Escape');
  for (const dropdown of await page.locator('.ant-select-dropdown').all()) {
    await dropdown.waitFor({ state: 'hidden' });
  }
  await popover.locator('.jx-factor-diagnosticChoices').waitFor();
  for (const expected of ['沪深 300']) {
    await page.locator('.jx-factor-paramSummary', { hasText: expected }).waitFor();
  }
  await page.screenshot({ path: `${SHOTS}7p-factor-evaluation-scope-settings.png` });

  const run = await page.evaluate(async () => {
    const response = await fetch('/api/app/factors/analyses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        factor: 'ep',
        spec: {
          version: 5,
          freq: 'month',
          start: '20240101',
          end: '20240630',
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
            universe: { kind: 'index', indexCode: '000300.SH' },
            membership: 'point_in_time',
            rankingScope: 'global',
            diagnostics: ['size_bucket', 'liquidity_bucket'],
          },
        },
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (run.status !== 200) {
    throw new Error(`factor scope run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  for (const unsupported of [
    { neutral: 'size_industry' },
    { rankingScope: 'within_industry' },
    { diagnostics: ['industry'] },
  ]) {
    const rejected = await context.request.post(`${BASE}/api/app/factors/analyses`, {
      data: {
        factor: 'ep',
        spec: {
          version: 1,
          freq: 'month',
          start: '20240101',
          end: '20240630',
          neutral: unsupported.neutral ?? 'none',
        },
        ...(unsupported.rankingScope || unsupported.diagnostics
          ? {
              spec: {
                version: 5,
                freq: 'month',
                start: '20240101',
                end: '20240630',
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
                  universe: { kind: 'index', indexCode: '000300.SH' },
                  membership: 'point_in_time',
                  rankingScope: 'global',
                  diagnostics: [],
                  ...unsupported,
                },
              },
            }
          : {}),
      },
    });
    assert.equal(rejected.status(), 400);
  }

  const detail = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const report = await fetch(`/api/app/factors/analysis-reports/${reportId}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for factor report ${reportId}`);
  }, run.body.reportId);
  const dimensions = new Set(detail.payload?.diagnostics?.map((slice) => slice.dimension));
  if (
    detail.status !== 'done' ||
    detail.spec?.version !== 5 ||
    detail.researchSpec?.analysisKind !== 'cross_sectional' ||
    detail.researchSpec?.protocol?.version !== 5 ||
    detail.researchPayload?.analysisKind !== 'cross_sectional' ||
    detail.payload?.methodology?.ranking?.kind !== 'global' ||
    !['size_bucket', 'liquidity_bucket'].every((dimension) => dimensions.has(dimension))
  ) {
    throw new Error(
      `invalid scope-aware report: ${JSON.stringify({
        status: detail.status,
        error: detail.error,
        version: detail.spec?.version,
        researchSpec: detail.researchSpec,
        researchPayloadKind: detail.researchPayload?.analysisKind,
        ranking: detail.payload?.methodology?.ranking,
        dimensions: [...dimensions],
      })}`,
    );
  }

  await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(run.body.reportId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.jx-factor-methodology', { hasText: '沪深 300' }).waitFor({
    timeout: 30_000,
  });
  const diagnostics = page.locator('.jx-factor-diagnostics');
  await diagnostics.waitFor();
  for (const expected of ['市值分层', '流动性分层']) {
    await diagnostics.getByText(expected, { exact: false }).first().waitFor();
  }
  await page.screenshot({
    path: `${SHOTS}7q-factor-evaluation-scope-report.png`,
    fullPage: true,
  });

  await page.getByText('EN', { exact: true }).last().click();
  await page.screenshot({ path: `${SHOTS}industry-retirement-factor-en.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}industry-retirement-factor-mobile.png`, fullPage: true });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-scope-e2e] report=${run.body.reportId} diagnostics=${detail.payload.diagnostics.length} screenshots=2`,
  );
} finally {
  await context.close();
  await browser.close();
}
