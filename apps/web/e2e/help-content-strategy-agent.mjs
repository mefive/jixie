import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../public/help/zh/backtesting/', import.meta.url).pathname;
const INITIAL_PROMPT =
  '只交易沪深300ETF（510300.SH）：每月第一个交易日买入100股；如果已经持有就不重复买入。';
const REVISION_PROMPT = '把每月买入数量改为200股，其他规则不变。';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-strategy-agent-e2e]', ...args);
let strategyId = '';

try {
  await login();
  await cleanupDedicatedAccount();
  await page.goto(`${BASE}/lab?new=1`, { waitUntil: 'domcontentloaded' });
  const heroInput = page.locator('.jx-lab-heroInput');
  await heroInput.waitFor({ timeout: 20_000 });
  await heroInput.fill(INITIAL_PROMPT);
  await annotatedScreenshot(page, `${OUTPUT}strategy-description-01.png`, [
    { locator: page.getByRole('heading', { name: '新建策略' }), number: 1 },
    { locator: page.locator('.jx-lab-heroBox'), number: 2 },
    { locator: page.locator('.jx-lab-examples'), number: 3 },
    { locator: page.getByText('或直接写代码', { exact: false }), number: 4 },
  ]);

  await heroInput.press('Enter');
  await page.waitForFunction(() => new URL(window.location.href).searchParams.has('id'), null, {
    timeout: 30_000,
  });
  strategyId = new URL(page.url()).searchParams.get('id') ?? '';
  if (!strategyId) {
    throw new Error('strategy id was not added to the URL');
  }
  await waitForCompletedAssistantTurn(1);
  await waitForEditorText('510300');
  await assertNoAgentError();
  await annotatedScreenshot(page, `${OUTPUT}strategy-generated-01.png`, [
    { locator: page.locator('.jx-lab-agentName'), number: 1 },
    { locator: page.locator('.jx-lab-chatLog'), number: 2 },
    { locator: page.locator('.jx-lab-code'), number: 3 },
    { locator: page.getByRole('button', { name: '运行回测' }), number: 4 },
  ]);

  const completedBefore = await completedAssistantTurns().count();
  const chatInput = page.locator('.jx-lab-chatInput textarea');
  await chatInput.fill(REVISION_PROMPT);
  await chatInput.press('Enter');
  await waitForCompletedAssistantTurn(completedBefore + 1);
  await waitForEditorText('200');
  await assertNoAgentError();
  await annotatedScreenshot(page, `${OUTPUT}strategy-revised-01.png`, [
    { locator: page.locator('.jx-lab-chatLog'), number: 1 },
    { locator: completedAssistantTurns().last(), number: 2 },
    { locator: page.locator('.jx-lab-code'), number: 3 },
    { locator: page.getByRole('button', { name: '运行回测' }), number: 4 },
  ]);

  await page.getByRole('button', { name: '运行回测' }).click();
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
  const tradesTab = page.locator('.jx-lab-resultTabs').getByRole('tab', { name: /交易明细/ });
  await tradesTab.waitFor({ timeout: 15_000 });
  await annotatedScreenshot(page, `${OUTPUT}strategy-revised-result-01.png`, [
    { locator: page.locator('.jx-lab-runSummary'), number: 1 },
    { locator: page.locator('.jx-lab-metrics'), number: 2 },
    { locator: tradesTab, number: 3 },
    { locator: page.locator('.jx-lab-dock'), number: 4 },
  ]);
  log('real strategy generation, revision, and backtest completed');
} finally {
  await cleanupDedicatedAccount().catch((error) => log('cleanup failed:', error.message));
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-help-strategy-agent@test.com' }),
    });
    return response.status;
  });
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => {
    localStorage.setItem('jx-locale', 'zh');
    localStorage.removeItem('jx-lab-recents');
  });
}

function completedAssistantTurns() {
  return page.locator('.jx-lab-bubble--assistant:not(.jx-lab-bubble--thinking)');
}

async function waitForCompletedAssistantTurn(count) {
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll('.jx-lab-bubble--assistant:not(.jx-lab-bubble--thinking)').length >=
        expected && !document.querySelector('.jx-lab-bubble--thinking'),
    count,
    { timeout: 180_000 },
  );
}

async function waitForEditorText(text) {
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('.jx-lab-code .monaco-editor')?.textContent ?? '').includes(expected),
    text,
    { timeout: 30_000 },
  );
}

async function assertNoAgentError() {
  const assistant = (await completedAssistantTurns().last().textContent()) ?? '';
  if (assistant.includes('出错了:')) {
    throw new Error(`strategy agent failed: ${assistant}`);
  }
}

async function cleanupDedicatedAccount() {
  await page.evaluate(async () => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
    }
  });
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
