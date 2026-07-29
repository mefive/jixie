import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../public/help/zh/backtesting/', import.meta.url).pathname;
const STRATEGY_NAME = '帮助文档：茅台月度定投';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-backtest-content-e2e]', ...args);
let strategyId = null;

try {
  await login();
  await cleanup();
  strategyId = await seedStrategy();
  await openStrategy();
  await captureWorkspace();
  await captureRunSettings();
  await runAndCapture();
  log('backtesting screenshots completed');
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

async function seedStrategy() {
  const seeded = await page.evaluate(
    async ({ name }) => {
      const code = [
        "let lastMonth = '';",
        'export default defineStrategy({',
        `  name: '${name}',`,
        '  params: { sharesPerMonth: 100 },',
        "  watch: ['600519.SH'],",
        '  onBar(ctx) {',
        "    const month = ctx.period('monthly');",
        '    if (month === lastMonth) return;',
        '    lastMonth = month;',
        "    ctx.order('600519.SH', ctx.params.sharesPerMonth);",
        '    console.log(`${ctx.date} 提交月度买入指令`);',
        '  },',
        '});',
      ].join('\n');
      const response = await fetch('/api/app/strategies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          start: '20230101',
          end: '20241231',
          initialCash: 2_000_000,
          cost: { slippageBps: 2, impactCoef: 0.1 },
          code,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { name: STRATEGY_NAME },
  );
  if (seeded.status !== 200 || !seeded.body.id) {
    throw new Error(`strategy seed failed: ${JSON.stringify(seeded)}`);
  }
  return seeded.body.id;
}

async function openStrategy() {
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByText(STRATEGY_NAME, { exact: true }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '运行回测' }).waitFor({ timeout: 15_000 });
}

async function captureWorkspace() {
  await annotatedScreenshot(page, `${OUTPUT}workspace-01.png`, [
    { locator: page.locator('.jx-lab-agentTabs'), number: 1 },
    { locator: page.locator('.jx-lab-code'), number: 2 },
    { locator: page.locator('.jx-lab-resultTabs'), number: 3 },
    { locator: page.locator('.jx-lab-dock'), number: 4 },
  ]);
}

async function captureRunSettings() {
  await page.getByRole('button', { name: '编辑启动参数' }).click();
  const panel = page.locator('.jx-lab-runPanel');
  const fields = panel.locator('.jx-lab-runPanelField');
  await panel.waitFor();
  await annotatedScreenshot(page, `${OUTPUT}run-settings-01.png`, [
    { locator: fields.nth(0), number: 1 },
    { locator: fields.nth(3), number: 2 },
    { locator: fields.nth(4), number: 3 },
    { locator: fields.nth(1), number: 4 },
    { locator: fields.nth(2), number: 5 },
    { locator: page.getByRole('button', { name: '运行回测' }), number: 6 },
  ]);
  await page.keyboard.press('Escape');
}

async function runAndCapture() {
  const runButton = page.getByRole('button', { name: '运行回测' });
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await runButton.click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(`backtest submission failed: ${response.status()} ${await response.text()}`);
  }

  await page
    .getByText(/回测计算中|正在启动回测进程/)
    .first()
    .waitFor({ timeout: 15_000 });
  await page.waitForTimeout(250);
  await annotatedScreenshot(page, `${OUTPUT}run-logs-01.png`, [
    { locator: runButton, number: 1 },
    { locator: page.locator('.jx-lab-result'), number: 2 },
    { locator: page.locator('.jx-lab-dock'), number: 3 },
  ]);

  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
  await page.locator('.jx-lab-performance canvas').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800);
  const tradesTab = page.getByRole('tab', { name: /交易明细/ });
  await tradesTab.waitFor();

  await annotatedScreenshot(page, `${OUTPUT}results-overview-01.png`, [
    { locator: page.locator('.jx-lab-metrics'), number: 1 },
    { locator: page.locator('.jx-lab-performance'), number: 2 },
    { locator: tradesTab, number: 3 },
    { locator: page.locator('.jx-lab-dock'), number: 4 },
  ]);

  await page.getByText('回撤', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('.jx-lab-result').evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await page.waitForTimeout(300);
  await annotatedScreenshot(page, `${OUTPUT}equity-drawdown-01.png`, [
    { locator: page.locator('.jx-lab-performance'), number: 1 },
    { locator: page.locator('.jx-mret'), number: 2 },
  ]);

  await tradesTab.click();
  await page.locator('.jx-td-row').first().waitFor({ timeout: 15_000 });
  await annotatedScreenshot(page, `${OUTPUT}trades-01.png`, [
    { locator: page.locator('.jx-td-metrics'), number: 1 },
    { locator: page.locator('.jx-td-filters'), number: 2 },
    { locator: page.locator('.jx-td-list'), number: 3 },
    { locator: page.getByRole('button', { name: '页面打开' }), number: 4 },
  ]);

  const [tradesPage] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: '页面打开' }).click(),
  ]);
  await tradesPage.waitForLoadState('domcontentloaded');
  await tradesPage.locator('.jx-td-row').first().waitFor({ timeout: 15_000 });
  await annotatedScreenshot(tradesPage, `${OUTPUT}trades-page-01.png`, [
    { locator: tradesPage.locator('.jx-tp-head'), number: 1 },
    { locator: tradesPage.locator('.jx-td-metrics'), number: 2 },
    { locator: tradesPage.locator('.jx-td-filters'), number: 3 },
    { locator: tradesPage.locator('.jx-td-list'), number: 4 },
  ]);
  await tradesPage.close();

  const saved = await page.evaluate(
    async (id) => await (await fetch(`/api/app/strategies/${id}`)).json(),
    strategyId,
  );
  if (!saved.lastResult || saved.lastResult.trades < 1) {
    throw new Error(`backtest result was not saved: ${JSON.stringify(saved)}`);
  }
}

async function cleanup() {
  await page.evaluate(async (name) => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      if (strategy.name.startsWith(name)) {
        await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
      }
    }
  }, STRATEGY_NAME);
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
