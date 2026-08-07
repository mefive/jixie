import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const ASSETS = ['510300.SH', '518880.SH', '511010.SH'];
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
const email = `e2e-time-series-strategy-${Date.now()}@test.com`;
let strategyId = null;
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') {
    browserErrors.push(`console: ${message.text()}`);
  }
});

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { path, init },
  );

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
      factor: 'etf_trend_20',
      spec: {
        version: 1,
        analysisKind: 'time_series',
        start: '20250101',
        end: '20250630',
        observationFrequency: 'daily',
        assets: ASSETS,
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: null },
        inference: { standardError: 'newey_west', lag: 'automatic' },
      },
      parentReportId: null,
      researchIntent: { version: 1, mode: 'exploratory', expectedDirection: 'positive' },
    }),
  });
  if (!reportRun.ok) {
    throw new Error(`time-series report failed: ${JSON.stringify(reportRun)}`);
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
    throw new Error(`time-series report ${reportId} timed out`);
  }, reportRun.body.reportId);
  if (report.status !== 'done') {
    throw new Error(`time-series report is not publishable: ${JSON.stringify(report)}`);
  }

  const published = await api('/api/app/factors/releases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sourceKind: 'single',
      sourceId: 'etf_trend_20',
      approvedReportId: report.id,
      maturity: 'experimental',
    }),
  });
  if (!published.ok || published.body.methodology?.analysisKind !== 'time_series') {
    throw new Error(`time-series release failed: ${JSON.stringify(published)}`);
  }

  await page.goto(`${BASE}/factors?factor=etf_trend_20&report=${encodeURIComponent(report.id)}`, {
    waitUntil: 'domcontentloaded',
  });
  const releaseCard = page.getByTestId('factor-release-card');
  await releaseCard.waitFor({ timeout: 30_000 });
  await releaseCard.getByText('可带入 ETF 策略研究回测', { exact: false }).waitFor();
  const useInLab = page.getByTestId('factor-release-use-in-lab');
  await useInLab.waitFor();
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}9d-time-series-release-to-lab.png`,
    fullPage: true,
  });

  await useInLab.click();
  await page.waitForURL(/\/lab\?new=1&factorRelease=/);
  const prompt = page.locator('.jx-lab-heroInput');
  await prompt.waitFor({ timeout: 30_000 });
  try {
    await page.waitForFunction(
      (releaseId) =>
        document.querySelector('.jx-lab-heroInput')?.value.includes(`release:${releaseId}`),
      published.body.id,
      { timeout: 30_000 },
    );
  } catch (error) {
    const releases = await api('/api/app/factors/releases');
    throw new Error(
      `Lab prefill timed out at ${page.url()}; releases=${JSON.stringify(releases)}; browserErrors=${browserErrors.join(' | ')}; ${error}`,
    );
  }
  const promptText = await prompt.inputValue();
  for (const expected of [
    `release:${published.body.id}`,
    ...ASSETS,
    'ctx.factor',
    'ctx.period',
    '研究回测',
  ]) {
    if (!promptText.includes(expected)) {
      throw new Error(`Lab prompt is missing ${expected}: ${promptText}`);
    }
  }
  await page.screenshot({
    path: `${SHOTS}9e-time-series-lab-prefill.png`,
    fullPage: true,
  });

  const factorRef = `release:${published.body.id}`;
  const strategyCode = [
    `const etfs = ${JSON.stringify(ASSETS)};`,
    "let last = '';",
    'export default defineStrategy({',
    "  name: 'ETF 时间序列因子轮动',",
    '  watch: etfs,',
    `  factors: ['${factorRef}'],`,
    '  onBar(ctx) {',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    '    const picks = etfs',
    `      .map(code => ({ code, score: ctx.factor('${factorRef}', code) }))`,
    '      .filter(item => item.score != null)',
    '      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))',
    '      .slice(0, 2)',
    '      .map(item => item.code);',
    '    if (picks.length === 2) ctx.equalWeight(picks);',
    '    else ctx.setHoldings({});',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: 'ETF 时间序列因子轮动',
    start: '20250101',
    end: '20250630',
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
    dependency?.releaseId !== published.body.id ||
    dependency?.codeHash !== published.body.codeHash
  ) {
    throw new Error(`time-series backtest lineage failed: ${JSON.stringify(completed)}`);
  }

  if (browserErrors.length > 0) {
    throw new Error(`browser errors before deployment gate: ${browserErrors.join('\n')}`);
  }

  const deployment = await api('/api/app/signals/deployments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ strategyId }),
  });
  if (deployment.status !== 400 || !JSON.stringify(deployment.body).includes('研究回测')) {
    throw new Error(`time-series deployment gate failed: ${JSON.stringify(deployment)}`);
  }
  // Chromium reports the intentional 400 gate as a generic failed-resource console line.
  browserErrors.length = 0;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  const releasePanel = page.getByTestId('strategy-factor-releases');
  await releasePanel.waitFor({ timeout: 30_000 });
  await releasePanel.getByText('etf_trend_20@v1', { exact: false }).waitFor();
  const deployButton = page.getByRole('button', { name: '部署上线' });
  if (!(await deployButton.isDisabled())) {
    throw new Error('time-series strategy should not deploy');
  }
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}9f-time-series-strategy-result.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[time-series-strategy-e2e] report=${report.id} release=${published.body.id} strategy=${strategyId} trades=${completed.lastResult.trades} screenshots=3`,
  );
} finally {
  if (strategyId) {
    await page
      .evaluate(async (id) => fetch(`/api/app/strategies/${id}`, { method: 'DELETE' }), strategyId)
      .catch(() => {});
  }
  await context.close();
  await browser.close();
}
