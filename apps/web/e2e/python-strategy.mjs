import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
let strategyId = null;

page.on('pageerror', (error) => pageErrors.push(error.message));

const fail = (message) => {
  throw new Error(message);
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-python-strategy@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    fail(`dev login failed with status ${loginStatus}`);
  }

  const seed = await page.evaluate(async () => {
    const code = [
      'from jixie import Strategy',
      '',
      'strategy = Strategy(name="python history e2e", watch=["600519.SH"])',
      'ordered = False',
      '',
      '@strategy.on_bar',
      'def handle_bar(ctx):',
      '    global ordered',
      '    canonical = ctx.history("600519.SH", "close", 20)',
      '    compatible = ctx.history("600519.SH", "adj_close", 20)',
      '    assert compatible == canonical',
      '    if not ordered and len(canonical) == 20:',
      '        print("python-history-ready", ctx.date, len(canonical))',
      '        ctx.order_target_percent("600519.SH", 0.5)',
      '        ordered = True',
    ].join('\n');
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Python history compatibility E2E',
        start: '20240101',
        end: '20240331',
        initialCash: 1_000_000,
        language: 'python',
        runtimeVersion: 'py-v1',
        code,
      }),
    });
    return { status: response.status, body: await response.json(), code };
  });
  if (seed.status !== 200 || !seed.body.id) {
    fail(`Python strategy creation failed: ${JSON.stringify(seed)}`);
  }
  strategyId = seed.body.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByText('py-v1', { exact: false }).waitFor({ timeout: 15_000 });

  const backtestResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await page.getByRole('button', { name: '运行回测' }).click();
  const backtestResponse = await backtestResponsePromise;
  if (backtestResponse.status() !== 200) {
    fail(
      `Python backtest submission failed: ${backtestResponse.status()} ${await backtestResponse.text()}`,
    );
  }

  const completion = await Promise.race([
    page
      .locator('.jx-lab-metricValue')
      .first()
      .waitFor({ timeout: 120_000 })
      .then(() => 'success'),
    page
      .getByText('回测失败：', { exact: false })
      .waitFor({ timeout: 120_000 })
      .then(() => 'failure'),
  ]);
  if (completion === 'failure') {
    const logText = await page
      .locator('.jx-logView')
      .textContent()
      .catch(() => '');
    fail(`Python backtest failed in the UI: ${logText}`);
  }
  await page
    .locator('.jx-logView')
    .getByText('python-history-ready', { exact: false })
    .waitFor({ timeout: 15_000 });
  const saved = await page.evaluate(
    async (id) => await (await fetch(`/api/app/strategies/${id}`)).json(),
    strategyId,
  );
  if (
    saved.config.language !== 'python' ||
    saved.config.runtimeVersion !== 'py-v1' ||
    saved.config.code !== seed.code ||
    saved.lastResult?.trades !== 1
  ) {
    fail(`committed Python strategy/result mismatch: ${JSON.stringify(saved)}`);
  }
  if (pageErrors.length > 0) {
    fail(`page errors: ${JSON.stringify(pageErrors)}`);
  }

  const screenshotPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../acceptance/python-history-e2e.png',
  );
  await mkdir(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(
    `[python-strategy] PASS id=${strategyId} trades=${saved.lastResult.trades} screenshot=${screenshotPath}`,
  );
} finally {
  if (strategyId) {
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/strategies/${id}`, { method: 'DELETE' });
      }, strategyId)
      .catch(() => {});
  }
  await browser.close();
}
