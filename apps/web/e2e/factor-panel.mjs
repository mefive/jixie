import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
const ASSETS = [
  '510300.SH',
  '513100.SH',
  '511010.SH',
  '511260.SH',
  '511090.SH',
  '518880.SH',
  '159985.SZ',
  '159980.SZ',
  '159981.SZ',
];
let strategyId = null;
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { status: response.status, body: await response.json() };
    },
    { path, init },
  );

const waitForReport = (reportId) =>
  page.evaluate(async (id) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const report = await fetch(`/api/app/factor/reports/${id}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (['done', 'error', 'stale'].includes(report.status)) {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for panel report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-factor-panel-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  const researchWindow = await api('/api/app/factor/research/window');
  if (researchWindow.status !== 200 || !researchWindow.body.exploreEnd) {
    throw new Error(`research window unavailable: ${JSON.stringify(researchWindow)}`);
  }
  const exploreEnd = researchWindow.body.exploreEnd;

  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: 'cross_asset_momentum_120',
      spec: {
        version: 1,
        analysisKind: 'panel',
        start: '20200101',
        end: exploreEnd,
        observationFrequency: 'monthly',
        assets: [
          { assetId: '510300.SH', assetClass: 'cn_equity' },
          { assetId: '513100.SH', assetClass: 'overseas_equity' },
          { assetId: '511010.SH', assetClass: 'fixed_income' },
          { assetId: '511260.SH', assetClass: 'fixed_income' },
          { assetId: '511090.SH', assetClass: 'fixed_income' },
          { assetId: '518880.SH', assetClass: 'gold' },
          { assetId: '159985.SZ', assetClass: 'commodity' },
          { assetId: '159980.SZ', assetClass: 'commodity' },
          { assetId: '159981.SZ', assetClass: 'commodity' },
        ],
        target: { kind: 'forward_total_return', horizon: 20, horizonUnit: 'trade_day' },
        dataPolicy: {
          pointInTime: true,
          revisionPolicy: 'as_available',
          dataCutoff: exploreEnd,
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
      parentReportId: null,
      researchIntent: {
        version: 1,
        mode: 'hypothesis',
        hypothesis: 'Higher cross-asset momentum predicts higher next-period ETF returns.',
        expectedDirection: 'positive',
        primaryCriterion: { metric: 'panel_rank_ic_mean', operator: 'gt', value: 0 },
      },
    }),
  });
  if (run.status !== 200) {
    throw new Error(`panel run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await waitForReport(run.body.reportId);
  const report = detail.researchPayload?.report;
  const fiveYearCoverage = report?.coverage?.byAsset?.find((row) => row.assetId === '511010.SH');
  const tenYearCoverage = report?.coverage?.byAsset?.find((row) => row.assetId === '511260.SH');
  const thirtyYearCoverage = report?.coverage?.byAsset?.find((row) => row.assetId === '511090.SH');
  const commodityCoverage = ['159985.SZ', '159980.SZ', '159981.SZ'].map((assetId) =>
    report?.coverage?.byAsset?.find((row) => row.assetId === assetId),
  );
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'panel' ||
    detail.researchSpec?.analysisKind !== 'panel' ||
    detail.researchPayload?.analysisKind !== 'panel' ||
    report?.assets?.length !== ASSETS.length ||
    report?.periods < 50 ||
    report?.coverage?.minimumAssets !== 5 ||
    report?.coverage?.medianAssets !== 8 ||
    report?.coverage?.maximumAssets !== ASSETS.length ||
    fiveYearCoverage?.observations !== report.periods ||
    tenYearCoverage?.observations !== report.periods ||
    !thirtyYearCoverage?.firstAsOfDate ||
    thirtyYearCoverage.firstAsOfDate <= '20230613' ||
    thirtyYearCoverage.observations <= 0 ||
    thirtyYearCoverage.observations >= report.periods ||
    commodityCoverage.some(
      (row) =>
        !row?.firstAsOfDate ||
        row.firstAsOfDate < '20200501' ||
        row.firstAsOfDate > '20200831' ||
        row.observations < 50 ||
        row.observations >= report.periods,
    ) ||
    detail.holdout?.eligible !== true ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.longShortNetAnnualized)
  ) {
    throw new Error(`invalid panel report: ${JSON.stringify(detail)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=cross_asset_momentum_120&report=${encodeURIComponent(run.body.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.getByText('跨资产排序证据', { exact: true }).waitFor();
  const durationCoverage = page.getByText('30年国债 ETF', { exact: true });
  await durationCoverage.waitFor();
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-report.png`, fullPage: true });
  await durationCoverage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}factor-panel-duration-coverage.png` });
  const commodityCoverageCard = page.getByText('能源化工期货 ETF', { exact: true });
  await commodityCoverageCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}factor-panel-commodity-coverage.png` });

  await page.getByRole('button', { name: '验证保留段', exact: true }).click();
  const holdoutConfirm = page.locator('.ant-modal-confirm:visible');
  await holdoutConfirm.locator('.ant-modal-confirm-title').waitFor();
  const holdoutResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/app\/factor\/reports\/[^/]+\/holdout$/.test(new URL(response.url()).pathname),
  );
  await holdoutConfirm.getByRole('button', { name: '验证保留段', exact: true }).click();
  const holdoutResponse = await holdoutResponsePromise;
  const holdoutRun = await holdoutResponse.json();
  if (holdoutResponse.status() !== 200 || !holdoutRun.reportId || !holdoutRun.jobId) {
    throw new Error(`holdout failed to start: ${JSON.stringify(holdoutRun)}`);
  }
  const sealed = await waitForReport(holdoutRun.reportId);
  const sealedJob = await api(`/api/app/factor/analysis/job/${holdoutRun.jobId}`);
  if (
    sealed.status !== 'done' ||
    sealed.phase !== 'holdout' ||
    sealed.sealed !== true ||
    sealed.canReveal !== true ||
    sealed.researchPayload != null ||
    sealed.payload != null ||
    sealed.metrics != null ||
    sealedJob.status !== 200 ||
    sealedJob.body.logs?.length !== 0
  ) {
    throw new Error(
      `sealed panel holdout leaked evidence: ${JSON.stringify({ sealed, sealedJob })}`,
    );
  }
  await page.goto(
    `${BASE}/factors?factor=cross_asset_momentum_120&report=${encodeURIComponent(holdoutRun.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByText('Holdout 已计算完成，结果仍封存。揭示后不能恢复为未观察状态。').waitFor({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: '揭示结果', exact: true }).waitFor();
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-holdout-sealed.png`, fullPage: true });

  await page.getByRole('button', { name: '揭示结果', exact: true }).click();
  const revealConfirm = page.locator('.ant-modal-confirm:visible');
  await revealConfirm.locator('.ant-modal-confirm-title').waitFor();
  const revealResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/app\/factor\/reports\/[^/]+\/reveal$/.test(new URL(response.url()).pathname),
  );
  await revealConfirm.getByRole('button', { name: '揭示结果', exact: true }).click();
  const revealResponse = await revealResponsePromise;
  const revealed = await revealResponse.json();
  const holdoutReport = revealed.researchPayload?.report;
  if (
    revealResponse.status() !== 200 ||
    revealed.sealed ||
    !revealed.revealedAt ||
    revealed.analysisKind !== 'panel' ||
    revealed.researchPayload?.analysisKind !== 'panel' ||
    !Number.isFinite(holdoutReport?.rankIcMean)
  ) {
    throw new Error(`invalid revealed panel holdout: ${JSON.stringify(revealed)}`);
  }
  const revealedAgain = await api(`/api/app/factor/reports/${holdoutRun.reportId}/reveal`, {
    method: 'POST',
  });
  if (revealedAgain.status !== 200 || revealedAgain.body.revealedAt !== revealed.revealedAt) {
    throw new Error(`panel holdout reveal was not idempotent: ${JSON.stringify(revealedAgain)}`);
  }
  const criterionPassed = holdoutReport.rankIcMean > 0;
  const holdoutResult = page.getByTestId('panel-holdout-result');
  await holdoutResult.waitFor({ timeout: 30_000 });
  await holdoutResult
    .getByText(criterionPassed ? '已达到预设主要标准' : '未达到预设主要标准', { exact: false })
    .waitFor();
  await page.getByTestId('panel-report').waitFor();
  await page.screenshot({ path: `${SHOTS}factor-panel-holdout-revealed.png`, fullPage: true });

  await page.getByTestId('factor-use-in-lab').click();
  await page.waitForURL(/\/lab\?new=1&factorKey=cross_asset_momentum_120/, { timeout: 30_000 });
  const prompt = page.locator('.jx-lab-heroInput');
  await prompt.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const value = document.querySelector('.jx-lab-heroInput')?.value ?? '';
      return (
        value.includes('cross_asset_momentum_120') &&
        [
          '510300.SH',
          '513100.SH',
          '511010.SH',
          '511260.SH',
          '511090.SH',
          '518880.SH',
          '159985.SZ',
          '159980.SZ',
          '159981.SZ',
        ].every((asset) => value.includes(asset))
      );
    },
    undefined,
    { timeout: 30_000 },
  );

  const factorKey = 'cross_asset_momentum_120';
  const strategyCode = [
    `const etfs = ${JSON.stringify(ASSETS)};`,
    "let last = '';",
    'export default defineStrategy({',
    "  name: '跨资产 ETF 月度轮动',",
    '  watch: etfs,',
    `  factors: ['${factorKey}'],`,
    '  onBar(ctx) {',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    '    const picks = etfs',
    `      .map(code => ({ code, score: ctx.factor('${factorKey}', code) }))`,
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
    name: '跨资产 ETF 月度轮动',
    start: '20230101',
    end: exploreEnd,
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await api('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (strategy.status !== 200 || !strategy.body.id) {
    throw new Error(`panel strategy creation failed: ${JSON.stringify(strategy)}`);
  }
  strategyId = strategy.body.id;
  const backtest = await api(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (backtest.status !== 200 || !backtest.body.jobId) {
    throw new Error(`panel backtest failed to start: ${JSON.stringify(backtest)}`);
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
          throw new Error(`panel backtest ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`panel backtest ${jobId} timed out`);
    },
    { strategyId, jobId: backtest.body.jobId },
  );
  const result = completed.lastResult;
  const dependency = result?.factorDependencies?.[0];
  if (
    result?.trades <= 0 ||
    result?.factorDependencies?.length !== 1 ||
    dependency?.key !== factorKey ||
    dependency?.analysisKind !== 'panel' ||
    !result.tradeLog.every((trade) => ASSETS.includes(trade.code) && trade.assetType === 'etf')
  ) {
    throw new Error(`panel strategy execution or lineage failed: ${JSON.stringify(completed)}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('panel-strategy-execution-notice').waitFor({ timeout: 30_000 });
  await page.getByText('策略回测 · ETF 多头真实执行', { exact: true }).waitFor();
  const dependencyPanel = page.getByTestId('strategy-factor-dependencies');
  await dependencyPanel.getByText(factorKey, { exact: false }).waitFor();
  await dependencyPanel.getByText('跨资产面板', { exact: false }).waitFor();
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-strategy.png`, fullPage: true });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[factor-panel-e2e] explore=${run.body.reportId} periods=${report.periods} observations=${report.observations} medianAssets=${report.coverage.medianAssets} rankIc=${report.rankIcMean.toFixed(4)} holdout=${holdoutRun.reportId} holdoutRankIc=${holdoutReport.rankIcMean.toFixed(4)} criterion=${criterionPassed ? 'passed' : 'missed'} strategy=${strategyId} trades=${result.trades} return=${result.totalReturn.toFixed(4)} screenshots=6`,
  );
} finally {
  if (strategyId) {
    await api(`/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
  }
  await context.close();
  await browser.close();
}
