import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/backtesting/', import.meta.url).pathname;
const PREFIX = '帮助文档状态：';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-backtest-states-e2e]', ...args);

try {
  await login();
  await cleanup();
  await captureReconnectAndDirtyGuard();
  await captureFailure();
  log('backtest state screenshots completed');
} finally {
  await cleanup().catch((error) => log('cleanup failed:', error.message));
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function captureReconnectAndDirtyGuard() {
  const name = `${PREFIX}刷新恢复`;
  const code = [
    "let lastMonth = '';",
    'export default defineStrategy({',
    `  name: '${name}',`,
    '  async onBar(ctx) {',
    "    const month = ctx.period('monthly');",
    '    if (month === lastMonth) return;',
    '    lastMonth = month;',
    '    const picks = (await ctx.universe())',
    '      .minListDays(365)',
    '      .where((bar) => bar.peTtm != null && bar.peTtm > 0)',
    '      .rankBy((bar) => 1 / bar.peTtm)',
    '      .top(0.01);',
    '    ctx.equalWeight(picks);',
    '    console.log(`${ctx.date} 完成月度选股`);',
    '  },',
    '});',
  ].join('\n');
  const strategyId = await seedStrategy({
    name,
    code,
    start: '20200101',
    end: '20241231',
    initialCash: 2_000_000,
  });

  await openStrategy(strategyId);
  const runButton = page.getByRole('button', { name: '运行回测' });
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await runButton.click();
  const submitted = await submission;
  if (submitted.status() !== 200) {
    throw new Error(`reconnect backtest submission failed: ${submitted.status()}`);
  }
  await page
    .getByText(/回测计算中|正在启动回测进程/)
    .first()
    .waitFor({ timeout: 15_000 });

  const reconnectLookup = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/app/strategy/backtest/running' &&
      new URL(response.url()).searchParams.get('strategyId') === strategyId,
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  const lookup = await reconnectLookup;
  const lookupBody = await lookup.json();
  if (!lookupBody.jobId) {
    throw new Error(`refresh did not find the running job: ${JSON.stringify(lookupBody)}`);
  }
  await page
    .getByText(/回测计算中|正在启动回测进程/)
    .first()
    .waitFor({ timeout: 15_000 });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await annotatedScreenshot(page, `${OUTPUT}reconnect-01.png`, [
    { locator: page.locator('.jx-lab-agentName'), number: 1 },
    { locator: page.locator('.jx-lab-result'), number: 2 },
    { locator: page.locator('.jx-lab-dock'), number: 3 },
  ]);

  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 180_000 });
  const editRunParameters = page.getByRole('button', { name: '编辑启动参数' });
  await editRunParameters.click();
  const capital = page.locator('.jx-lab-runPanel').getByRole('spinbutton', { name: /资金/ });
  await capital.fill('210');
  await editRunParameters.click();
  await page.locator('.jx-lab-runPanel').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '新建' }).click();
  const dialog = page.getByRole('dialog', { name: '有改动尚未运行' });
  await dialog.waitFor();
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}edit-rerun-01.png`, [
    { locator: page.locator('.jx-lab-runSummary'), number: 1 },
    { locator: runButton, number: 2 },
    { locator: dialog, number: 3 },
  ]);
  await page.locator('.ant-modal:visible .ant-modal-footer button').first().click();
}

async function captureFailure() {
  const name = `${PREFIX}失败示例`;
  const strategyId = await seedStrategy({
    name,
    code: `export default defineStrategy({ name: '${name}', onBar(ctx) { ctx.order(`,
    start: '20240101',
    end: '20240331',
    initialCash: 1_000_000,
  });
  await openStrategy(strategyId);

  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await page.getByRole('button', { name: '运行回测' }).click();
  const submitted = await submission;
  if (submitted.status() !== 200) {
    throw new Error(`failure backtest submission failed: ${submitted.status()}`);
  }
  const error = page.locator('.jx-lab-placeholder--error');
  await error.waitFor({ timeout: 60_000 });
  await annotatedScreenshot(page, `${OUTPUT}failure-01.png`, [
    { locator: page.locator('.jx-lab-code'), number: 1 },
    { locator: error, number: 2 },
    { locator: page.locator('.jx-lab-dock'), number: 3 },
  ]);
}

async function seedStrategy({ name, code, start, end, initialCash }) {
  const seeded = await page.evaluate(
    async (config) => {
      const response = await fetch('/api/app/strategies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...config,
          cost: { slippageBps: 2, impactCoef: 0.1 },
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { name, code, start, end, initialCash },
  );
  if (seeded.status !== 200 || !seeded.body.id) {
    throw new Error(`strategy seed failed: ${JSON.stringify(seeded)}`);
  }
  return seeded.body.id;
}

async function openStrategy(strategyId) {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '运行回测' }).waitFor({ timeout: 15_000 });
}

async function cleanup() {
  await page.evaluate(async (prefix) => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      if (strategy.name.startsWith(prefix)) {
        await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
      }
    }
  }, PREFIX);
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
  await targetPage
    .locator('[data-help-annotations="true"]')
    .evaluate((element) => element.remove());
  log('wrote', path.split('/').at(-1));
}
