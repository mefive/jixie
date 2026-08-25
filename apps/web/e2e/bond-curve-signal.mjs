import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
let strategyId = null;
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
      const body = await response.json();
      return { ok: response.ok, status: response.status, body };
    },
    { path, init },
  );

const waitForJob = async (path, jobId) =>
  page.evaluate(
    async ({ path, jobId }) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const response = await fetch(`${path}/${jobId}?since=0`, { cache: 'no-store' });
        const job = await response.json();
        if (job.status === 'done' || job.status === 'error' || job.status === 'stale') {
          return job;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { status: 'timeout' };
    },
    { path, jobId },
  );

try {
  console.log('[bond-curve-signal-e2e] opening app');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-bond-signal-${Date.now()}@test.com` }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }
  console.log('[bond-curve-signal-e2e] authenticated');

  const code = [
    "const bond = '511010.SH';",
    'export default defineStrategy({',
    "  name: '国债曲线每日信号验收',",
    '  watch: [bond],',
    "  factors: ['cgb_yield_decline_20'],",
    '  onBar(ctx) {',
    "    const score = ctx.factor('cgb_yield_decline_20', bond);",
    '    if (score != null && score > 0) ctx.setHoldings({ [bond]: 0.8 });',
    '    else ctx.setHoldings({});',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: '国债曲线每日信号验收',
    start: '20250101',
    end: '20260730',
    initialCash: 1_000_000,
    code,
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
  console.log(`[bond-curve-signal-e2e] strategy=${strategyId}`);

  const backtest = await api(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!backtest.ok) {
    throw new Error(`backtest start failed: ${JSON.stringify(backtest)}`);
  }
  const backtestJob = await waitForJob('/api/app/strategy/backtest', backtest.body.jobId);
  if (backtestJob.status !== 'done') {
    throw new Error(`backtest failed: ${JSON.stringify(backtestJob)}`);
  }
  console.log('[bond-curve-signal-e2e] backtest done');
  const saved = await api(`/api/app/strategies/${strategyId}`);
  const backtestDependency = saved.body.lastResult?.factorDependencies?.[0];
  if (
    backtestDependency?.key !== 'cgb_yield_decline_20' ||
    !backtestDependency.inputs?.includes('rates.cgb.yield.10y')
  ) {
    throw new Error(`backtest did not freeze curve inputs: ${JSON.stringify(saved.body)}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('strategy-factor-dependencies').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  const deployButton = page.getByRole('button', { name: '部署上线' });
  await deployButton.waitFor({ timeout: 30_000 });
  await deployButton.hover();
  await page.getByRole('tooltip').getByText('部署上线', { exact: false }).waitFor();
  await page.screenshot({ path: `${SHOTS}12a-cgb-signal-deployment.png`, fullPage: true });
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
  console.log(`[bond-curve-signal-e2e] deployment=${deploymentId}`);
  if (!deployment.factorDependencies?.[0]?.inputs?.includes('rates.cgb.yield.10y')) {
    throw new Error(`deployment did not freeze curve input: ${JSON.stringify(deployment)}`);
  }

  const signal = await api('/api/app/signals/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deploymentId, tradeDate: '20260730' }),
  });
  if (!signal.ok) {
    throw new Error(`signal start failed: ${JSON.stringify(signal)}`);
  }
  if (signal.body.jobId) {
    const signalJob = await waitForJob('/api/app/signals/jobs', signal.body.jobId);
    if (signalJob.status !== 'done') {
      throw new Error(`signal failed: ${JSON.stringify(signalJob)}`);
    }
  }
  console.log('[bond-curve-signal-e2e] signal done');

  await page.goto(`${BASE}/signals`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '国债曲线每日信号验收' }).waitFor({ timeout: 30_000 });
  const factorInputsPanel = page.getByTestId('signal-factor-inputs');
  await factorInputsPanel.waitFor({ timeout: 30_000 });
  await page.getByText('cgb_yield_decline_20', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.jx-signals-executionChart canvas');
    return canvas instanceof HTMLCanvasElement && canvas.getBoundingClientRect().width > 500;
  });

  const today = await api('/api/app/signals/today');
  const entry = today.body.find((item) => item.deployment.strategyName === '国债曲线每日信号验收');
  const factorInput = entry?.run?.factorInputs?.[0];
  if (
    entry?.run?.status !== 'done' ||
    entry.run.tradeDate !== '20260730' ||
    factorInput?.key !== 'cgb_yield_decline_20' ||
    factorInput?.decisionObservations?.[0]?.assetId !== '511010.SH' ||
    !Number.isFinite(factorInput?.decisionObservations?.[0]?.value)
  ) {
    throw new Error(`invalid durable curve signal: ${JSON.stringify(entry)}`);
  }
  await factorInputsPanel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}12b-cgb-signal-factor-inputs.png` });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[bond-curve-signal-e2e] strategy=${strategyId} deployment=${deploymentId} score=${factorInput.decisionObservations[0].value} screenshots=2`,
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
  await browser.close();
}
