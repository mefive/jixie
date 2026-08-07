import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
let factorId = null;
let strategyId = null;

const json = async (path, init) => {
  const response = await page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { path, init },
  );
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await json('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-factor-history-${Date.now()}@test.com` }),
  });

  const factor = await json('/api/app/factors/custom', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: 'e2e_turnover_history',
      name: 'e2e换手率历史',
      analysisKind: 'cross_sectional',
      code: [
        'export default defineFactor({',
        '  name: "e2e换手率历史",',
        '  window: 3,',
        '  compute(_bar, ctx) {',
        '    const values = ctx.history(3, "turnoverRateF");',
        '    if (values.length !== 3 || values.some((value) => value == null)) return null;',
        '    return values.reduce((sum, value) => sum + value, 0);',
        '  },',
        '});',
      ].join('\n'),
    }),
  });
  factorId = factor.id;

  const reportRun = await json('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: factorId,
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
  let report = null;
  for (let attempt = 0; attempt < 180; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    report = await json(`/api/app/factor/reports/${reportRun.reportId}`);
    if (report.status === 'done') {
      break;
    }
    if (report.status === 'error' || report.status === 'stale') {
      throw new Error(`factor analysis ${report.status}: ${report.error ?? ''}`);
    }
  }
  if (report?.status !== 'done') {
    throw new Error('factor analysis timed out');
  }
  await json(`/api/app/factors/custom/${factorId}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approvedReportId: report.id }),
  });
  const factorKey = factor.key;
  const strategyCode = [
    "let last = '';",
    'export default defineStrategy({',
    "  name: 'e2e换手率历史策略',",
    `  factors: ['${factorKey}'],`,
    '  async onBar(ctx) {',
    "    if (ctx.period('monthly') === last) return;",
    "    last = ctx.period('monthly');",
    "    const universe = (await ctx.universe('000300.SH')).minListDays(365);",
    '    await ctx.ensureBars(universe.codes());',
    '    const picks = universe',
    `      .rankBy((_bar, code) => ctx.factor('${factorKey}', code))`,
    '      .top(10);',
    '    if (picks.length) ctx.equalWeight(picks);',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: 'e2e换手率历史策略',
    start: '20240101',
    end: '20240331',
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await json('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  strategyId = strategy.id;

  const submitted = await json(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const job = await json(`/api/app/strategy/backtest/${submitted.jobId}?since=0`);
    if (job.status === 'done') {
      const saved = await json(`/api/app/strategies/${strategyId}`);
      const trades = saved.lastResult?.trades ?? 0;
      if (trades <= 0) {
        throw new Error(
          `turnover-history backtest completed without trades: ${JSON.stringify(saved)}`,
        );
      }
      await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
      await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
      await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 30_000 });
      await page.locator('.jx-lab-result canvas').first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOTS}8-factor-strategy-turnover-history.png` });
      console.log(
        `[factor-strategy-history] PASS factor=${factorKey} strategy=${strategyId} trades=${trades}`,
      );
      process.exitCode = 0;
      break;
    }
    if (job.status === 'error' || job.status === 'stale') {
      throw new Error(`turnover-history backtest ${job.status}: ${job.error ?? ''}`);
    }
    if (attempt === 119) {
      throw new Error('turnover-history backtest timed out');
    }
  }
} finally {
  if (strategyId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/strategies/${id}`, { method: 'DELETE' });
      }, strategyId)
      .catch(() => {});
  }
  if (factorId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/factors/custom/${id}/archive`, { method: 'POST' });
      }, factorId)
      .catch(() => {});
  }
  await browser.close();
}
