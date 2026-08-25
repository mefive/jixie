import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const FACTOR_KEY = 'cgb_yield_decline_20';
const FACTOR_START = '20180101';
const ASSETS = ['511010.SH', '511260.SH', '511090.SH'];
const BOND = '511010.SH';
const STRATEGY_NAME = '学习案例：国债曲线每日信号';
const COST = { slippageBps: 2, impactCoef: 0.1 };
const strategyCode = `const bond = '${BOND}';

export default defineStrategy({
  name: '${STRATEGY_NAME}',
  watch: [bond],
  factors: ['${FACTOR_KEY}'],
  onBar(ctx) {
    const score = ctx.factor('${FACTOR_KEY}', bond);
    if (score != null && score > 0) {
      ctx.setHoldings({ [bond]: 0.8 });
    } else {
      ctx.setHoldings({});
    }
  },
});`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
let strategyId;
let deploymentId;

page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-learning-cgb-signal-${Date.now()}@test.com`);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  const researchWindow = await api(page, '/api/app/factor/research/window');
  if (!researchWindow.exploreEnd || !researchWindow.holdoutStart || !researchWindow.holdoutEnd) {
    throw new Error(`Factor research window is unavailable: ${JSON.stringify(researchWindow)}`);
  }

  const factorRun = await api(page, '/api/app/factor/analysis/run', {
    method: 'POST',
    body: JSON.stringify({
      factor: FACTOR_KEY,
      spec: factorSpec(researchWindow.exploreEnd),
      researchIntent: {
        version: 1,
        mode: 'hypothesis',
        hypothesis:
          '当可得的中国国债 10 年期收益率在过去 20 个交易观察中下降时，国债 ETF 未来 20 个交易日收益倾向更高。',
        rationale:
          '收益率下降通常对应债券价格上升，但 ETF 久期、票息、曲线形变、交易成本和发布时间差异都可能削弱关系。',
        expectedDirection: 'positive',
        primaryCriterion: {
          metric: 'time_series_median_newey_west_t',
          operator: 'gt',
          value: 1.96,
        },
      },
    }),
  });
  const explore = await waitForReport(page, factorRun.reportId);
  assertFactorReport('explore', explore, researchWindow.exploreEnd);
  if (!explore.holdout?.eligible) {
    throw new Error(`Factor report is not holdout eligible: ${JSON.stringify(explore.holdout)}`);
  }

  const holdoutRun = await api(page, `/api/app/factor/reports/${factorRun.reportId}/holdout`, {
    method: 'POST',
  });
  const sealed = await waitForReport(page, holdoutRun.reportId);
  const sealedJob = await api(page, `/api/app/factor/analysis/job/${holdoutRun.jobId}`);
  if (
    sealed.phase !== 'holdout' ||
    sealed.status !== 'done' ||
    !sealed.sealed ||
    sealed.researchPayload ||
    sealed.payload ||
    sealed.metrics ||
    sealedJob.logs?.length
  ) {
    throw new Error(`sealed holdout leaked evidence: ${JSON.stringify({ sealed, sealedJob })}`);
  }
  const holdout = await api(page, `/api/app/factor/reports/${holdoutRun.reportId}/reveal`, {
    method: 'POST',
  });
  if (
    holdout.phase !== 'holdout' ||
    holdout.sealed ||
    !holdout.revealedAt ||
    holdout.researchSpec?.start !== researchWindow.holdoutStart ||
    holdout.researchSpec?.end !== researchWindow.holdoutEnd
  ) {
    throw new Error(`invalid revealed holdout: ${JSON.stringify(holdout)}`);
  }
  assertFactorReport('holdout', holdout, researchWindow.holdoutEnd, {
    start: researchWindow.holdoutStart,
  });

  await captureFactor(
    factorRun.reportId,
    `${OUTPUT}cgb-signal-factor-explore-result.png`,
    '逐资产信号表现',
  );
  await captureFactor(
    holdoutRun.reportId,
    `${OUTPUT}cgb-signal-factor-holdout-result.png`,
    '首次揭示',
  );

  const config = {
    name: STRATEGY_NAME,
    language: 'typescript',
    start: FACTOR_START,
    end: researchWindow.holdoutEnd,
    initialCash: 1_000_000,
    code: strategyCode,
    cost: COST,
  };
  const strategy = await api(page, '/api/app/strategies', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!strategy.id) {
    throw new Error(`strategy creation failed: ${JSON.stringify(strategy)}`);
  }
  strategyId = strategy.id;

  const backtestRun = await api(page, `/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    body: JSON.stringify(config),
  });
  await waitForJob(page, `/api/app/strategy/backtest/${backtestRun.jobId}`, 240_000);
  const savedStrategy = await api(page, `/api/app/strategies/${strategyId}`);
  const backtest = savedStrategy.lastResult;
  const dependency = backtest?.factorDependencies?.[0];
  if (
    !backtest ||
    backtest.start !== FACTOR_START ||
    backtest.end !== researchWindow.holdoutEnd ||
    backtest.trades < 2 ||
    !Number.isFinite(backtest.annReturn) ||
    !Number.isFinite(backtest.maxDrawdown) ||
    !Number.isFinite(backtest.sharpe) ||
    !Number.isFinite(backtest.turnover) ||
    dependency?.key !== FACTOR_KEY ||
    !dependency.inputs?.includes('rates.cgb.yield.10y')
  ) {
    throw new Error(`invalid backtest or Factor lineage: ${JSON.stringify(savedStrategy)}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('strategy-factor-dependencies').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-result').screenshot({
    path: `${OUTPUT}cgb-signal-backtest-result.png`,
  });

  const deployButton = page.getByRole('button', { name: '部署上线' });
  await deployButton.waitFor({ timeout: 30_000 });
  const deploymentResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/deployments',
  );
  await deployButton.click();
  const deploymentHttp = await deploymentResponse;
  const deployment = await deploymentHttp.json();
  if (!deploymentHttp.ok() || !deployment.id) {
    throw new Error(`deployment failed: ${deploymentHttp.status()} ${JSON.stringify(deployment)}`);
  }
  deploymentId = deployment.id;
  if (
    deployment.factorDependencies?.[0]?.key !== FACTOR_KEY ||
    !deployment.factorDependencies[0].inputs?.includes('rates.cgb.yield.10y')
  ) {
    throw new Error(`deployment did not freeze Factor lineage: ${JSON.stringify(deployment)}`);
  }

  const signalRun = await api(page, '/api/app/signals/run', {
    method: 'POST',
    body: JSON.stringify({ deploymentId, tradeDate: researchWindow.holdoutEnd }),
  });
  if (signalRun.jobId) {
    await waitForJob(page, `/api/app/signals/jobs/${signalRun.jobId}`, 240_000);
  }

  await page.goto(`${BASE}/signals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: STRATEGY_NAME }).waitFor({ timeout: 30_000 });
  await page.getByTestId('signal-factor-inputs').waitFor({ timeout: 30_000 });
  await page.getByText(FACTOR_KEY, { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.jx-signals-executionChart canvas');
    return canvas instanceof HTMLCanvasElement && canvas.getBoundingClientRect().width > 500;
  });

  const today = await api(page, '/api/app/signals/today');
  const entry = today.find((item) => item.deployment.id === deploymentId);
  const factorInput = entry?.run?.factorInputs?.find((item) => item.key === FACTOR_KEY);
  const decision = factorInput?.decisionObservations?.find((item) => item.assetId === BOND);
  if (
    entry?.run?.status !== 'done' ||
    entry.run.tradeDate !== researchWindow.holdoutEnd ||
    entry.run.dataCutoff !== researchWindow.holdoutEnd ||
    entry.run.execDate <= entry.run.tradeDate ||
    !Number.isFinite(decision?.value)
  ) {
    throw new Error(`invalid durable daily signal: ${JSON.stringify(entry)}`);
  }
  await page.locator('.jx-signals-run').screenshot({
    path: `${OUTPUT}cgb-signal-daily-result.png`,
  });

  if (browserErrors.length) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }

  console.log(
    `[learning-cgb-signal] PASS explore=${factorSummary(explore)} ` +
      `holdout=${factorSummary(holdout)} backtest=${backtestSummary(backtest)} ` +
      `signal=${JSON.stringify({
        tradeDate: entry.run.tradeDate,
        execDate: entry.run.execDate,
        dataCutoff: entry.run.dataCutoff,
        score: Number(decision.value.toFixed(4)),
        signals: entry.run.signals?.length ?? 0,
      })}`,
  );
} finally {
  if (deploymentId) {
    await api(page, `/api/app/signals/deployments/${deploymentId}/pause`, {
      method: 'POST',
    }).catch(() => {});
  }
  if (strategyId) {
    await api(page, `/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
  }
  await context.close();
  await browser.close();
}

function factorSpec(end) {
  return {
    version: 1,
    analysisKind: 'time_series',
    start: FACTOR_START,
    end,
    observationFrequency: 'daily',
    assets: ASSETS,
    target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
    dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: end },
    inference: { standardError: 'newey_west', lag: 'automatic' },
  };
}

function assertFactorReport(label, detail, end, expected = {}) {
  const report = detail.researchPayload?.report;
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'time_series' ||
    detail.researchPayload?.analysisKind !== 'time_series' ||
    detail.researchSpec?.start !== (expected.start ?? FACTOR_START) ||
    detail.researchSpec?.end !== end ||
    detail.researchSpec?.dataPolicy?.dataCutoff !== end ||
    report?.assets?.length !== ASSETS.length ||
    report?.observations < 100 ||
    report?.byAsset?.length !== ASSETS.length
  ) {
    throw new Error(`invalid ${label} Factor report: ${JSON.stringify(detail)}`);
  }
  for (const asset of report.byAsset) {
    for (const metric of ['correlation', 'regressionSlope', 'directionHitRate', 'neweyWestTStat']) {
      if (!Number.isFinite(asset[metric])) {
        throw new Error(`${label} ${asset.assetId} has invalid ${metric}`);
      }
    }
  }
}

async function captureFactor(reportId, path, expectedText) {
  await page.goto(`${BASE}/factors?factor=${FACTOR_KEY}&report=${encodeURIComponent(reportId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('time-series-report').waitFor({ timeout: 30_000 });
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-timeReport canvas').waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('.jx-factor-result').screenshot({ path });
}

async function waitForReport(page, reportId) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const report = await api(page, `/api/app/factor/reports/${reportId}`);
    if (report.status === 'done') {
      return report;
    }
    if (report.status === 'error' || report.status === 'stale') {
      throw new Error(`Factor report ${reportId} ended as ${report.status}: ${report.error ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Factor report ${reportId} timed out`);
}

async function waitForJob(page, path, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const job = await api(page, path);
    if (job.status === 'done') {
      return job;
    }
    if (job.status === 'error' || job.status === 'stale') {
      throw new Error(`${path} ended as ${job.status}: ${job.error ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${path} timed out`);
}

function factorSummary(detail) {
  const report = detail.researchPayload.report;
  const tStats = report.byAsset.map((asset) => asset.neweyWestTStat).sort((a, b) => a - b);
  const middle = Math.floor(tStats.length / 2);
  const medianT =
    tStats.length % 2 === 0 ? (tStats[middle - 1] + tStats[middle]) / 2 : tStats[middle];
  const meanHitRate =
    report.byAsset.reduce((sum, asset) => sum + asset.directionHitRate, 0) / report.byAsset.length;
  return JSON.stringify({
    start: detail.researchSpec.start,
    end: detail.researchSpec.end,
    periods: report.periods,
    observations: report.observations,
    medianT: Number(medianT.toFixed(3)),
    meanHitRate: Number(meanHitRate.toFixed(4)),
    byAsset: report.byAsset.map((asset) => ({
      asset: asset.assetId,
      correlation: Number(asset.correlation.toFixed(4)),
      t: Number(asset.neweyWestTStat.toFixed(3)),
      hitRate: Number(asset.directionHitRate.toFixed(4)),
      positiveStateReturn: optionalFixed(asset.positiveStateMeanReturn, 4),
      negativeStateReturn: optionalFixed(asset.negativeStateMeanReturn, 4),
    })),
  });
}

function backtestSummary(result) {
  return JSON.stringify({
    start: result.start,
    end: result.end,
    annReturn: Number(result.annReturn.toFixed(4)),
    maxDrawdown: Number(result.maxDrawdown.toFixed(4)),
    sharpe: Number(result.sharpe.toFixed(3)),
    turnover: Number(result.turnover.toFixed(2)),
    trades: result.trades,
    fees: Number(result.totalFees.toFixed(2)),
    slippage: Number(result.totalSlippage.toFixed(2)),
  });
}

function optionalFixed(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
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
