import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
const ADMISSION_EMAIL = 'factor-admission-20260731@test.com';
const CANDIDATE_FACTOR = '01KZT96QEZRY2YE9VYG5JFGTR7';
const PRESET_FACTOR = 'sales_yield';
const EXPLORE_REPORT = '01KZT96QF9FG550B37XEVTSMWD';
const HOLDOUT_REPORT = '01KZT9BZXTNJHH9Y1MCNVZ1WYJ';
const EXPECTED_CODE_HASH = 'abd0b11b68739b08a71e9348012aff14764fe688310575b9f93e3ce0cf81acca';
const EXPECTED_EVIDENCE = {
  explore: {
    periods: 60,
    rankIc: 0.03775,
    icirAnnual: 1.6504,
    positiveRate: 0.7,
    netLongShortAnnualized: 0.08582,
    topTurnover: 0.16098,
  },
  holdout: {
    periods: 17,
    rankIc: 0.03469,
    icirAnnual: 1.5354,
    positiveRate: 0.64706,
    netLongShortAnnualized: 0.00664,
    topTurnover: 0.17754,
  },
  correlations: {
    earningsYield: 0.46954,
    bookToMarket: 0.59189,
    size: -0.01172,
  },
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
  await devLogin(page, ADMISSION_EMAIL);
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));

  const [candidate, preset, explore, holdout, correlation] = await Promise.all([
    api(page, `/api/app/factors/custom/${CANDIDATE_FACTOR}`),
    api(page, `/api/app/factors/custom/${PRESET_FACTOR}`),
    api(page, `/api/app/factor/reports/${EXPLORE_REPORT}`),
    api(page, `/api/app/factor/reports/${HOLDOUT_REPORT}`),
    api(
      page,
      `/api/app/factor/correlation?keys=${CANDIDATE_FACTOR},ep,bp&freq=month&start=20200101&end=20250127`,
    ),
  ]);

  assertFrozenSource(candidate, preset, explore, holdout);
  const actualEvidence = {
    explore: reportSummary(explore.payload),
    holdout: reportSummary(holdout.payload),
    correlations: correlationSummary(correlation),
  };
  if (JSON.stringify(actualEvidence) !== JSON.stringify(EXPECTED_EVIDENCE)) {
    throw new Error(`Published sales-yield evidence changed: ${JSON.stringify(actualEvidence)}`);
  }
  assertAdmissionProtocol(explore, holdout, correlation);

  await captureReport(EXPLORE_REPORT, '市值+行业', `${OUTPUT}sales-yield-explore-result.png`);
  await captureReport(HOLDOUT_REPORT, '预设主要标准', `${OUTPUT}sales-yield-holdout-result.png`);

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }

  console.log(
    JSON.stringify(
      {
        candidate: candidate.key,
        preset: preset.key,
        codeHash: explore.factorCodeHash,
        ...actualEvidence,
        originalReveal: holdout.revealedAt,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}

function assertFrozenSource(candidate, preset, explore, holdout) {
  const sourceHash = createHash('sha256').update(preset.code).digest('hex');
  if (
    candidate.key !== 'candidate_sales_yield' ||
    preset.key !== PRESET_FACTOR ||
    !preset.builtin ||
    preset.status !== 'published' ||
    candidate.code !== preset.code ||
    sourceHash !== EXPECTED_CODE_HASH ||
    explore.factorCodeHash !== EXPECTED_CODE_HASH ||
    holdout.factorCodeHash !== EXPECTED_CODE_HASH
  ) {
    throw new Error(
      `Sales-yield source lineage changed: ${JSON.stringify({
        candidateKey: candidate.key,
        presetKey: preset.key,
        builtin: preset.builtin,
        status: preset.status,
        sourceHash,
        exploreHash: explore.factorCodeHash,
        holdoutHash: holdout.factorCodeHash,
      })}`,
    );
  }
}

function assertAdmissionProtocol(explore, holdout, correlation) {
  if (
    explore.status !== 'done' ||
    explore.phase !== 'explore' ||
    explore.analysisKind !== 'cross_sectional' ||
    explore.spec?.version !== 3 ||
    explore.spec?.start !== '20200101' ||
    explore.spec?.end !== '20250127' ||
    explore.spec?.neutral !== 'size_industry' ||
    explore.researchIntent?.primaryCriterion?.metric !== 'rank_ic_mean' ||
    explore.researchIntent?.primaryCriterion?.operator !== 'gt' ||
    explore.researchIntent?.primaryCriterion?.value !== 0.01 ||
    holdout.status !== 'done' ||
    holdout.phase !== 'holdout' ||
    holdout.sealed ||
    !holdout.revealedAt ||
    holdout.parentReportId !== EXPLORE_REPORT ||
    holdout.spec?.start !== '20250205' ||
    holdout.spec?.end !== '20260730' ||
    correlation.periods !== 61
  ) {
    throw new Error(
      `Invalid original sales-yield admission protocol: ${JSON.stringify({
        explore,
        holdout,
        correlation,
      })}`,
    );
  }
}

function reportSummary(payload) {
  return {
    periods: payload.periods,
    rankIc: rounded(payload.icMean, 5),
    icirAnnual: rounded(payload.icirAnnual, 4),
    positiveRate: rounded(payload.icPosRate, 5),
    netLongShortAnnualized: rounded(payload.longShortNet.annReturn, 5),
    topTurnover: rounded(payload.topTurnover, 5),
  };
}

function correlationSummary(report) {
  const candidateRow = report.matrix[0];
  return {
    earningsYield: rounded(candidateRow[1], 5),
    bookToMarket: rounded(candidateRow[2], 5),
    size: rounded(candidateRow[3], 5),
  };
}

function rounded(value, digits) {
  return Number(value.toFixed(digits));
}

async function captureReport(reportId, expectedText, path) {
  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(CANDIDATE_FACTOR)}&report=${encodeURIComponent(reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-factor-resultHead').waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 460;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path });
}

async function api(page, path) {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`${requestPath}: ${JSON.stringify(body)}`);
    }
    return body;
  }, path);
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
