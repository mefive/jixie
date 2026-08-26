import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
const RESEARCH_START = '20150101';
const PANEL_FACTOR = 'commodity_futures_carry_v1';
const TIME_SERIES_FACTOR = 'commodity_futures_carry_time_series_v1';
const TIME_SERIES_ASSETS = ['518880.SH', '159980.SZ', '159981.SZ', '159985.SZ'];
const PANEL_ASSETS = [
  { assetId: '518880.SH', assetClass: 'gold' },
  { assetId: '159980.SZ', assetClass: 'commodity' },
  { assetId: '159981.SZ', assetClass: 'commodity' },
  { assetId: '159985.SZ', assetClass: 'commodity' },
];
const EXPECTED_WINDOW = {
  exploreEnd: '20250127',
  holdoutStart: '20250205',
  holdoutEnd: '20260730',
};
const EXPECTED_HEADLINE_EVIDENCE = {
  panelExploreRankIc: 0.0186,
  panelHoldoutRankIc: -0.0471,
  panelHoldoutNetAnnualized: 0.2543,
  timeSeriesExploreMedianT: 1.524,
  timeSeriesHoldoutMedianT: 0.52,
};
mkdirSync(OUTPUT, { recursive: true });

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

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-learning-commodity-carry-${Date.now()}@test.com`);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  const researchWindow = await api(page, '/api/app/factor/research/window');
  if (!researchWindow.exploreEnd || !researchWindow.holdoutStart || !researchWindow.holdoutEnd) {
    throw new Error(`Factor holdout window is unavailable: ${JSON.stringify(researchWindow)}`);
  }
  for (const [key, expected] of Object.entries(EXPECTED_WINDOW)) {
    if (researchWindow[key] !== expected) {
      throw new Error(
        `Commodity Carry evidence window changed: ${key}=${researchWindow[key]}, expected ${expected}`,
      );
    }
  }

  const panelRun = await runFactor(
    page,
    PANEL_FACTOR,
    panelSpec(researchWindow.exploreEnd),
    panelIntent(),
  );
  const panelExplore = await waitForReport(page, panelRun.reportId);
  assertPanelExplore(panelExplore, researchWindow);

  const timeSeriesRun = await runFactor(
    page,
    TIME_SERIES_FACTOR,
    timeSeriesSpec(researchWindow.exploreEnd),
    timeSeriesIntent(),
  );
  const timeSeriesExplore = await waitForReport(page, timeSeriesRun.reportId);
  assertTimeSeriesExplore(timeSeriesExplore, researchWindow);

  const researchSummary = await api(page, '/api/app/factor/research/summary');
  if (
    researchSummary.global?.exploreTestCount !== 2 ||
    researchSummary.global?.exploreRunCount !== 2 ||
    researchSummary.global?.expectedFalsePositivesAtFivePercent !== 0.1
  ) {
    throw new Error(`invalid multiple-testing ledger: ${JSON.stringify(researchSummary)}`);
  }

  const panelHoldoutRun = await createHoldout(page, panelRun.reportId);
  const timeSeriesHoldoutRun = await createHoldout(page, timeSeriesRun.reportId);
  const panelSealed = await waitForReport(page, panelHoldoutRun.reportId);
  const timeSeriesSealed = await waitForReport(page, timeSeriesHoldoutRun.reportId);
  await assertSealed(page, panelSealed, panelHoldoutRun.jobId, 'panel');
  await assertSealed(page, timeSeriesSealed, timeSeriesHoldoutRun.jobId, 'time series');

  const panelHoldout = await revealHoldout(page, panelHoldoutRun.reportId);
  const timeSeriesHoldout = await revealHoldout(page, timeSeriesHoldoutRun.reportId);
  assertPanelHoldout(panelHoldout, researchWindow);
  assertTimeSeriesHoldout(timeSeriesHoldout, researchWindow);

  const finalResearchSummary = await api(page, '/api/app/factor/research/summary');
  if (
    finalResearchSummary.global?.exploreTestCount !== 2 ||
    finalResearchSummary.global?.holdoutCount !== 2 ||
    finalResearchSummary.global?.revealedHoldoutCount !== 2 ||
    finalResearchSummary.global?.expectedFalsePositivesAtFivePercent !== 0.1
  ) {
    throw new Error(`invalid final research ledger: ${JSON.stringify(finalResearchSummary)}`);
  }

  const panelExploreSummary = panelSummary(panelExplore.researchPayload.report);
  const panelHoldoutSummary = panelSummary(panelHoldout.researchPayload.report);
  const timeSeriesExploreSummary = timeSeriesSummary(timeSeriesExplore.researchPayload.report);
  const timeSeriesHoldoutSummary = timeSeriesSummary(timeSeriesHoldout.researchPayload.report);
  const headlineEvidence = {
    panelExploreRankIc: panelExploreSummary.rankIcMean,
    panelHoldoutRankIc: panelHoldoutSummary.rankIcMean,
    panelHoldoutNetAnnualized: panelHoldoutSummary.longShortNetAnnualized,
    timeSeriesExploreMedianT: timeSeriesExploreSummary.medianNeweyWestT,
    timeSeriesHoldoutMedianT: timeSeriesHoldoutSummary.medianNeweyWestT,
  };
  if (JSON.stringify(headlineEvidence) !== JSON.stringify(EXPECTED_HEADLINE_EVIDENCE)) {
    throw new Error(
      `Published Commodity Carry evidence changed: ${JSON.stringify(headlineEvidence)}`,
    );
  }

  await captureReport({
    factor: PANEL_FACTOR,
    reportId: panelRun.reportId,
    testId: 'panel-report',
    expectedText: 'Panel 排序证据',
    path: `${OUTPUT}commodity-carry-panel-explore-result.png`,
  });
  await captureReport({
    factor: PANEL_FACTOR,
    reportId: panelHoldoutRun.reportId,
    testId: 'panel-report',
    expectedText: '预设主要标准',
    path: `${OUTPUT}commodity-carry-panel-holdout-result.png`,
  });
  await captureReport({
    factor: TIME_SERIES_FACTOR,
    reportId: timeSeriesRun.reportId,
    testId: 'time-series-report',
    expectedText: '逐资产信号表现',
    path: `${OUTPUT}commodity-carry-time-series-explore-result.png`,
  });
  await captureReport({
    factor: TIME_SERIES_FACTOR,
    reportId: timeSeriesHoldoutRun.reportId,
    testId: 'time-series-report',
    expectedText: '预设主要标准',
    path: `${OUTPUT}commodity-carry-time-series-holdout-result.png`,
  });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }

  console.log(
    JSON.stringify(
      {
        window: researchWindow,
        multipleTesting: finalResearchSummary.global,
        panelExplore: panelExploreSummary,
        panelHoldout: panelHoldoutSummary,
        timeSeriesExplore: timeSeriesExploreSummary,
        timeSeriesHoldout: timeSeriesHoldoutSummary,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}

function panelSpec(end) {
  return {
    version: 1,
    analysisKind: 'panel',
    start: RESEARCH_START,
    end,
    observationFrequency: 'monthly',
    assets: PANEL_ASSETS,
    target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
    dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: end },
    rankingScope: 'cross_asset',
    volatilityScaling: 'none',
    minimumAssetsPerPeriod: 3,
    portfolio: {
      topFraction: 0.25,
      bottomFraction: 0.25,
      transactionCostPerSide: 0.001,
    },
  };
}

function timeSeriesSpec(end) {
  return {
    version: 1,
    analysisKind: 'time_series',
    start: RESEARCH_START,
    end,
    observationFrequency: 'daily',
    assets: TIME_SERIES_ASSETS,
    target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
    dataPolicy: { pointInTime: true, revisionPolicy: 'as_available', dataCutoff: end },
    inference: { standardError: 'newey_west', lag: 'automatic' },
  };
}

function panelIntent() {
  return {
    version: 1,
    mode: 'hypothesis',
    hypothesis:
      '在黄金、铜、原油和豆粕的共同月末中，年化 Carry 更高的品种，其代理 ETF 下一持有期收益排名倾向更高。',
    rationale:
      'Backwardation 可能反映稀缺性或库存压力，但主力合约选择、类别 ETF 基差和换月会削弱这种关系。',
    expectedDirection: 'positive',
    primaryCriterion: { metric: 'panel_rank_ic_mean', operator: 'gt', value: 0 },
  };
}

function timeSeriesIntent() {
  return {
    version: 1,
    mode: 'hypothesis',
    hypothesis:
      '对每个商品自身而言，更高的年化 Carry 倾向对应其代理 ETF 更高的未来 20 个交易日收益。',
    rationale: '期限结构可能包含库存与供需信息，但不同商品机制和代理误差可能导致方向异质。',
    expectedDirection: 'positive',
    primaryCriterion: {
      metric: 'time_series_median_newey_west_t',
      operator: 'gt',
      value: 1.96,
    },
  };
}

async function runFactor(page, factor, spec, researchIntent) {
  return api(page, '/api/app/factor/analysis/run', {
    method: 'POST',
    body: JSON.stringify({ factor, spec, parentReportId: null, researchIntent }),
  });
}

async function createHoldout(page, reportId) {
  return api(page, `/api/app/factor/reports/${reportId}/holdout`, { method: 'POST' });
}

async function revealHoldout(page, reportId) {
  const revealed = await api(page, `/api/app/factor/reports/${reportId}/reveal`, {
    method: 'POST',
  });
  const repeated = await api(page, `/api/app/factor/reports/${reportId}/reveal`, {
    method: 'POST',
  });
  if (repeated.revealedAt !== revealed.revealedAt) {
    throw new Error(`holdout reveal was not idempotent for ${reportId}`);
  }
  return revealed;
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

function assertPanelExplore(report, window) {
  if (
    report.status !== 'done' ||
    report.phase !== 'explore' ||
    report.researchSpec?.analysisKind !== 'panel' ||
    report.researchSpec?.start !== RESEARCH_START ||
    report.researchSpec?.end !== window.exploreEnd ||
    report.researchIntent?.primaryCriterion?.metric !== 'panel_rank_ic_mean' ||
    report.researchIntent?.primaryCriterion?.value !== 0 ||
    !report.holdout?.eligible
  ) {
    throw new Error(`invalid panel explore protocol: ${JSON.stringify(report)}`);
  }
  assertPanelEvidence('panel explore', report.researchPayload?.report, 40, 150);
}

function assertTimeSeriesExplore(report, window) {
  if (
    report.status !== 'done' ||
    report.phase !== 'explore' ||
    report.researchSpec?.analysisKind !== 'time_series' ||
    report.researchSpec?.start !== RESEARCH_START ||
    report.researchSpec?.end !== window.exploreEnd ||
    report.researchIntent?.primaryCriterion?.metric !== 'time_series_median_newey_west_t' ||
    report.researchIntent?.primaryCriterion?.value !== 1.96 ||
    !report.holdout?.eligible
  ) {
    throw new Error(`invalid time-series explore protocol: ${JSON.stringify(report)}`);
  }
  assertTimeSeriesEvidence('time-series explore', report.researchPayload?.report, 1000, 4000);
}

async function assertSealed(page, report, jobId, label) {
  const job = await api(page, `/api/app/factor/analysis/job/${jobId}`);
  if (
    report.phase !== 'holdout' ||
    report.status !== 'done' ||
    !report.sealed ||
    report.researchPayload ||
    report.metrics ||
    job.logs?.length
  ) {
    throw new Error(`${label} sealed holdout leaked evidence: ${JSON.stringify({ report, job })}`);
  }
}

function assertPanelHoldout(report, window) {
  if (
    report.phase !== 'holdout' ||
    report.sealed ||
    !report.revealedAt ||
    report.researchSpec?.start !== window.holdoutStart ||
    report.researchSpec?.end !== window.holdoutEnd
  ) {
    throw new Error(`invalid panel holdout protocol: ${JSON.stringify(report)}`);
  }
  assertPanelEvidence('panel holdout', report.researchPayload?.report, 6, 20);
}

function assertTimeSeriesHoldout(report, window) {
  if (
    report.phase !== 'holdout' ||
    report.sealed ||
    !report.revealedAt ||
    report.researchSpec?.start !== window.holdoutStart ||
    report.researchSpec?.end !== window.holdoutEnd
  ) {
    throw new Error(`invalid time-series holdout protocol: ${JSON.stringify(report)}`);
  }
  assertTimeSeriesEvidence('time-series holdout', report.researchPayload?.report, 200, 700);
}

function assertPanelEvidence(label, report, minimumPeriods, minimumObservations) {
  const coveredAssets = report?.coverage?.byAsset?.map((row) => row.assetId).sort();
  if (
    report?.assets?.length !== PANEL_ASSETS.length ||
    report?.periods < minimumPeriods ||
    report?.observations < minimumObservations ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.rankIcirAnnual) ||
    !Number.isFinite(report?.longShortNetAnnualized) ||
    JSON.stringify(coveredAssets) !== JSON.stringify(TIME_SERIES_ASSETS.slice().sort())
  ) {
    throw new Error(`incomplete ${label} evidence: ${JSON.stringify(report)}`);
  }
}

function assertTimeSeriesEvidence(label, report, minimumPeriods, minimumObservations) {
  const coveredAssets = report?.byAsset?.map((row) => row.assetId).sort();
  if (
    report?.assets?.length !== TIME_SERIES_ASSETS.length ||
    report?.periods < minimumPeriods ||
    report?.observations < minimumObservations ||
    !report?.byAsset?.every(
      (row) =>
        row.observations > 100 &&
        Number.isFinite(row.correlation) &&
        Number.isFinite(row.regressionSlope) &&
        Number.isFinite(row.neweyWestTStat),
    ) ||
    JSON.stringify(coveredAssets) !== JSON.stringify(TIME_SERIES_ASSETS.slice().sort())
  ) {
    throw new Error(`incomplete ${label} evidence: ${JSON.stringify(report)}`);
  }
}

async function captureReport({ factor, reportId, testId, expectedText, path }) {
  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(factor)}&report=${encodeURIComponent(reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByTestId(testId).waitFor({ timeout: 30_000 });
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path, fullPage: true });
}

function panelSummary(report) {
  return {
    periods: report.periods,
    observations: report.observations,
    rankIcMean: rounded(report.rankIcMean, 4),
    rankIcirAnnual: rounded(report.rankIcirAnnual, 3),
    rankIcPositiveRate: rounded(report.rankIcPositiveRate, 4),
    longShortNetAnnualized: rounded(report.longShortNetAnnualized, 4),
    averageOneWayTurnover: rounded(report.averageOneWayTurnover, 4),
  };
}

function timeSeriesSummary(report) {
  const orderedTStats = report.byAsset
    .map((asset) => asset.neweyWestTStat)
    .sort((left, right) => left - right);
  return {
    periods: report.periods,
    observations: report.observations,
    medianNeweyWestT: rounded((orderedTStats[1] + orderedTStats[2]) / 2, 3),
    byAsset: report.byAsset.map((asset) => ({
      assetId: asset.assetId,
      observations: asset.observations,
      correlation: rounded(asset.correlation, 4),
      neweyWestTStat: rounded(asset.neweyWestTStat, 3),
      directionHitRate: rounded(asset.directionHitRate, 4),
    })),
  };
}

function rounded(value, digits) {
  return Number(value.toFixed(digits));
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
