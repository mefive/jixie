import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/signals/', import.meta.url).pathname;
const EMAIL = 'e2e-help-signals@test.com';
const STRATEGY_NAME = '每日信号帮助示例';
const STRATEGY_CODE = [
  'export default defineStrategy({',
  `  name: '${STRATEGY_NAME}',`,
  "  watch: ['600519.SH'],",
  '  onBar(ctx) {',
  "    if (ctx.date === '20260728') {",
  "      ctx.setHoldings({ '600519.SH': 0.5 });",
  '    }',
  '  },',
  '});',
].join('\n');
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-signals-e2e]', ...args);
let strategyId = '';
let requestedSignalDate = '20260727';

try {
  await login();
  await cleanupDedicatedAccount();
  await createAndBacktestStrategy();
  await captureDeploymentFlow();
  await captureSignalFlow();
  await capturePauseFlow();
  log('deployment and signal screenshots completed');
} finally {
  await cleanupDedicatedAccount().catch((error) => log('cleanup failed:', error.message));
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async (email) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.status;
  }, EMAIL);
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function createAndBacktestStrategy() {
  const config = {
    name: STRATEGY_NAME,
    start: '20260701',
    end: '20260728',
    initialCash: 1_000_000,
    cost: { slippageBps: 2, impactCoef: 0.1 },
    code: STRATEGY_CODE,
  };
  const strategy = await json('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  strategyId = strategy.id;
  const submitted = await json(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  for (let attempt = 0; attempt < 120; attempt++) {
    const job = await json(`/api/app/strategy/backtest/${submitted.jobId}`);
    if (job.status === 'done') {
      return;
    }
    if (job.status !== 'running') {
      throw new Error(`backtest failed: ${JSON.stringify(job)}`);
    }
    await page.waitForTimeout(500);
  }
  throw new Error('backtest polling timed out');
}

async function captureDeploymentFlow() {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}signal-deploy-ready-01.png`, [
    { locator: page.locator('.jx-lab-agentName'), number: 1 },
    { locator: page.locator('.jx-lab-runSummary'), number: 2 },
    { locator: page.getByRole('button', { name: '部署上线' }), number: 3 },
    { locator: page.locator('.jx-lab-metrics'), number: 4 },
  ]);

  const deployment = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/deployments',
  );
  await page.getByRole('button', { name: '部署上线' }).click();
  if ((await deployment).status() !== 200) {
    throw new Error('deployment request failed');
  }
  const pauseButton = page.getByRole('button', { name: '暂停上线' });
  await pauseButton.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}signal-deploy-active-01.png`, [
    { locator: page.locator('.jx-lab-runSummary'), number: 1 },
    { locator: pauseButton, number: 2 },
    { locator: page.locator('.jx-lab-metrics'), number: 3 },
  ]);

  const editor = page.locator('.jx-lab-code .monaco-editor');
  await editor.click();
  await page.keyboard.press('Meta+End');
  await page.keyboard.insertText('\n// 尚未运行的修改');
  const outdated = page.getByRole('button', { name: '暂停旧版本' });
  await outdated.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}signal-deploy-outdated-01.png`, [
    { locator: page.locator('.jx-lab-code'), number: 1 },
    { locator: page.getByRole('button', { name: '运行回测' }), number: 2 },
    { locator: outdated, number: 3 },
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '暂停上线' }).waitFor({ timeout: 20_000 });
}

async function captureSignalFlow() {
  await page.route('**/api/app/signals/run', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON();
    await route.continue({
      headers: {
        ...route.request().headers(),
        'content-type': 'application/json',
      },
      postData: JSON.stringify({ ...body, tradeDate: requestedSignalDate }),
    });
  });

  await page.getByRole('link', { name: '今日信号' }).click();
  await page.getByRole('heading', { name: STRATEGY_NAME }).waitFor({ timeout: 20_000 });
  await annotatedScreenshot(page, `${OUTPUT}signal-empty-01.png`, [
    { locator: page.locator('.jx-signals-sidebar'), number: 1 },
    { locator: page.locator('.jx-signals-signalHeader'), number: 2 },
    { locator: page.getByRole('button', { name: '立即生成' }), number: 3 },
    { locator: page.locator('.jx-signals-content .ant-empty'), number: 4 },
  ]);

  requestedSignalDate = '20260727';
  await submitSignal();
  const noAction = page.locator('.jx-signals-noAction');
  await noAction.waitFor({ timeout: 120_000 });
  await annotatedScreenshot(page, `${OUTPUT}signal-no-action-01.png`, [
    { locator: page.locator('.jx-signals-log'), number: 1 },
    { locator: page.locator('.jx-signals-runMeta'), number: 2 },
    { locator: noAction, number: 3 },
    { locator: page.locator('.jx-signals-referenceNote'), number: 4 },
    { locator: page.locator('.jx-signals-history'), number: 5 },
  ]);

  requestedSignalDate = '20260728';
  await submitSignal();
  const table = page.locator('.jx-signals-table');
  await table.waitFor({ timeout: 120_000 });
  const row = table.locator('.ant-table-row[data-row-key]').first();
  const rowText = await row.innerText();
  if (!rowText.includes('600519.SH') || !rowText.includes('买入') || !rowText.includes('300')) {
    throw new Error(`unexpected signal row: ${rowText}`);
  }
  const persisted = await json('/api/app/signals/today');
  const entry = persisted.find((item) => item.deployment.strategyName === STRATEGY_NAME);
  const signal = entry?.run?.signals?.[0];
  if (
    entry?.run?.status !== 'done' ||
    entry.run.tradeDate !== '20260728' ||
    entry.run.execDate !== '20260729' ||
    signal?.code !== '600519.SH' ||
    signal.action !== 'buy' ||
    signal.shares !== 300 ||
    signal.refPrice !== 1320
  ) {
    throw new Error(`invalid signal result: ${JSON.stringify(entry)}`);
  }
  await annotatedScreenshot(page, `${OUTPUT}signal-result-01.png`, [
    { locator: page.locator('.jx-signals-signalHeader'), number: 1 },
    { locator: page.getByRole('button', { name: '立即生成' }), number: 2 },
    { locator: page.locator('.jx-signals-log'), number: 3 },
    { locator: page.locator('.jx-signals-runMeta'), number: 4 },
    { locator: table, number: 5 },
    { locator: page.locator('.jx-signals-referenceNote'), number: 6 },
  ]);
  await annotatedScreenshot(page, `${OUTPUT}signal-history-01.png`, [
    { locator: page.locator('.jx-signals-sidebar'), number: 1 },
    { locator: page.locator('.jx-signals-runMeta'), number: 2 },
    { locator: page.locator('.jx-signals-history'), number: 3 },
  ]);
}

async function submitSignal() {
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/run',
  );
  await page.getByRole('button', { name: '立即生成' }).click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(`signal submission failed: ${response.status()} ${await response.text()}`);
  }
}

async function capturePauseFlow() {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  const pause = page.getByRole('button', { name: '暂停上线' });
  await pause.waitFor({ timeout: 20_000 });
  const response = page.waitForResponse(
    (item) => item.request().method() === 'POST' && new URL(item.url()).pathname.endsWith('/pause'),
  );
  await pause.click();
  if ((await response).status() !== 200) {
    throw new Error('pause deployment request failed');
  }
  const deploy = page.getByRole('button', { name: '部署上线' });
  await deploy.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}signal-pause-01.png`, [
    { locator: page.locator('.jx-lab-runSummary'), number: 1 },
    { locator: deploy, number: 2 },
    { locator: page.locator('.jx-lab-metrics'), number: 3 },
  ]);
}

async function json(path, init) {
  const response = await page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { path, init },
  );
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

async function cleanupDedicatedAccount() {
  const strategies = await json('/api/app/strategies');
  for (const strategy of strategies) {
    await json(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
  }
  strategyId = '';
}

async function annotatedScreenshot(targetPage, path, marks) {
  const annotations = [];
  for (const mark of marks) {
    const target = mark.locator.first();
    const box = await target.boundingBox();
    if (!box) {
      throw new Error(`annotation ${mark.number} target is not visible for ${path}`);
    }
    annotations.push({ ...box, number: mark.number });
  }

  await targetPage.evaluate((items) => {
    const layer = document.createElement('div');
    layer.dataset.helpAnnotations = 'true';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for (const item of items) {
      const outline = document.createElement('div');
      outline.style.cssText = [
        'position:absolute',
        `left:${Math.max(2, item.x - 4)}px`,
        `top:${Math.max(2, item.y - 4)}px`,
        `width:${Math.max(8, item.width + 8)}px`,
        `height:${Math.max(8, item.height + 8)}px`,
        'border:3px solid #e8463b',
        'border-radius:9px',
        'box-sizing:border-box',
        'box-shadow:0 0 0 2px rgba(255,255,255,.9)',
      ].join(';');
      const badge = document.createElement('div');
      badge.textContent = String(item.number);
      badge.style.cssText = [
        'position:absolute',
        `left:${Math.max(4, item.x - 15)}px`,
        `top:${Math.max(4, item.y - 15)}px`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border:2px solid #fff',
        'border-radius:999px',
        'background:#e8463b',
        'color:#fff',
        'font-size:15px',
        'font-weight:700',
        'line-height:1',
        'box-shadow:0 2px 7px rgba(0,0,0,.3)',
      ].join(';');
      layer.append(outline, badge);
    }
    document.body.append(layer);
  }, annotations);
  await targetPage.screenshot({ path });
  await targetPage.evaluate(() => {
    document.querySelector('[data-help-annotations="true"]')?.remove();
  });
  log('wrote', path.split('/').at(-1));
}
