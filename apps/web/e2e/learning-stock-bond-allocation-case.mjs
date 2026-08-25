import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const START = '20180101';
const END = '20260730';
const COST = { slippageBps: 2, impactCoef: 0.1 };
const FACTOR_KEY = 'stock_bond_momentum_120';
const FACTOR_NAME = '学习案例：股债120日动量 Panel';
const FACTOR_CODE = `# 只在股票与固收 ETF 之间比较120日动量；不纳入黄金或商品。
from jixie import Factor, AssetFactorContext

factor = Factor.panel(
    name="股债120日动量",
    inputs=["etf.adjustedClose"],
    target_asset_classes=["equity", "fixed_income"],
    window=121,
)

@factor.compute
def compute(ctx: AssetFactorContext) -> float | None:
    current = ctx.value("etf.adjustedClose")
    previous = ctx.lag("etf.adjustedClose", 120)
    return current / previous - 1 if current is not None and previous is not None and previous > 0 else None
`;
const FACTOR_ASSETS = [
  { assetId: '510050.SH', assetClass: 'cn_equity' },
  { assetId: '510300.SH', assetClass: 'cn_equity' },
  { assetId: '563360.SH', assetClass: 'cn_equity' },
  { assetId: '510500.SH', assetClass: 'cn_equity' },
  { assetId: '512100.SH', assetClass: 'cn_equity' },
  { assetId: '563300.SH', assetClass: 'cn_equity' },
  { assetId: '159915.SZ', assetClass: 'cn_equity' },
  { assetId: '588000.SH', assetClass: 'cn_equity' },
  { assetId: '510880.SH', assetClass: 'cn_equity' },
  { assetId: '513100.SH', assetClass: 'overseas_equity' },
  { assetId: '159920.SZ', assetClass: 'overseas_equity' },
  { assetId: '513500.SH', assetClass: 'overseas_equity' },
  { assetId: '511010.SH', assetClass: 'fixed_income' },
  { assetId: '511260.SH', assetClass: 'fixed_income' },
  { assetId: '511090.SH', assetClass: 'fixed_income' },
];
const BASELINE_NAME = '学习案例：沪深300 ETF 买入持有基线';
const ALLOCATION_NAME = '学习案例：股债120日动量月度轮动';
const baselineCode = `const equity = '510300.SH';

export default defineStrategy({
  name: '${BASELINE_NAME}',
  watch: [equity],
  onBar(ctx) {
    if (ctx.price(equity) != null && ctx.shares(equity) === 0) {
      ctx.orderTargetPercent(equity, 0.95);
    }
  },
});`;
const allocationCode = `const equity = '510300.SH';
const bond5y = '511010.SH';
const bond10y = '511260.SH';
const assets = [equity, bond5y, bond10y];
let lastMonth = '';

export default defineStrategy({
  name: '${ALLOCATION_NAME}',
  watch: assets,
  factors: ['${FACTOR_KEY}'],
  onBar(ctx) {
    const month = ctx.period('monthly');
    if (month === lastMonth) return;
    lastMonth = month;
    const picks = assets
      .map(code => ({ code, score: ctx.factor('${FACTOR_KEY}', code) }))
      .filter(item => item.score != null)
      .sort((left, right) => right.score - left.score || left.code.localeCompare(right.code))
      .slice(0, 2)
      .map(item => item.code);
    if (picks.length === 2) ctx.equalWeight(picks);
    else ctx.setHoldings({});
  },
});`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
const page = await context.newPage();
const browserErrors = [];
let baselineId;
let allocationId;
let factorId;
let panelReport;
let publishedFactor;

page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-learning-stock-bond-${Date.now()}@test.com`);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新建' }).click();
  await page.getByRole('menuitem', { name: 'Panel 横截面因子' }).click();
  const createModal = page.getByTestId('new-factor-modal');
  await createModal.getByTestId('new-factor-name').fill(FACTOR_NAME);
  await createModal.getByTestId('new-factor-key').fill(FACTOR_KEY);
  await createModal.getByRole('button', { name: /创\s*建/ }).click();
  await page.waitForURL(/\/factors\?factor=[^&]+/, { timeout: 30_000 });
  factorId = new URL(page.url()).searchParams.get('factor');
  if (!factorId) {
    throw new Error(`custom Panel factor id missing from ${page.url()}`);
  }
  await api(page, `/api/app/factors/custom/${factorId}`, {
    method: 'POST',
    body: JSON.stringify({ code: FACTOR_CODE }),
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const resource = await api(page, `/api/app/factors/custom/${factorId}`);
  if (
    resource.analysisKind !== 'panel' ||
    resource.language !== 'python' ||
    JSON.stringify(resource.targetAssetClasses) !== JSON.stringify(['equity', 'fixed_income']) ||
    !resource.code.includes('target_asset_classes=["equity", "fixed_income"]')
  ) {
    throw new Error(`stock-bond Panel metadata was not restored: ${JSON.stringify(resource)}`);
  }

  const researchWindow = await api(page, '/api/app/factor/research/window');
  if (!researchWindow.exploreEnd) {
    throw new Error(`Panel research window is unavailable: ${JSON.stringify(researchWindow)}`);
  }
  const factorRun = await api(page, '/api/app/factor/analysis/run', {
    method: 'POST',
    body: JSON.stringify({
      factor: factorId,
      spec: {
        version: 1,
        analysisKind: 'panel',
        start: START,
        end: researchWindow.exploreEnd,
        observationFrequency: 'monthly',
        assets: FACTOR_ASSETS,
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: researchWindow.exploreEnd,
        },
        rankingScope: 'cross_asset',
        volatilityScaling: 'none',
        minimumAssetsPerPeriod: 3,
        portfolio: {
          topFraction: 0.25,
          bottomFraction: 0.25,
          transactionCostPerSide: 0.001,
        },
      },
      researchIntent: {
        version: 1,
        mode: 'hypothesis',
        hypothesis: '在股票与国债 ETF 之间，120日动量较高的资产，其下一持有期收益排名倾向更高。',
        rationale:
          '趋势延续可能跨股债存在，但资产类别差异、期限暴露和市场状态切换都可能使排序不稳定。',
        expectedDirection: 'positive',
        primaryCriterion: { metric: 'panel_rank_ic_mean', operator: 'gt', value: 0 },
      },
    }),
  });
  panelReport = await waitForReport(page, factorRun.reportId);
  const panel = panelReport.researchPayload?.report;
  if (
    panelReport.status !== 'done' ||
    panelReport.analysisKind !== 'panel' ||
    panelReport.researchPayload?.analysisKind !== 'panel' ||
    panel?.assets?.length !== FACTOR_ASSETS.length ||
    panel?.periods < 60 ||
    panel?.observations < 700 ||
    !Number.isFinite(panel?.rankIcMean) ||
    !Number.isFinite(panel?.longShortNetAnnualized)
  ) {
    throw new Error(`invalid stock-bond Panel report: ${JSON.stringify(panelReport)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(factorId)}&report=${encodeURIComponent(factorRun.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.getByText('Panel 排序证据', { exact: true }).waitFor();
  const publicationCard = page.getByTestId('factor-publication-card');
  if (await publicationCard.getByTestId('factor-publish').isDisabled()) {
    throw new Error('current stock-bond Panel report was incorrectly treated as outdated');
  }
  await publicationCard.getByTestId('factor-publish').click();
  const publishModal = page.locator('.ant-modal-confirm:visible');
  await publishModal.getByText(FACTOR_KEY, { exact: false }).waitFor();
  await publishModal.getByRole('button', { name: /发\s*布/ }).click();
  await publishModal.waitFor({ state: 'hidden', timeout: 30_000 });
  publishedFactor = await api(page, `/api/app/factors/custom/${factorId}`);
  if (
    publishedFactor.status !== 'published' ||
    publishedFactor.key !== FACTOR_KEY ||
    publishedFactor.approvedReportId !== factorRun.reportId ||
    publishedFactor.codeHash !== panelReport.factorCodeHash
  ) {
    throw new Error(`invalid published stock-bond Panel: ${JSON.stringify(publishedFactor)}`);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('factor-use-in-lab').waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-result').screenshot({
    path: `${OUTPUT}stock-bond-panel-factor-result.png`,
  });

  baselineId = await createStrategy(page, BASELINE_NAME, baselineCode);
  allocationId = await createStrategy(page, ALLOCATION_NAME, allocationCode);
  const baseline = await runBacktest(page, baselineId, config(BASELINE_NAME, baselineCode));
  const allocation = await runBacktest(page, allocationId, config(ALLOCATION_NAME, allocationCode));
  assertBacktest('baseline', baseline, 1);
  assertBacktest('allocation', allocation, 24);
  assertAllocationAnalysis(allocation, factorId, publishedFactor.codeHash);

  await captureLabResult(baselineId, `${OUTPUT}stock-bond-baseline-result.png`);
  await captureLabResult(allocationId, `${OUTPUT}stock-bond-allocation-result.png`);

  const allocationPanel = page.getByTestId('allocation-analysis');
  await allocationPanel.getByText('已与组合净值对账', { exact: true }).waitFor({
    timeout: 30_000,
  });
  await allocationPanel.scrollIntoViewIfNeeded();
  await allocationPanel.screenshot({ path: `${OUTPUT}stock-bond-attribution-result.png` });

  await allocationPanel.getByRole('tab', { name: '相关性' }).click();
  const correlationPanel = page.getByTestId('allocation-correlation');
  await correlationPanel.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  if ((await correlationPanel.locator('canvas').count()) < 2) {
    throw new Error('stock-bond correlation charts did not render');
  }
  await allocationPanel.screenshot({ path: `${OUTPUT}stock-bond-correlation-result.png` });

  await allocationPanel.getByRole('tab', { name: '利率环境' }).click();
  const rateRegimePanel = page.getByTestId('allocation-rate-regime');
  await rateRegimePanel.getByText(/状态只用于条件表现复盘/).waitFor({ timeout: 30_000 });
  await rateRegimePanel.getByText(/已分类 .* 个交易日/).waitFor();
  await allocationPanel.screenshot({ path: `${OUTPUT}stock-bond-rate-regime-result.png` });

  await allocationPanel.getByRole('tab', { name: '风险研究' }).click();
  const riskPanel = page.getByTestId('allocation-risk-research');
  await riskPanel.getByText('组合风险诊断', { exact: true }).waitFor({ timeout: 30_000 });
  await riskPanel.getByText('252 / 252', { exact: true }).waitFor();
  await riskPanel.getByText('国债曲线水平', { exact: true }).waitFor();
  await riskPanel.screenshot({ path: `${OUTPUT}stock-bond-market-risk-result.png` });

  await riskPanel.getByRole('tab', { name: '压力情景' }).click();
  await riskPanel.getByText('这是当前暴露下的线性压力估计，不是收益预测').waitFor();
  await riskPanel.getByText('2022 全球通胀冲击', { exact: true }).waitFor();
  await riskPanel.screenshot({ path: `${OUTPUT}stock-bond-scenarios-result.png` });

  if (browserErrors.length) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }

  console.log(
    `[learning-stock-bond-allocation] PASS factor=${factorSummary(panelReport)} ` +
      `baseline=${backtestSummary(baseline)} ` +
      `allocation=${backtestSummary(allocation)} analysis=${analysisSummary(allocation)}`,
  );
} finally {
  for (const strategyId of [baselineId, allocationId]) {
    if (strategyId) {
      await api(page, `/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  if (factorId) {
    const currentFactor = await api(page, `/api/app/factors/custom/${factorId}`).catch(() => null);
    if (currentFactor?.status === 'published') {
      await api(page, `/api/app/factors/custom/${factorId}/archive`, {
        method: 'POST',
      }).catch(() => {});
    } else {
      await api(page, `/api/app/factors/custom/${factorId}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  await context.close();
  await browser.close();
}

function config(name, code) {
  return {
    name,
    language: 'typescript',
    start: START,
    end: END,
    initialCash: 1_000_000,
    code,
    cost: COST,
  };
}

async function createStrategy(page, name, code) {
  const strategy = await api(page, '/api/app/strategies', {
    method: 'POST',
    body: JSON.stringify(config(name, code)),
  });
  if (!strategy.id) {
    throw new Error(`strategy creation failed for ${name}: ${JSON.stringify(strategy)}`);
  }
  return strategy.id;
}

async function runBacktest(page, strategyId, backtestConfig) {
  const started = await api(page, `/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    body: JSON.stringify(backtestConfig),
  });
  await waitForJob(page, `/api/app/strategy/backtest/${started.jobId}`, 300_000);
  const strategy = await api(page, `/api/app/strategies/${strategyId}`);
  if (!strategy.lastResult) {
    throw new Error(`backtest ${started.jobId} produced no result`);
  }
  return strategy.lastResult;
}

function assertBacktest(label, result, minimumTrades) {
  if (
    result.start !== START ||
    result.end !== END ||
    result.trades < minimumTrades ||
    !Number.isFinite(result.totalReturn) ||
    !Number.isFinite(result.annReturn) ||
    !Number.isFinite(result.maxDrawdown) ||
    !Number.isFinite(result.sharpe) ||
    !Number.isFinite(result.turnover) ||
    !Number.isFinite(result.totalFees) ||
    !Number.isFinite(result.totalSlippage)
  ) {
    throw new Error(`invalid ${label} result: ${JSON.stringify(result)}`);
  }
}

function assertAllocationAnalysis(result, expectedFactorId, expectedCodeHash) {
  const analysis = result.allocationAnalysis;
  const dependency = result.factorDependencies?.[0];
  const expectedClasses = ['cn_equity', 'fixed_income', 'overseas_equity'];
  const tradedAssets = new Set(['510300.SH', '511010.SH', '511260.SH']);
  const correlation60 = analysis?.correlations?.windows?.find((window) => window.window === 60);
  const correlation120 = analysis?.correlations?.windows?.find((window) => window.window === 120);
  const equityBond = correlation60?.series?.find(
    (series) =>
      [series.left, series.right].includes('cn_equity') &&
      [series.left, series.right].includes('fixed_income'),
  );
  const validEquityBondPoints = equityBond?.points?.filter((point) =>
    Number.isFinite(point.value),
  ).length;
  const returnContribution = analysis?.assets?.reduce(
    (sum, asset) => sum + asset.returnContribution,
    0,
  );
  const riskContribution = analysis?.assets?.reduce(
    (sum, asset) => sum + (asset.riskContribution ?? 0),
    0,
  );
  const rateRegimes = analysis?.rateRegimes;
  const risk = analysis?.risk;
  if (
    result.factorDependencies?.length !== 1 ||
    dependency?.factorId !== expectedFactorId ||
    dependency?.key !== FACTOR_KEY ||
    dependency?.analysisKind !== 'panel' ||
    dependency?.codeHash !== expectedCodeHash ||
    !dependency?.inputs?.includes('etf.adjustedClose') ||
    analysis?.reconciliation?.reconciled !== true ||
    JSON.stringify(analysis?.assetClasses?.map((row) => row.assetClass).sort()) !==
      JSON.stringify(expectedClasses) ||
    analysis?.assets?.length !== FACTOR_ASSETS.length ||
    analysis.assets.some(
      (asset) => asset.assetClass === 'gold' || asset.assetClass === 'commodity',
    ) ||
    analysis.assets.some(
      (asset) => !tradedAssets.has(asset.assetId) && Math.abs(asset.averageWeight) > 1e-8,
    ) ||
    [...tradedAssets].some(
      (assetId) => !analysis.assets.some((asset) => asset.assetId === assetId),
    ) ||
    analysis?.drift?.length < 24 ||
    analysis?.correlations?.methodology !== 'equal_weight_asset_class_returns' ||
    analysis?.correlations?.sampling !== 'month_end' ||
    correlation60?.assetClasses?.length !== expectedClasses.length ||
    correlation60?.minimumObservations !== 40 ||
    correlation60?.series?.length !== 3 ||
    correlation120?.minimumObservations !== 80 ||
    correlation120?.series?.length !== 3 ||
    !equityBond?.points?.length ||
    validEquityBondPoints / equityBond.points.length < 0.8 ||
    rateRegimes?.methodology !== 'cgb_10y_direction_and_10y_2y_relative_slope' ||
    rateRegimes?.pointInTime !== 'available_date' ||
    rateRegimes?.classifiedDays / rateRegimes?.totalDays < 0.95 ||
    rateRegimes?.states?.length < 2 ||
    !rateRegimes.states.every(
      (state) =>
        state.assetClasses.length === expectedClasses.length &&
        state.assetClasses.every(
          (assetClass) =>
            assetClass.observations > 0 &&
            Number.isFinite(assetClass.annualizedMeanReturn) &&
            Number.isFinite(assetClass.annualizedVolatility),
        ),
    ) ||
    risk?.market?.methodology !== 'rolling_multivariate_regression_ewma_covariance' ||
    risk.market.observations !== 252 ||
    risk.market.exposures?.length !== 9 ||
    risk.market.lineage?.pointInTimeEligible !== true ||
    risk?.macro?.methodology !== 'monthly_multivariate_regression_newey_west' ||
    risk.macro.observations !== 60 ||
    risk.macro.sensitivities?.length !== 5 ||
    risk.macro.pointInTimeEligible !== false ||
    risk.scenarios?.filter((scenario) => scenario.kind === 'deterministic').length !== 8 ||
    risk.scenarios?.filter((scenario) => scenario.kind === 'historical').length !== 3 ||
    Math.abs(returnContribution - result.totalReturn) > 1e-8 ||
    Math.abs(riskContribution - 1) > 1e-8
  ) {
    throw new Error(`invalid stock-bond allocation analysis: ${JSON.stringify(analysis)}`);
  }
}

async function waitForReport(page, reportId) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const report = await api(page, `/api/app/factor/reports/${reportId}`);
    if (report.status === 'done') {
      return report;
    }
    if (report.status === 'error' || report.status === 'stale') {
      throw new Error(`Panel report ${reportId} ended as ${report.status}: ${report.error ?? ''}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Panel report ${reportId} timed out`);
}

async function captureLabResult(strategyId, path) {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-result').screenshot({ path });
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

function backtestSummary(result) {
  return JSON.stringify({
    totalReturn: Number(result.totalReturn.toFixed(4)),
    annReturn: Number(result.annReturn.toFixed(4)),
    maxDrawdown: Number(result.maxDrawdown.toFixed(4)),
    sharpe: Number(result.sharpe.toFixed(3)),
    turnover: Number(result.turnover.toFixed(2)),
    trades: result.trades,
    fees: Number(result.totalFees.toFixed(2)),
    slippage: Number(result.totalSlippage.toFixed(2)),
  });
}

function factorSummary(detail) {
  const report = detail.researchPayload.report;
  return JSON.stringify({
    start: detail.researchSpec.start,
    end: detail.researchSpec.end,
    periods: report.periods,
    observations: report.observations,
    rankIcMean: Number(report.rankIcMean.toFixed(4)),
    longShortGrossAnnualized: Number(report.longShortGrossAnnualized.toFixed(4)),
    longShortNetAnnualized: Number(report.longShortNetAnnualized.toFixed(4)),
    turnover: Number(report.averageOneWayTurnover.toFixed(4)),
  });
}

function analysisSummary(result) {
  const analysis = result.allocationAnalysis;
  const correlation = analysis.correlations.windows.find((window) => window.window === 60);
  const equityBond = correlation.series.find(
    (series) =>
      [series.left, series.right].includes('cn_equity') &&
      [series.left, series.right].includes('fixed_income'),
  );
  const latestCorrelation = equityBond.points
    .filter((point) => Number.isFinite(point.value))
    .at(-1);
  return JSON.stringify({
    reconciliation: analysis.reconciliation,
    assetClasses: analysis.assetClasses.map((assetClass) => ({
      assetClass: assetClass.assetClass,
      averageWeight: Number(assetClass.averageWeight.toFixed(4)),
      returnContribution: Number(assetClass.returnContribution.toFixed(4)),
      riskContribution: Number(assetClass.riskContribution.toFixed(4)),
      costs: Number(assetClass.costs.toFixed(2)),
      netPnl: Number(assetClass.netPnl.toFixed(2)),
    })),
    latest60dEquityBondCorrelation: latestCorrelation
      ? { date: latestCorrelation.date, value: Number(latestCorrelation.value.toFixed(4)) }
      : null,
    latestRateRegime: analysis.rateRegimes.latest,
    rateRegimes: analysis.rateRegimes.states.map((state) => ({
      state: state.key,
      observations: state.observations,
      episodes: state.episodes,
      assetClasses: state.assetClasses.map((assetClass) => ({
        assetClass: assetClass.assetClass,
        annReturn: Number(assetClass.annualizedMeanReturn.toFixed(4)),
        volatility: Number(assetClass.annualizedVolatility.toFixed(4)),
        maximumEpisodeDrawdown: Number(assetClass.maximumEpisodeDrawdown.toFixed(4)),
      })),
    })),
    marketRisk: {
      asOfDate: analysis.risk.market.asOfDate,
      volatility:
        analysis.risk.market.annualizedPortfolioVolatility == null
          ? null
          : Number(analysis.risk.market.annualizedPortfolioVolatility.toFixed(4)),
      explainedVariance:
        analysis.risk.market.explainedVariance == null
          ? null
          : Number(analysis.risk.market.explainedVariance.toFixed(4)),
      exposures: analysis.risk.market.exposures.map((exposure) => ({
        factor: exposure.factor,
        coefficient: Number(exposure.coefficient.toFixed(4)),
        varianceContribution: Number(exposure.varianceContribution.toFixed(4)),
      })),
    },
    scenarios: analysis.risk.scenarios.map((scenario) => ({
      key: scenario.key,
      kind: scenario.kind,
      impact: Number(scenario.estimatedReturnImpact.toFixed(4)),
    })),
  });
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
