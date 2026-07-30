import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/getting-started/', import.meta.url)
  .pathname;
const ONLY_LAB = process.env.HELP_CONTENT_ONLY_LAB === '1';
const RESULT_STRATEGY_ID = process.env.HELP_CONTENT_RESULT_STRATEGY_ID;
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const log = (...args) => console.log('[help-content-e2e]', ...args);

try {
  if (!ONLY_LAB) {
    await captureLogin();
  }
  await captureFirstTasks({ onlyLab: ONLY_LAB, resultStrategyId: RESULT_STRATEGY_ID });
  log(
    RESULT_STRATEGY_ID
      ? 'saved backtest result screenshots completed'
      : 'login, first screener, and first backtest screenshots completed',
  );
} finally {
  await browser.close();
}

async function captureLogin() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let requestMode = 'invite';

  await context.route('**/api/auth/me', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
  });
  await context.route('**/api/auth/email/request', async (route) => {
    if (requestMode === 'invite') {
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'VALIDATION_FAILED',
            message: '新邮箱注册需要邀请码',
            details: { field: 'inviteCode' },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ challengeId: 'help-screenshot', expiresIn: 600 }),
    });
  });

  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  const email = page.locator('.jx-login-input');
  await email.fill('reader@example.com');
  await annotatedScreenshot(page, `${OUTPUT}login-01-email.png`, [
    { locator: email, number: 1 },
    { locator: page.getByRole('button', { name: '继续' }), number: 2 },
  ]);

  await page.getByRole('button', { name: '继续' }).click();
  await page.getByText('邀请码', { exact: true }).waitFor();
  const invite = page.locator('.jx-login-input');
  await invite.fill('ABCD-EFGH-IJKL');
  await annotatedScreenshot(page, `${OUTPUT}login-02-invite.png`, [
    { locator: invite, number: 1 },
    { locator: page.getByRole('button', { name: '发送验证码' }), number: 2 },
    { locator: page.getByRole('button', { name: /换个邮箱/ }), number: 3 },
  ]);

  await page.reload({ waitUntil: 'networkidle' });
  requestMode = 'verify';
  await page.locator('.jx-login-input').fill('reader@example.com');
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByText('6 位验证码', { exact: true }).waitFor();
  const verificationCode = page.locator('.jx-login-input');
  await verificationCode.fill('123456');
  await annotatedScreenshot(page, `${OUTPUT}login-03-code.png`, [
    { locator: verificationCode, number: 1 },
    { locator: page.getByRole('button', { name: '登录', exact: true }), number: 2 },
    { locator: page.getByRole('button', { name: /重新开始/ }), number: 3 },
  ]);

  await context.close();
}

async function captureFirstTasks({ onlyLab, resultStrategyId }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => log('page error:', error.message));

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const loginStatus = await page.evaluate(async () => {
      const response = await fetch('/api/auth/dev/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'e2e@test.com' }),
      });
      return response.status;
    });
    if (loginStatus !== 200) {
      throw new Error(`dev login failed: ${loginStatus}`);
    }

    await page.evaluate(() => {
      localStorage.removeItem('jx-lab-recents');
      localStorage.setItem('jx-locale', 'zh');
    });

    if (resultStrategyId) {
      await page.goto(`${BASE}/lab?id=${encodeURIComponent(resultStrategyId)}`, {
        waitUntil: 'domcontentloaded',
      });
      await captureBacktestResults(page);
      return;
    }

    await cleanupUserData(page);

    if (!onlyLab) {
      await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
      const screenComposer = page.locator('.jx-screen-chatHero textarea');
      await screenComposer.fill('筛选市盈率TTM低于15、股息率大于3%的股票，按总市值从高到低排列');
      await annotatedScreenshot(page, `${OUTPUT}first-screen-01-query.png`, [
        { locator: screenComposer, number: 1 },
        { locator: page.locator('.jx-screen-chatHeroKbd'), number: 2 },
      ]);

      await screenComposer.press('Enter');
      const queryCard = page.locator('.jx-queryCard').first();
      await queryCard.waitFor({ timeout: 180_000 });
      await page.locator('.jx-queryCard-table .ant-table-row').first().waitFor({ timeout: 30_000 });
      await queryCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await annotatedScreenshot(page, `${OUTPUT}first-screen-02-result.png`, [
        { locator: page.locator('.jx-queryCard-head').first(), number: 1 },
        { locator: page.locator('.jx-queryCard-table').first(), number: 2 },
        { locator: page.locator('.jx-queryCard-pin').first(), number: 3 },
      ]);
    }

    await page.goto(`${BASE}/lab?new=1`, { waitUntil: 'domcontentloaded' });
    const strategyPrompt = page.locator('.jx-lab-heroInput');
    await strategyPrompt.waitFor({ timeout: 20_000 });
    await strategyPrompt.fill('每月第一个交易日买入100股贵州茅台');
    await annotatedScreenshot(page, `${OUTPUT}first-backtest-01-prompt.png`, [
      { locator: strategyPrompt, number: 1 },
      { locator: page.locator('.jx-lab-heroSend'), number: 2 },
      { locator: page.locator('.jx-lab-examples'), number: 3 },
    ]);

    await strategyPrompt.press('Enter');
    await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
    const thinking = page.locator('.jx-lab-bubble--thinking');
    await thinking.waitFor({ timeout: 30_000 });
    await thinking.waitFor({ state: 'detached', timeout: 180_000 });
    await page.waitForFunction(
      () => {
        const monaco = window.__monaco;
        const model = monaco?.editor.getModels()[0];
        return model && !model.getValue().includes("name: 'New strategy'");
      },
      undefined,
      { timeout: 30_000 },
    );
    const runButton = page.getByRole('button', { name: '运行回测' });
    await page.waitForFunction(
      () => {
        const button = document.querySelector('.jx-lab-runBtn');
        return button && !button.hasAttribute('disabled');
      },
      undefined,
      { timeout: 180_000 },
    );

    await page.getByRole('button', { name: '编辑启动参数' }).click();
    const panel = page.locator('.jx-lab-runPanel:visible');
    await panel.waitFor();
    const dateInputs = panel.locator('.ant-picker input');
    await setDate(dateInputs.nth(0), '2024-01-01', page);
    await setDate(dateInputs.nth(1), '2024-03-31', page);
    const cashField = panel.locator('.jx-lab-runPanelField', { hasText: '资金' });
    await cashField.locator('input').fill('100');
    await panel.locator('.jx-lab-runPanelTitle').click();
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.ant-picker-dropdown')).every(
          (element) => getComputedStyle(element).display === 'none' || element.clientHeight === 0,
        ),
      undefined,
      { timeout: 5_000 },
    );
    await annotatedScreenshot(page, `${OUTPUT}first-backtest-02-settings.png`, [
      { locator: panel.locator('.jx-lab-runPanelField', { hasText: '起始' }), number: 1 },
      { locator: panel.locator('.jx-lab-runPanelField', { hasText: '结束' }), number: 2 },
      { locator: cashField, number: 3 },
      { locator: panel.locator('.jx-lab-runPanelField', { hasText: '基础滑点' }), number: 4 },
      { locator: runButton, number: 5 },
    ]);

    await runButton.click();
    await captureBacktestResults(page);
  } finally {
    await cleanupUserData(page).catch((error) => log('cleanup failed:', error.message));
    await context.close();
  }
}

async function captureBacktestResults(page) {
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(
    () => {
      const metrics = Array.from(document.querySelectorAll('.jx-lab-metric'));
      const trades = metrics.find((metric) =>
        metric.querySelector('.jx-lab-metricLabel')?.textContent?.includes('成交笔数'),
      );
      const value = trades?.querySelector('.jx-lab-metricValue')?.textContent ?? '0';
      return Number(value.replace(/,/g, '')) > 0;
    },
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(1_000);
  await annotatedScreenshot(page, `${OUTPUT}first-backtest-03-metrics.png`, [
    { locator: page.locator('.jx-lab-metrics'), number: 1 },
    { locator: page.getByRole('tab', { name: /交易明细/ }), number: 2, optional: true },
    { locator: page.locator('.jx-lab-dock'), number: 3 },
  ]);

  const chart = page.locator('.jx-lab-result canvas').first();
  await chart.waitFor({ timeout: 20_000 });
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await annotatedScreenshot(page, `${OUTPUT}first-backtest-04-chart.png`, [
    { locator: chart, number: 1 },
    { locator: page.locator('.jx-lab-resultTabsInner .ant-tabs-nav'), number: 2 },
  ]);
}

async function setDate(locator, value, page) {
  await locator.click();
  await locator.fill(value);
  await locator.press('Enter');
  await page.keyboard.press('Escape');
}

async function cleanupUserData(page) {
  await page.evaluate(async () => {
    const screens = await (await fetch('/api/app/screens')).json();
    for (const screen of screens) {
      await fetch(`/api/app/screens/${screen.id}`, { method: 'DELETE' });
    }
    const conversations = await (await fetch('/api/app/screen/conversations')).json();
    for (const conversation of conversations) {
      await fetch(`/api/app/screen/conversations/${conversation.id}`, { method: 'DELETE' });
    }
    const strategies = await (await fetch('/api/app/strategies')).json();
    for (const strategy of strategies) {
      await fetch(`/api/app/strategies/${strategy.id}`, { method: 'DELETE' });
    }
  });
}

async function annotatedScreenshot(page, path, marks) {
  const annotations = [];
  for (const mark of marks) {
    const target = mark.locator.first();
    const count = await target.count();
    if (count === 0 && mark.optional) {
      continue;
    }
    if (count === 0) {
      throw new Error(`annotation ${mark.number} target is missing for ${path}`);
    }
    const box = await target.boundingBox();
    if (!box && mark.optional) {
      continue;
    }
    if (!box) {
      throw new Error(`annotation ${mark.number} target is not visible for ${path}`);
    }
    annotations.push({ ...box, number: mark.number });
  }

  await page.evaluate((items) => {
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

  await page.screenshot({ path });
  await page.locator('[data-help-annotations="true"]').evaluate((element) => element.remove());
  log('wrote', path.split('/').at(-1));
}
