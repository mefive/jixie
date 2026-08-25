import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
const FACTOR_START = '20160201';
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
  await devLogin(page, `e2e-learning-value-factor-${Date.now()}@test.com`);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  const window = await api(page, '/api/app/factor/research/window');
  if (!window.exploreEnd || !window.holdoutStart || !window.holdoutEnd) {
    throw new Error(`Factor holdout window is unavailable: ${JSON.stringify(window)}`);
  }

  const mainRun = await runFactor(page, analysisSpec(window.exploreEnd, 'none'));
  const main = await waitForReport(page, mainRun.reportId);
  assertExplore('primary', main, window, 'none');
  if (!main.holdout?.eligible) {
    throw new Error(`primary report is not holdout eligible: ${JSON.stringify(main.holdout)}`);
  }

  const diagnosticRun = await runFactor(
    page,
    analysisSpec(window.exploreEnd, 'size_industry'),
    mainRun.reportId,
  );
  const diagnostic = await waitForReport(page, diagnosticRun.reportId);
  assertExplore('size-industry diagnostic', diagnostic, window, 'size_industry');

  const holdoutRun = await api(page, `/api/app/factor/reports/${mainRun.reportId}/holdout`, {
    method: 'POST',
  });
  const sealed = await waitForReport(page, holdoutRun.reportId);
  const sealedJob = await api(page, `/api/app/factor/analysis/job/${holdoutRun.jobId}`);
  if (
    sealed.phase !== 'holdout' ||
    sealed.status !== 'done' ||
    !sealed.sealed ||
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
    !holdout.payload ||
    holdout.spec?.start !== window.holdoutStart ||
    holdout.spec?.end !== window.holdoutEnd
  ) {
    throw new Error(`invalid revealed holdout: ${JSON.stringify(holdout)}`);
  }
  assertEvidence('holdout', holdout.payload);

  const revealedAgain = await api(page, `/api/app/factor/reports/${holdoutRun.reportId}/reveal`, {
    method: 'POST',
  });
  if (revealedAgain.revealedAt !== holdout.revealedAt) {
    throw new Error('holdout reveal was not idempotent');
  }

  await captureReport(
    mainRun.reportId,
    `${OUTPUT}csi300-value-factor-explore-result.png`,
    '沪深 300',
  );
  await captureReport(
    diagnosticRun.reportId,
    `${OUTPUT}csi300-value-factor-neutralized-result.png`,
    '市值+行业',
  );
  await captureReport(
    holdoutRun.reportId,
    `${OUTPUT}csi300-value-factor-holdout-result.png`,
    '预设主要标准',
  );

  if (browserErrors.length) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[learning-value-factor] PASS cutoff=${main.payload.methodology.dataCutoff} ` +
      `explore=${summary(main.payload)} diagnostic=${summary(diagnostic.payload)} ` +
      `holdout=${summary(holdout.payload)} revealedAt=${holdout.revealedAt}`,
  );
} finally {
  await context.close();
  await browser.close();
}

function analysisSpec(end, neutral) {
  return {
    version: 6,
    freq: 'month',
    start: FACTOR_START,
    end,
    neutral,
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
  };
}

async function runFactor(page, spec, parentReportId = null) {
  return api(page, '/api/app/factor/analysis/run', {
    method: 'POST',
    body: JSON.stringify({
      factor: 'ep',
      spec,
      parentReportId,
      researchIntent: {
        version: 1,
        mode: 'hypothesis',
        hypothesis: '在沪深 300 的历史时点成分中，盈利收益率较高的股票，下一月收益排名倾向更高。',
        rationale: '低估值可能对应更高的后续必要收益，也可能只是困境、行业或规模暴露。',
        expectedDirection: 'positive',
        primaryCriterion: { metric: 'rank_ic_mean', operator: 'gt', value: 0.02 },
      },
    }),
  });
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

function assertExplore(label, report, window, neutral) {
  if (
    report.status !== 'done' ||
    report.phase !== 'explore' ||
    report.spec?.version !== 6 ||
    report.spec?.start !== FACTOR_START ||
    report.spec?.end !== window.exploreEnd ||
    report.spec?.neutral !== neutral ||
    report.spec?.evaluationScope?.universe?.indexCode !== '000300.SH' ||
    report.spec?.evaluationScope?.membership !== 'point_in_time' ||
    report.spec?.evaluationScope?.rankingScope !== 'global' ||
    report.researchIntent?.primaryCriterion?.value !== 0.02
  ) {
    throw new Error(`invalid ${label} protocol: ${JSON.stringify(report)}`);
  }
  assertEvidence(label, report.payload);
}

function assertEvidence(label, payload) {
  const inference = payload?.robustInference;
  if (
    !payload ||
    payload.periods < 12 ||
    payload.buckets?.length !== 10 ||
    !Number.isFinite(payload.icMean) ||
    !Number.isFinite(payload.icirAnnual) ||
    !Number.isFinite(payload.icPosRate) ||
    !Number.isFinite(payload.longShortNet?.annReturn) ||
    !Number.isFinite(payload.topTurnover) ||
    !payload.methodology?.dataCutoff ||
    inference?.version !== 1 ||
    !Number.isFinite(inference.rankIc?.confidenceInterval?.lower) ||
    !Number.isFinite(inference.rankIc?.confidenceInterval?.upper)
  ) {
    throw new Error(`incomplete ${label} evidence: ${JSON.stringify(payload)}`);
  }
}

async function captureReport(reportId, path, expectedText) {
  await page.goto(`${BASE}/factors?factor=ep&report=${encodeURIComponent(reportId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.jx-factor-resultHead').waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path });
}

function summary(payload) {
  const interval = payload.robustInference.rankIc.confidenceInterval;
  return JSON.stringify({
    start: payload.start,
    end: payload.end,
    periods: payload.periods,
    rankIc: Number(payload.icMean.toFixed(4)),
    rankIcCi: [Number(interval.lower.toFixed(4)), Number(interval.upper.toFixed(4))],
    icirAnnual: Number(payload.icirAnnual.toFixed(3)),
    positiveRate: Number(payload.icPosRate.toFixed(3)),
    netLongShortAnnualized: Number(payload.longShortNet.annReturn.toFixed(4)),
    topTurnover: Number(payload.topTurnover.toFixed(3)),
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
