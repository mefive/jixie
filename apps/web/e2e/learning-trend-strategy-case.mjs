import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const BASELINE_NAME = '学习案例：沪深300 ETF 95% 买入持有';
const TREND_NAME = '学习案例：沪深300 ETF 均线趋势';
const START = '20150101';
const END = '20251231';
const SPLIT = '20201231';
const BASE_COST = { slippageBps: 2, impactCoef: 0.1 };
const STRESS_COST = { slippageBps: 10, impactCoef: 0.1 };
const baselineCode = `const code = '510300.SH';

export default defineStrategy({
  name: '${BASELINE_NAME}',
  watch: [code],
  onBar(ctx) {
    const price = ctx.price(code);
    if (price != null && ctx.shares(code) === 0) {
      ctx.orderTargetPercent(code, 0.95);
    }
  },
});`;
const trendCode = `const code = '510300.SH';

export default defineStrategy({
  name: '${TREND_NAME}',
  params: { lookback: 120 },
  watch: [code],
  onBar(ctx) {
    const price = ctx.price(code);
    const average = ctx.sma(code, ctx.params.lookback);
    if (price == null || average == null) return;

    const invested = ctx.shares(code) > 0;
    if (price > average && !invested) {
      ctx.orderTargetPercent(code, 0.95);
    } else if (price <= average && invested) {
      ctx.exit(code);
    }
  },
});`;

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

let baselineId;
let trendId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-learning-trend-${Date.now()}@test.com`);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  baselineId = await createStrategy(page, BASELINE_NAME, baselineCode, BASE_COST);
  trendId = await createStrategy(page, TREND_NAME, trendCode, BASE_COST);

  const baseline = await runBacktest(
    page,
    baselineId,
    config(BASELINE_NAME, baselineCode, BASE_COST),
  );
  const trendBase = await runBacktest(page, trendId, config(TREND_NAME, trendCode, BASE_COST));
  const trendStress = await runBacktest(page, trendId, config(TREND_NAME, trendCode, STRESS_COST));
  const trendRestored = await runBacktest(page, trendId, config(TREND_NAME, trendCode, BASE_COST));

  assertBacktest('baseline', baseline, { minimumTrades: 1 });
  assertBacktest('trend base', trendBase, { minimumTrades: 4 });
  assertBacktest('trend stress', trendStress, { minimumTrades: 4 });
  assertBacktest('trend restored', trendRestored, { minimumTrades: 4 });
  if (
    trendStress.totalSlippage <= trendBase.totalSlippage ||
    trendStress.finalValue >= trendBase.finalValue
  ) {
    throw new Error(
      `cost stress did not reduce the trend result: ${JSON.stringify({ trendBase, trendStress })}`,
    );
  }
  for (const metric of ['totalReturn', 'annReturn', 'maxDrawdown', 'sharpe', 'totalSlippage']) {
    if (Math.abs(trendRestored[metric] - trendBase[metric]) > 1e-10) {
      throw new Error(`restored base run drifted on ${metric}`);
    }
  }

  const scan = await runScan(page, trendId, config(TREND_NAME, trendCode, BASE_COST), {
    dimensions: [{ key: 'lookback', values: [20, 60, 120] }],
    splitDate: SPLIT,
    view: 'parameters',
  });
  if (
    scan.status !== 'done' ||
    scan.spec?.splitDate !== SPLIT ||
    scan.dataCutoff !== END ||
    scan.payload?.cells?.length !== 3
  ) {
    throw new Error(`invalid trend scan report: ${JSON.stringify(scan)}`);
  }
  for (const lookback of [20, 60, 120]) {
    const cell = scan.payload.cells.find((candidate) => candidate.params.lookback === lookback);
    if (
      !cell ||
      cell.inSample?.end !== SPLIT ||
      !String(cell.outOfSample?.start).startsWith('2021') ||
      cell.outOfSample?.end !== END
    ) {
      throw new Error(`invalid ${lookback}-day split result: ${JSON.stringify(cell)}`);
    }
    assertMetricSummary(`${lookback}-day in-sample`, cell.inSample);
    assertMetricSummary(`${lookback}-day out-of-sample`, cell.outOfSample);
  }

  await page.goto(`${BASE}/lab?id=${baselineId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-result').screenshot({
    path: `${OUTPUT}csi300-trend-baseline-result.png`,
  });

  await page.goto(`${BASE}/lab?id=${trendId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-result').screenshot({
    path: `${OUTPUT}csi300-trend-primary-result.png`,
  });
  await page.getByRole('tab', { name: '参数扫描' }).click();
  await page.locator('.jx-parameterScan-table').waitFor({ timeout: 30_000 });
  const rows = page.locator('.jx-parameterScan-table .ant-table-row[data-row-key]');
  if ((await rows.count()) !== 3) {
    throw new Error(`trend scan UI rendered ${await rows.count()} rows instead of three`);
  }
  await page.locator('.jx-parameterScan-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-parameterScan').screenshot({
    path: `${OUTPUT}csi300-trend-scan-result.png`,
  });

  if (browserErrors.length) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[learning-trend-strategy] PASS baseline=${summary(baseline)} trend=${summary(trendBase)} ` +
      `stress=${summary(trendStress)} scan=${JSON.stringify(
        scan.payload.cells.map((cell) => ({
          lookback: cell.params.lookback,
          inSample: compact(cell.inSample),
          outOfSample: compact(cell.outOfSample),
        })),
      )}`,
  );
} finally {
  for (const strategyId of [baselineId, trendId]) {
    if (!strategyId) {
      continue;
    }
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/strategies/${id}`, { method: 'DELETE' });
      }, strategyId)
      .catch(() => {});
  }
  await context.close();
  await browser.close();
}

function config(name, code, cost) {
  return {
    name,
    code,
    language: 'typescript',
    start: START,
    end: END,
    initialCash: 1_000_000,
    cost,
  };
}

async function createStrategy(page, name, code, cost) {
  const response = await api(page, '/api/app/strategies', {
    method: 'POST',
    body: JSON.stringify(config(name, code, cost)),
  });
  if (!response.id) {
    throw new Error(`strategy creation failed for ${name}`);
  }
  return response.id;
}

async function runBacktest(page, strategyId, backtestConfig) {
  const started = await api(page, `/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    body: JSON.stringify(backtestConfig),
  });
  await waitForJob(page, `/api/app/strategy/backtest/${started.jobId}`, 240_000);
  const strategy = await api(page, `/api/app/strategies/${strategyId}`);
  if (!strategy.lastResult) {
    throw new Error(`backtest ${started.jobId} produced no result`);
  }
  return strategy.lastResult;
}

async function runScan(page, strategyId, scanConfig, spec) {
  const started = await api(page, `/api/app/strategy/scans?strategyId=${strategyId}`, {
    method: 'POST',
    body: JSON.stringify({ config: scanConfig, spec }),
  });
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    const report = await api(page, `/api/app/strategy/scans/${started.reportId}`);
    if (report.status === 'done') {
      return report;
    }
    if (report.status === 'error') {
      throw new Error(`strategy scan failed: ${report.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`strategy scan ${started.reportId} timed out`);
}

async function waitForJob(page, path, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const job = await api(page, path);
    if (job.status === 'done') {
      return job;
    }
    if (job.status === 'error') {
      throw new Error(`${path} failed: ${job.error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${path} timed out`);
}

function assertBacktest(label, result, { minimumTrades }) {
  assertMetricSummary(label, result);
  if (result.start !== START || result.end !== END || result.trades < minimumTrades) {
    throw new Error(`invalid ${label} result: ${JSON.stringify(result)}`);
  }
}

function assertMetricSummary(label, result) {
  for (const metric of [
    'finalValue',
    'totalReturn',
    'annReturn',
    'maxDrawdown',
    'sharpe',
    'turnover',
    'totalFees',
    'totalSlippage',
  ]) {
    if (!Number.isFinite(result?.[metric])) {
      throw new Error(`${label} has invalid ${metric}: ${JSON.stringify(result)}`);
    }
  }
}

function compact(result) {
  return {
    annReturn: Number(result.annReturn.toFixed(4)),
    maxDrawdown: Number(result.maxDrawdown.toFixed(4)),
    sharpe: Number(result.sharpe.toFixed(3)),
    turnover: Number(result.turnover.toFixed(2)),
    trades: result.trades,
  };
}

function summary(result) {
  return JSON.stringify(compact(result));
}

async function api(page, path, init) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        headers: { 'content-type': 'application/json' },
        ...requestInit,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(`${requestPath}: ${JSON.stringify(body)}`);
      }
      return body;
    },
    { requestPath: path, requestInit: init },
  );
}

async function devLogin(page, email) {
  const status = await page.evaluate(async (loginEmail) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    return response.status;
  }, email);
  if (status !== 200) {
    throw new Error(`dev login failed for ${email}: ${status}`);
  }
}
