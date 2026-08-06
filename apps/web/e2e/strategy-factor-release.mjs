import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
const email = `e2e-strategy-release-${Date.now()}@test.com`;
let strategyId = null;
page.on('pageerror', (error) => pageErrors.push(error.message));

const api = async (path, init) => {
  const response = await page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      const body = await response.json();
      return { ok: response.ok, status: response.status, body };
    },
    { path, init },
  );
  return response;
};

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

  const reportRun = await api('/api/app/factor/analysis/run', {
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
  if (!reportRun.ok) {
    throw new Error(`factor report failed to start: ${JSON.stringify(reportRun)}`);
  }
  const report = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const detail = await fetch(`/api/app/factor/reports/${reportId}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (['done', 'error', 'stale'].includes(detail.status)) {
        return detail;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`factor report ${reportId} timed out`);
  }, reportRun.body.reportId);
  if (report.status !== 'done') {
    throw new Error(`factor report is not publishable: ${JSON.stringify(report)}`);
  }

  const published = await api('/api/app/factors/releases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceKind: 'single',
      sourceId: 'ep',
      approvedReportId: report.id,
      maturity: 'experimental',
    }),
  });
  if (!published.ok || published.body.version !== 1) {
    throw new Error(`factor release failed: ${JSON.stringify(published)}`);
  }
  const factorRef = `release:${published.body.id}`;
  const strategyCode = [
    "let last = '';",
    'export default defineStrategy({',
    "  name: '不可变盈利收益率策略',",
    `  factors: ['${factorRef}'],`,
    '  async onBar(ctx) {',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    "    const universe = (await ctx.universe('000300.SH')).minListDays(365);",
    `    const picks = universe.rankBy((_bar, code) => ctx.factor('${factorRef}', code)).top(10);`,
    '    if (picks.length) ctx.equalWeight(picks);',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: '不可变盈利收益率策略',
    start: '20250101',
    end: '20250331',
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await api('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!strategy.ok || !strategy.body.id) {
    throw new Error(`strategy creation failed: ${JSON.stringify(strategy)}`);
  }
  strategyId = strategy.body.id;

  const backtest = await api(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!backtest.ok) {
    throw new Error(`backtest failed to start: ${JSON.stringify(backtest)}`);
  }
  const completed = await page.evaluate(
    async ({ strategyId, jobId }) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = await fetch(`/api/app/strategy/backtest/${jobId}?since=0`, {
          cache: 'no-store',
        }).then((response) => response.json());
        if (job.status === 'done') {
          return fetch(`/api/app/strategies/${strategyId}`, { cache: 'no-store' }).then(
            (response) => response.json(),
          );
        }
        if (job.status === 'error' || job.status === 'stale') {
          throw new Error(`backtest ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`backtest ${jobId} timed out`);
    },
    { strategyId, jobId: backtest.body.jobId },
  );
  const dependency = completed.lastResult?.factorReleases?.[0];
  if (
    completed.lastResult?.trades <= 0 ||
    completed.lastResult?.factorReleases?.length !== 1 ||
    dependency.releaseId !== published.body.id ||
    dependency.codeHash !== published.body.codeHash ||
    dependency.approvedReportId !== report.id
  ) {
    throw new Error(`backtest did not freeze release lineage: ${JSON.stringify(completed)}`);
  }

  const deployment = await api('/api/app/signals/deployments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategyId }),
  });
  if (deployment.status !== 400 || !JSON.stringify(deployment.body).includes('production')) {
    throw new Error(`research release deployment was not rejected: ${JSON.stringify(deployment)}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  const releasePanel = page.getByTestId('strategy-factor-releases');
  await releasePanel.waitFor({ timeout: 30_000 });
  for (const expected of ['ep@v1', published.body.codeHash.slice(0, 12), '实验 · 仅研究']) {
    await releasePanel.getByText(expected, { exact: false }).waitFor();
  }
  const releaseLink = releasePanel.locator('a');
  const href = await releaseLink.getAttribute('href');
  if (!href?.includes(`factor=ep`) || !href.includes(`report=${report.id}`)) {
    throw new Error(`release lineage link is invalid: ${href}`);
  }
  const deployButton = page.getByRole('button', { name: '部署上线' });
  if (!(await deployButton.isDisabled())) {
    throw new Error('research release strategy should not be deployable');
  }
  await page.screenshot({
    path: `${SHOTS}8a-strategy-factor-release.png`,
    fullPage: true,
  });

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join('\n')}`);
  }
  console.log(
    `[strategy-factor-release-e2e] strategy=${strategyId} release=ep@v1 trades=${completed.lastResult.trades} screenshot=1`,
  );
} finally {
  if (strategyId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/strategies/${id}`, { method: 'DELETE' });
      }, strategyId)
      .catch(() => {});
  }
  await context.close();
  await browser.close();
}
