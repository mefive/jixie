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
      body: JSON.stringify({ email: 'e2e-factor-robust-inference@test.com' }),
    });
    return response.status;
  });
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
          version: 6,
          freq: 'month',
          start: '20230101',
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
    throw new Error(`robust factor run failed: ${run.status} ${JSON.stringify(run.body)}`);
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
    throw new Error(`timed out waiting for robust factor report ${reportId}`);
  }, run.body.reportId);
  const inference = detail.payload?.robustInference;
  if (
    detail.status !== 'done' ||
    detail.spec?.version !== 6 ||
    detail.researchSpec?.protocol?.version !== 6 ||
    inference?.version !== 1 ||
    inference?.rankIc?.observations < 12 ||
    inference?.longShort?.equalGross?.observations < 12 ||
    inference?.longShort?.equalNet?.observations < 12 ||
    inference?.famaMacbeth?.status !== 'available' ||
    inference?.famaMacbeth?.controlSet !== 'cn_equity_style_v1' ||
    inference?.famaMacbeth?.controls?.join(',') !== 'size,value,momentum,quality'
  ) {
    throw new Error(
      `invalid robust report: ${JSON.stringify({
        status: detail.status,
        spec: detail.spec,
        inference,
      })}`,
    );
  }

  await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(run.body.reportId)}`, {
    waitUntil: 'domcontentloaded',
  });
  const card = page.getByTestId('factor-robust-inference');
  await card.waitFor({ timeout: 30_000 });
  for (const expected of [
    '稳健统计推断',
    'NW t 值',
    '95% 置信区间',
    'Fama–MacBeth 因子系数',
    '固定控制集 v1',
  ]) {
    await card.getByText(expected, { exact: false }).first().waitFor();
  }
  await card.screenshot({ path: `${SHOTS}8a-factor-robust-inference.png` });
  await page.screenshot({
    path: `${SHOTS}8b-factor-robust-inference-report.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-robust-e2e] report=${run.body.reportId} periods=${detail.payload.periods} ` +
      `fmb=${inference.famaMacbeth.periodsEstimated}/${inference.famaMacbeth.periodsConsidered} screenshots=2`,
  );
} finally {
  await context.close();
  await browser.close();
}
