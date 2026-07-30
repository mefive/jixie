import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/factors/', import.meta.url).pathname;
const EMAIL = 'e2e-help-factor-custom@test.com';
const FACTOR_CODE = [
  'export default defineFactor({',
  "  name: '账面市值比（自定义）',",
  '  compute: (bar) => (bar.pb && bar.pb > 0 ? 1 / bar.pb : null),',
  '});',
].join('\n');
const STRATEGY_KEY_DRAFT = 'help_book_to_market';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (...args) => console.log('[help-factor-custom-e2e]', ...args);
let factorId = '';
let strategyId = '';

try {
  await login();
  await cleanupDedicatedAccount();
  await capturePresetCopyFlow();
  await captureNewFactorFlow();
  await runCustomFactorAnalysis();
  const factorKey = await captureStrategyKeyFlow();
  await captureStrategyUsageFlow(factorKey);
  log('custom factor and strategy screenshots completed');
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
  await page.evaluate(() => {
    localStorage.setItem('jx-locale', 'zh');
    localStorage.removeItem('jx-lab-recents');
  });
}

async function capturePresetCopyFlow() {
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  const library = page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' });
  await library.click();
  const preset = page.locator('.jx-factor-libItem', { hasText: '盈利收益率' });
  await preset.waitFor({ timeout: 20_000 });
  await preset.click();
  await page.locator('.jx-factor-presetBar').waitFor({ timeout: 20_000 });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await annotatedScreenshot(page, `${OUTPUT}factor-custom-copy-01.png`, [
    { locator: library, number: 1 },
    { locator: page.locator('.jx-factor-libItem--active'), number: 2 },
    { locator: page.locator('.jx-factor-presetNote'), number: 3 },
    { locator: page.getByRole('button', { name: '复制为自定义' }), number: 4 },
    { locator: page.locator('.jx-factor-code'), number: 5 },
  ]);

  await page.getByRole('button', { name: '复制为自定义' }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-factor-presetBar'), null, {
    timeout: 20_000,
  });
  await page.locator('.jx-factor-keyBar').waitFor({ timeout: 20_000 });
  await annotatedScreenshot(page, `${OUTPUT}factor-custom-copy-02.png`, [
    { locator: page.getByText('自定义因子', { exact: true }), number: 1 },
    { locator: page.locator('.jx-factor-libItem--active'), number: 2 },
    { locator: page.locator('.jx-factor-keyBar'), number: 3 },
    { locator: page.locator('.jx-factor-code'), number: 4 },
  ]);
}

async function captureNewFactorFlow() {
  await page.getByRole('button', { name: '新建' }).click();
  const prompt = page.locator('.jx-factor-chatInput textarea');
  await prompt.waitFor({ timeout: 20_000 });
  await annotatedScreenshot(page, `${OUTPUT}factor-custom-new-01.png`, [
    { locator: page.getByRole('button', { name: '新建' }), number: 1 },
    { locator: page.locator('.jx-factor-agentIdentity'), number: 2 },
    { locator: page.locator('.jx-factor-chatInput'), number: 3 },
    { locator: page.locator('.jx-factor-code'), number: 4 },
    { locator: page.locator('.jx-factor-runButton'), number: 5 },
  ]);

  const created = await json('/api/app/factors/custom', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '账面市值比（自定义）', code: FACTOR_CODE }),
  });
  factorId = created.id;
  await page.goto(`${BASE}/factors?factor=${factorId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page
    .locator('.jx-factor-agentNameText', { hasText: '账面市值比（自定义）' })
    .waitFor({ timeout: 20_000 });
  await page.waitForTimeout(500);
  await annotatedScreenshot(page, `${OUTPUT}factor-custom-edited-01.png`, [
    { locator: page.locator('.jx-factor-agentIdentity'), number: 1 },
    { locator: prompt, number: 2 },
    { locator: page.locator('.jx-factor-code'), number: 3 },
    { locator: page.locator('.jx-factor-runButton'), number: 4 },
  ]);
}

async function runCustomFactorAnalysis() {
  const runButton = page.locator('.jx-factor-runButton');
  await runButton.click();
  const modal = page.locator('.jx-factor-researchModal');
  await modal.waitFor();
  await modal.getByText('纯探索', { exact: true }).click();
  const submission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/factor/analysis/run',
  );
  await modal.getByRole('button', { name: '冻结研究卡并运行' }).click();
  const response = await submission;
  if (response.status() !== 200) {
    throw new Error(
      `factor analysis failed to submit: ${response.status()} ${await response.text()}`,
    );
  }

  await page.locator('.jx-factor-methodology').waitFor({ timeout: 180_000 });
  await page.locator('.jx-factor-chart canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(700);
  await annotatedScreenshot(page, `${OUTPUT}factor-custom-analysis-01.png`, [
    { locator: page.locator('.jx-factor-agentIdentity'), number: 1 },
    { locator: page.locator('.jx-factor-paramBar'), number: 2 },
    { locator: page.locator('.jx-factor-methodology'), number: 3 },
    { locator: page.locator('.jx-factor-dock'), number: 4 },
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page
    .locator('.jx-factor-agentNameText', { hasText: '账面市值比（自定义）' })
    .waitFor({ timeout: 20_000 });
  const persisted = await json(`/api/app/factors/custom/${factorId}`);
  if (!persisted.code.includes('bar.pb')) {
    throw new Error('custom factor code was not persisted');
  }
  if (new URL(page.url()).searchParams.get('factor') !== factorId) {
    throw new Error('custom factor was not restored after refresh');
  }
}

async function captureStrategyKeyFlow() {
  const keyInput = page.locator('.jx-factor-keyInput input');
  await keyInput.waitFor({ timeout: 20_000 });
  await keyInput.fill(STRATEGY_KEY_DRAFT);
  await annotatedScreenshot(page, `${OUTPUT}factor-strategy-key-01.png`, [
    { locator: page.locator('.jx-factor-keyLabel'), number: 1 },
    { locator: page.locator('.jx-factor-keyInput'), number: 2 },
    { locator: page.getByRole('button', { name: '确认并锁定' }), number: 3 },
    { locator: page.locator('.jx-factor-keyHint'), number: 4 },
  ]);

  await page.getByRole('button', { name: '确认并锁定' }).click();
  const confirm = page.locator('.ant-modal-confirm');
  await confirm.waitFor();
  await confirm.locator('.ant-btn-primary').click();
  await page.locator('.jx-factor-keyValue').waitFor({ timeout: 20_000 });
  await confirm.waitFor({ state: 'hidden' });
  await page.locator('.ant-message-notice').waitFor({ state: 'hidden', timeout: 5_000 });
  await annotatedScreenshot(page, `${OUTPUT}factor-strategy-key-locked-01.png`, [
    { locator: page.locator('.jx-factor-keyLabel'), number: 1 },
    { locator: page.locator('.jx-factor-keyValue'), number: 2 },
    { locator: page.locator('.jx-factor-keyLocked'), number: 3 },
  ]);

  const factorKey = ((await page.locator('.jx-factor-keyValue').textContent()) ?? '').trim();
  if (!factorKey.startsWith('custom:')) {
    throw new Error(`unexpected finalized factor key: ${factorKey}`);
  }
  return factorKey;
}

async function captureStrategyUsageFlow(factorKey) {
  const strategyCode = [
    "let last = '';",
    'export default defineStrategy({',
    "  name: '账面市值比因子示例',",
    `  factors: ['${factorKey}'],`,
    '  async onBar(ctx) {',
    "    if (ctx.period('monthly') === last) return;",
    "    last = ctx.period('monthly');",
    "    const universe = (await ctx.universe('000300.SH')).minListDays(365);",
    '    await ctx.ensureBars(universe.codes());',
    '    const picks = universe',
    `      .rankBy((_bar, code) => ctx.factor('${factorKey}', code))`,
    '      .top(10);',
    '    if (picks.length) ctx.equalWeight(picks);',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: '账面市值比因子示例',
    start: '20240101',
    end: '20240331',
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await json('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  strategyId = strategy.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (key) =>
      (document.querySelector('.jx-lab-code .monaco-editor')?.textContent ?? '').includes(key),
    factorKey,
    { timeout: 20_000 },
  );
  const factorLines = page.locator('.jx-lab-code .view-line', { hasText: factorKey });
  if ((await factorLines.count()) < 2) {
    throw new Error('strategy code does not show both factor declaration and factor read');
  }
  await annotatedScreenshot(page, `${OUTPUT}factor-strategy-reference-01.png`, [
    { locator: page.locator('.jx-lab-agentName'), number: 1 },
    { locator: factorLines.nth(0), number: 2 },
    { locator: factorLines.nth(1), number: 3 },
    { locator: page.getByRole('button', { name: '运行回测' }), number: 4 },
  ]);

  const factorLiteral = page
    .locator('.jx-lab-code .view-line span')
    .filter({ hasText: factorKey })
    .first();
  await factorLiteral.hover();
  const hover = page.locator('.monaco-hover', { hasText: factorKey });
  await hover.waitFor({ timeout: 10_000 });
  await annotatedScreenshot(page, `${OUTPUT}factor-strategy-hover-01.png`, [
    { locator: factorLiteral, number: 1 },
    { locator: hover, number: 2 },
  ]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '运行回测' }).click();
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
  const tradesTab = page.locator('.jx-lab-resultTabs').getByRole('tab', { name: /交易明细/ });
  await tradesTab.waitFor({ timeout: 20_000 });
  await page.locator('.jx-lab-result canvas').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await annotatedScreenshot(page, `${OUTPUT}factor-strategy-result-01.png`, [
    { locator: page.locator('.jx-lab-runSummary'), number: 1 },
    { locator: page.locator('.jx-lab-metrics'), number: 2 },
    { locator: tradesTab, number: 3 },
    { locator: page.locator('.jx-lab-result canvas').first(), number: 4 },
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
  await page.evaluate(async () => {
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
    }
    const catalog = await (await fetch('/api/app/factors/catalog')).json();
    for (const factor of catalog.filter((item) => item.kind === 'custom')) {
      await fetch(`/api/app/factors/custom/${factor.key}`, { method: 'DELETE' });
    }
  });
  factorId = '';
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
