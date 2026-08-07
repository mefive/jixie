import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const pageErrors = [];
let strategyId = null;
let deploymentId = null;
page.on('pageerror', (error) => pageErrors.push(error.message));

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
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
    throw new Error(`factor report ${id} timed out`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-strategy-factor-${Date.now()}@test.com` }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const factor = await api('/api/app/factors/custom/ep/copy', { method: 'POST' });
  if (!factor.ok) {
    throw new Error(`factor copy failed: ${JSON.stringify(factor)}`);
  }
  const reportRun = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: factor.body.id,
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
    throw new Error(`factor report failed: ${JSON.stringify(reportRun)}`);
  }
  const report = await waitForReport(reportRun.body.reportId);
  if (report.status !== 'done') {
    throw new Error(`factor report failed: ${JSON.stringify(report)}`);
  }

  const published = await api(`/api/app/factors/custom/${factor.body.id}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ approvedReportId: report.id }),
  });
  if (!published.ok || published.body.key !== factor.body.key) {
    throw new Error(`Factor publication failed: ${JSON.stringify(published)}`);
  }

  const strategyCode = [
    "let last = '';",
    'export default defineStrategy({',
    "  name: '不可变 Factor 策略',",
    `  factors: ['${factor.body.key}'],`,
    '  async onBar(ctx) {',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    "    const universe = (await ctx.universe('000300.SH')).minListDays(365);",
    `    const picks = universe.rankBy((_bar, code) => ctx.factor('${factor.body.key}', code)).top(10);`,
    '    if (picks.length) ctx.equalWeight(picks);',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: '不可变 Factor 策略',
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
    throw new Error(`strategy failed: ${JSON.stringify(strategy)}`);
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
    async ({ id, jobId }) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = await fetch(`/api/app/strategy/backtest/${jobId}?since=0`, {
          cache: 'no-store',
        }).then((response) => response.json());
        if (job.status === 'done') {
          return fetch(`/api/app/strategies/${id}`, { cache: 'no-store' }).then((response) =>
            response.json(),
          );
        }
        if (job.status === 'error' || job.status === 'stale') {
          throw new Error(`backtest ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`backtest ${jobId} timed out`);
    },
    { id: strategyId, jobId: backtest.body.jobId },
  );
  const dependency = completed.lastResult?.factorDependencies?.[0];
  if (
    completed.lastResult?.trades <= 0 ||
    completed.lastResult?.factorDependencies?.length !== 1 ||
    dependency.factorId !== factor.body.id ||
    dependency.key !== factor.body.key ||
    dependency.codeHash !== published.body.codeHash ||
    dependency.approvedReportId !== report.id
  ) {
    throw new Error(`backtest did not freeze Factor lineage: ${JSON.stringify(completed)}`);
  }

  const deployment = await api('/api/app/signals/deployments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategyId }),
  });
  if (!deployment.ok || deployment.body.factorDependencies?.[0]?.factorId !== factor.body.id) {
    throw new Error(`deployment did not freeze Factor lineage: ${JSON.stringify(deployment)}`);
  }
  deploymentId = deployment.body.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  const dependencyPanel = page.getByTestId('strategy-factor-dependencies');
  await dependencyPanel.waitFor({ timeout: 30_000 });
  await dependencyPanel.getByText(factor.body.key, { exact: false }).waitFor();
  await dependencyPanel.getByText(published.body.codeHash.slice(0, 12), { exact: false }).waitFor();
  const href = await dependencyPanel.locator('a').getAttribute('href');
  if (!href?.includes(`factor=${factor.body.id}`) || !href.includes(`report=${report.id}`)) {
    throw new Error(`Factor lineage link is invalid: ${href}`);
  }
  await page.screenshot({ path: `${SHOTS}8a-strategy-factor-dependency.png`, fullPage: true });

  const editor = page.locator('.jx-lab-code .monaco-editor');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type("ctx.factor('");
  await page.keyboard.press('Control+Space');
  const suggestion = page.locator('.suggest-widget.visible').getByText(factor.body.key, {
    exact: false,
  });
  await suggestion.first().waitFor({ timeout: 10_000 });
  await page
    .locator('.suggest-widget.visible')
    .getByText(published.body.name, { exact: false })
    .first()
    .waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}8b-strategy-factor-suggestion.png`, fullPage: true });

  if (pageErrors.length > 0) {
    throw new Error(`page errors: ${pageErrors.join('\n')}`);
  }
  console.log(
    `[strategy-factor-dependency-e2e] strategy=${strategyId} factor=${factor.body.key} trades=${completed.lastResult.trades} screenshots=2`,
  );
} finally {
  if (deploymentId) {
    await api(`/api/app/signals/deployments/${deploymentId}/pause`, { method: 'POST' }).catch(
      () => {},
    );
  }
  if (strategyId) {
    await api(`/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
