import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
let compositeId = null;
let strategyId = null;
let copyId = null;
let deploymentId = null;

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
    throw new Error(`timed out waiting for panel composite report ${id}`);
  }, reportId);

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-panel-composite-${Date.now()}@test.com` }),
  });
  if (login.status !== 200) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '新建多因子合成' }).click();
  const modal = page.getByRole('dialog', { name: '新建多因子合成' });
  await modal.getByText('跨资产面板', { exact: true }).click();
  await modal.getByRole('textbox', { name: '名称' }).fill('动量低波多资产组合');
  await modal.getByRole('textbox', { name: '策略代码' }).fill('momentum_low_vol_panel');
  await modal.getByText('跨资产120日动量', { exact: true }).waitFor();
  await modal.getByText('跨资产60日波动率', { exact: true }).waitFor();
  await modal.getByRole('button', { name: '保 存' }).click();
  await page.locator('.jx-factor-compositeWorkspace').waitFor({ timeout: 30_000 });

  const seeded = await api('/api/app/factors/catalog');
  const composite = seeded.body.find(
    (factor) => factor.kind === 'composite' && factor.label === '动量低波多资产组合',
  );
  if (
    seeded.status !== 200 ||
    !composite ||
    composite.analysisKind !== 'panel' ||
    composite.composite?.version !== 2 ||
    composite.composite.components?.length !== 2 ||
    composite.composite.components[1]?.direction !== 'negative'
  ) {
    throw new Error(`invalid panel composite catalog entry: ${JSON.stringify(seeded)}`);
  }
  compositeId = composite.key;

  const researchWindow = await api('/api/app/factor/research/window');
  const exploreEnd = researchWindow.body.exploreEnd;
  const run = await api('/api/app/factor/analysis/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      factor: compositeId,
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
        hypothesis: 'Momentum with a low-volatility overlay improves cross-asset ETF ranking.',
        expectedDirection: 'positive',
        primaryCriterion: { metric: 'panel_rank_ic_mean', operator: 'gt', value: 0 },
      },
    }),
  });
  if (run.status !== 200) {
    throw new Error(`panel composite run failed: ${run.status} ${JSON.stringify(run.body)}`);
  }

  const detail = await waitForReport(run.body.reportId);
  const frozenSource = JSON.parse(detail.factorCodeSnapshot);
  const report = detail.researchPayload?.report;
  if (
    detail.status !== 'done' ||
    detail.analysisKind !== 'panel' ||
    frozenSource.kind !== 'panel_composite' ||
    frozenSource.definition?.version !== 2 ||
    frozenSource.components?.length !== 2 ||
    report?.periods < 50 ||
    report?.observations < 400 ||
    !Number.isFinite(report?.rankIcMean) ||
    !Number.isFinite(report?.longShortNetAnnualized)
  ) {
    throw new Error(`invalid panel composite report: ${JSON.stringify(detail)}`);
  }

  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(compositeId)}&report=${encodeURIComponent(run.body.reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  const workspace = page.locator('.jx-factor-compositeWorkspace');
  await workspace.getByText('跨资产面板', { exact: false }).waitFor({ timeout: 30_000 });
  await workspace.getByText('跨资产120日动量', { exact: true }).waitFor();
  await workspace.getByText('跨资产60日波动率', { exact: true }).waitFor();
  await workspace.getByText('负向（越小越好）', { exact: true }).waitFor();
  await page.getByTestId('panel-report').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}factor-panel-composite.png`, fullPage: true });

  const holdout = await api(`/api/app/factor/reports/${run.body.reportId}/holdout`, {
    method: 'POST',
  });
  if (holdout.status !== 200) {
    throw new Error(`panel composite holdout failed: ${JSON.stringify(holdout)}`);
  }
  const sealed = await waitForReport(holdout.body.reportId);
  if (
    sealed.status !== 'done' ||
    sealed.phase !== 'holdout' ||
    sealed.sealed !== true ||
    sealed.researchPayload != null ||
    sealed.factorCodeSnapshot !== detail.factorCodeSnapshot
  ) {
    throw new Error(`panel composite holdout snapshot drifted: ${JSON.stringify(sealed)}`);
  }

  const publicationCard = page.getByTestId('factor-publication-card');
  await publicationCard.getByTestId('factor-publish').click();
  const publishModal = page.locator('.ant-modal-confirm:visible');
  await publishModal.getByText('momentum_low_vol_panel', { exact: false }).waitFor();
  await publishModal.getByRole('button', { name: /发\s*布/ }).click();
  await publishModal.waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('.jx-factor-keyBar').getByText('已发布', { exact: true }).waitFor({
    timeout: 30_000,
  });
  const published = await api(`/api/app/factors/composites/${compositeId}`);
  if (
    published.status !== 200 ||
    published.body.status !== 'published' ||
    published.body.key !== 'momentum_low_vol_panel' ||
    published.body.approvedReportId !== run.body.reportId ||
    published.body.codeHash !== detail.factorCodeHash
  ) {
    throw new Error(`invalid published panel composite: ${JSON.stringify(published)}`);
  }
  await page.screenshot({
    path: `${SHOTS}factor-panel-composite-published.png`,
    fullPage: true,
  });

  await publicationCard.getByTestId('factor-use-in-lab').click();
  await page.waitForURL(/\/lab\?new=1&factorKey=momentum_low_vol_panel/, { timeout: 30_000 });
  await page.waitForFunction(
    (key) => document.querySelector('.jx-lab-heroInput')?.value.includes(key),
    'momentum_low_vol_panel',
    { timeout: 30_000 },
  );
  const assets = [
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
  const strategyCode = [
    `const etfs = ${JSON.stringify(assets)};`,
    "let last = '';",
    'export default defineStrategy({',
    "  name: '已发布 Panel 组合轮动',",
    '  watch: etfs,',
    "  factors: ['momentum_low_vol_panel'],",
    '  onBar(ctx) {',
    '    const picks = etfs',
    "      .map(code => ({ code, score: ctx.factor('momentum_low_vol_panel', code) }))",
    '      .filter(item => item.score != null)',
    '      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))',
    '      .slice(0, 2)',
    '      .map(item => item.code);',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    '    if (picks.length === 2) ctx.equalWeight(picks);',
    '    else ctx.setHoldings({});',
    '  },',
    '});',
  ].join('\n');
  const strategyConfig = {
    name: '已发布 Panel 组合轮动',
    start: '20230101',
    end: exploreEnd,
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await api('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(strategyConfig),
  });
  if (strategy.status !== 200 || !strategy.body.id) {
    throw new Error(`panel composite strategy creation failed: ${JSON.stringify(strategy)}`);
  }
  strategyId = strategy.body.id;
  const backtest = await api(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(strategyConfig),
  });
  if (backtest.status !== 200 || !backtest.body.jobId) {
    throw new Error(`panel composite backtest failed to start: ${JSON.stringify(backtest)}`);
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
          throw new Error(`panel composite backtest ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`panel composite backtest ${jobId} timed out`);
    },
    { id: strategyId, jobId: backtest.body.jobId },
  );
  const dependency = completed.lastResult?.factorDependencies?.[0];
  const allocation = completed.lastResult?.allocationAnalysis;
  const returnContribution = allocation?.assets?.reduce(
    (sum, asset) => sum + asset.returnContribution,
    0,
  );
  const riskContribution = allocation?.assets?.reduce(
    (sum, asset) => sum + (asset.riskContribution ?? 0),
    0,
  );
  const sixtyDayCorrelation = allocation?.correlations?.windows?.find(
    (window) => window.window === 60,
  );
  const oneTwentyDayCorrelation = allocation?.correlations?.windows?.find(
    (window) => window.window === 120,
  );
  const equityBondCorrelation = sixtyDayCorrelation?.series?.find(
    (series) =>
      [series.left, series.right].includes('cn_equity') &&
      [series.left, series.right].includes('fixed_income'),
  );
  const equityBondValidPoints = equityBondCorrelation?.points?.filter((point) =>
    Number.isFinite(point.value),
  ).length;
  if (
    completed.lastResult?.trades <= 0 ||
    completed.lastResult?.factorDependencies?.length !== 1 ||
    dependency?.factorId !== compositeId ||
    dependency?.key !== 'momentum_low_vol_panel' ||
    dependency?.analysisKind !== 'panel' ||
    dependency?.codeHash !== published.body.codeHash ||
    allocation?.reconciliation?.reconciled !== true ||
    allocation?.assetClasses?.length !== 5 ||
    allocation?.drift?.length <= 0 ||
    allocation?.correlations?.methodology !== 'equal_weight_asset_class_returns' ||
    allocation?.correlations?.sampling !== 'month_end' ||
    sixtyDayCorrelation?.assetClasses?.length !== 5 ||
    sixtyDayCorrelation?.minimumObservations !== 40 ||
    sixtyDayCorrelation?.series?.length !== 10 ||
    !sixtyDayCorrelation.latest.some((row, rowIndex) =>
      row.some((value, columnIndex) => rowIndex !== columnIndex && Number.isFinite(value)),
    ) ||
    oneTwentyDayCorrelation?.minimumObservations !== 80 ||
    oneTwentyDayCorrelation?.series?.length !== 10 ||
    !equityBondCorrelation?.points?.length ||
    equityBondValidPoints / equityBondCorrelation.points.length < 0.8 ||
    Math.abs(returnContribution - completed.lastResult.totalReturn) > 1e-8 ||
    Math.abs(riskContribution - 1) > 1e-8 ||
    !completed.lastResult.tradeLog.every(
      (trade) => assets.includes(trade.code) && trade.assetType === 'etf',
    )
  ) {
    throw new Error(`panel composite strategy lineage failed: ${JSON.stringify(completed)}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  const dependencyPanel = page.getByTestId('strategy-factor-dependencies');
  await dependencyPanel.getByText('momentum_low_vol_panel', { exact: false }).waitFor({
    timeout: 30_000,
  });
  await dependencyPanel.getByText('跨资产面板', { exact: false }).waitFor();
  const allocationPanel = page.getByTestId('allocation-analysis');
  await allocationPanel.getByText('已与组合净值对账', { exact: true }).waitFor({
    timeout: 30_000,
  });
  await page.setViewportSize({ width: 1440, height: 1400 });
  await allocationPanel.scrollIntoViewIfNeeded();
  await allocationPanel.screenshot({
    path: `${SHOTS}factor-panel-composite-attribution.png`,
  });
  await allocationPanel.getByRole('tab', { name: '相关性' }).click();
  const correlationPanel = page.getByTestId('allocation-correlation');
  await correlationPanel.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const correlationCanvasCount = await correlationPanel.locator('canvas').count();
  if (correlationCanvasCount < 2) {
    throw new Error(
      `correlation charts did not render: canvas=${correlationCanvasCount} browserErrors=${browserErrors.join(' | ')}`,
    );
  }
  await correlationPanel.getByText('120日窗口', { exact: true }).click();
  await correlationPanel.getByText(/至少需要 80 个成对有效日收益/).waitFor();
  await correlationPanel.getByText('60日窗口', { exact: true }).click();
  await correlationPanel.getByText(/至少需要 40 个成对有效日收益/).waitFor();
  await allocationPanel.screenshot({
    path: `${SHOTS}factor-panel-composite-correlation.png`,
  });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}factor-panel-composite-strategy.png`,
    fullPage: true,
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
    throw new Error(
      `panel composite deployment failed: ${deploymentHttp.status()} ${JSON.stringify(deployment)}`,
    );
  }
  deploymentId = deployment.id;
  if (
    deployment.factorDependencies?.length !== 1 ||
    deployment.factorDependencies[0]?.factorId !== compositeId ||
    deployment.factorDependencies[0]?.codeHash !== published.body.codeHash
  ) {
    throw new Error(`panel composite deployment lineage failed: ${JSON.stringify(deployment)}`);
  }

  const signal = await api('/api/app/signals/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deploymentId, tradeDate: '20260730' }),
  });
  if (signal.status !== 200) {
    throw new Error(`panel composite signal failed to start: ${JSON.stringify(signal)}`);
  }
  if (signal.body.jobId) {
    await page.evaluate(async (jobId) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = await fetch(`/api/app/signals/jobs/${jobId}`, { cache: 'no-store' }).then(
          (response) => response.json(),
        );
        if (job.status === 'done') {
          return;
        }
        if (job.status === 'error' || job.status === 'stale') {
          throw new Error(`panel composite signal ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`panel composite signal ${jobId} timed out`);
    }, signal.body.jobId);
  }
  const today = await api('/api/app/signals/today');
  const signalEntry = today.body.find((item) => item.deployment.id === deploymentId);
  const factorInput = signalEntry?.run?.factorInputs?.[0];
  if (
    signalEntry?.run?.status !== 'done' ||
    signalEntry.run.factorDependencies?.length !== 1 ||
    signalEntry.run.factorDependencies[0]?.factorId !== compositeId ||
    factorInput?.key !== 'momentum_low_vol_panel' ||
    factorInput?.observedAssets !== assets.length ||
    factorInput?.validAssets !== assets.length ||
    !factorInput.decisionObservations?.every((item) => Number.isFinite(item.value))
  ) {
    throw new Error(`invalid durable panel composite signal: ${JSON.stringify(signalEntry)}`);
  }
  await page.goto(`${BASE}/signals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '已发布 Panel 组合轮动' }).waitFor({ timeout: 30_000 });
  const factorInputsPanel = page.getByTestId('signal-factor-inputs');
  await factorInputsPanel.getByText('momentum_low_vol_panel', { exact: true }).waitFor();
  await factorInputsPanel.scrollIntoViewIfNeeded();
  await factorInputsPanel.screenshot({
    path: `${SHOTS}factor-panel-composite-signal.png`,
  });

  const copied = await api(`/api/app/factors/composites/${compositeId}/copy`, {
    method: 'POST',
  });
  if (
    copied.status !== 200 ||
    copied.body.status !== 'draft' ||
    copied.body.key !== 'momentum_low_vol_panel_v2' ||
    copied.body.definition?.key !== 'momentum_low_vol_panel_v2' ||
    copied.body.approvedReportId != null ||
    copied.body.codeHash != null
  ) {
    throw new Error(`panel composite copy is not independent: ${JSON.stringify(copied)}`);
  }
  copyId = copied.body.id;

  if (browserErrors.length > 0) {
    throw new Error(browserErrors.join('\n'));
  }
  console.log(
    `[factor-panel-composite-e2e] PASS composite=${compositeId} report=${run.body.reportId} periods=${report.periods} observations=${report.observations} strategy=${strategyId} trades=${completed.lastResult.trades} correlationPairs=${sixtyDayCorrelation.series.length} screenshots=6`,
  );
} finally {
  if (deploymentId) {
    await api(`/api/app/signals/deployments/${deploymentId}/pause`, { method: 'POST' }).catch(
      () => {},
    );
  }
  if (copyId) {
    await api(`/api/app/factors/composites/${copyId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (strategyId) {
    await api(`/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
  }
  await browser.close();
}
