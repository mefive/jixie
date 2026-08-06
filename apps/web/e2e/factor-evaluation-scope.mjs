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
  await selectSetting('研究范围', '沪深 300');
  await selectSetting('排序范围', '申万一级行业内排序');
  for (const label of ['行业', '市值分层', '流动性分层']) {
    await popover.getByRole('checkbox', { name: label }).check();
  }
  await page.keyboard.press('Escape');
  await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
  await popover.locator('.jx-factor-diagnosticChoices').waitFor();
  for (const expected of ['沪深 300', '申万一级行业内排序']) {
    await page.locator('.jx-factor-paramSummary', { hasText: expected }).waitFor();
  }
  await page.screenshot({ path: `${SHOTS}7p-factor-evaluation-scope-settings.png` });

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
            universe: { kind: 'index', indexCode: '000300.SH' },
            membership: 'point_in_time',
            rankingScope: 'within_industry',
            diagnostics: ['industry', 'size_bucket', 'liquidity_bucket'],
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
    throw new Error(`factor scope run failed: ${run.status} ${JSON.stringify(run.body)}`);
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
  const dimensions = new Set(detail.payload?.diagnostics?.map((slice) => slice.dimension));
  if (
    detail.status !== 'done' ||
    detail.spec?.version !== 5 ||
    detail.payload?.methodology?.ranking?.kind !== 'within_industry_percentile' ||
    !['industry', 'size_bucket', 'liquidity_bucket'].every((dimension) => dimensions.has(dimension))
  ) {
    throw new Error(
      `invalid scope-aware report: ${JSON.stringify({
        status: detail.status,
        version: detail.spec?.version,
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
  await page.locator('.jx-factor-methodology', { hasText: '申万一级行业内排序' }).waitFor();
  const diagnostics = page.locator('.jx-factor-diagnostics');
  await diagnostics.waitFor();
  for (const expected of ['行业', '市值分层', '流动性分层']) {
    await diagnostics.getByText(expected, { exact: false }).first().waitFor();
  }
  await page.screenshot({
    path: `${SHOTS}7q-factor-evaluation-scope-report.png`,
    fullPage: true,
  });

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
