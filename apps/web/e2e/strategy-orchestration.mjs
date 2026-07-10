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
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    fail(`dev login failed with status ${loginStatus}`);
  }

  const seed = await page.evaluate(async () => {
    const code = [
      "let last = '';",
      'export default defineStrategy({',
      "  name: 'orchestration e2e',",
      "  watch: ['600519.SH'],",
      '  onBar(ctx) {',
      "    const period = ctx.period('monthly');",
      '    if (period !== last) {',
      '      last = period;',
      "      ctx.order('600519.SH', 100);",
      '    }',
      '  },',
      '});',
    ].join('\n');
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '每月定投贵州茅台的策略',
        start: '20240101',
        end: '20240331',
        initialCash: 1_000_000,
        code,
      }),
    });
    return { status: response.status, body: await response.json(), code };
  });
  if (seed.status !== 200 || !seed.body.id || !seed.body.name) {
    fail(`server-side strategy creation failed: ${JSON.stringify(seed)}`);
  }
  strategyId = seed.body.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '运行回测' }).waitFor({ timeout: 15_000 });

  const postRequests = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      postRequests.push(new URL(request.url()).pathname);
    }
  });

  const backtestResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/strategy/backtest',
  );
  await page.getByRole('button', { name: '运行回测' }).click();
  const backtestResponse = await backtestResponsePromise;
  if (backtestResponse.status() !== 200) {
    fail(
      `backtest submission failed: ${backtestResponse.status()} ${await backtestResponse.text()}`,
    );
  }

  const duplicate = await page.evaluate(async (id) => {
    const saved = await (await fetch(`/api/app/strategies/${id}`)).json();
    const response = await fetch(`/api/app/strategy/backtest?strategyId=${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(saved.config),
    });
    return { status: response.status, body: await response.json() };
  }, strategyId);
  if (duplicate.status !== 400 || duplicate.body?.error?.code !== 'VALIDATION_FAILED') {
    fail(`concurrent backtest was not rejected: ${JSON.stringify(duplicate)}`);
  }

  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });
  const saved = await page.evaluate(
    async (id) => await (await fetch(`/api/app/strategies/${id}`)).json(),
    strategyId,
  );
  if (!saved.lastResult || saved.config.code !== seed.code || !saved.name) {
    fail(`committed strategy/result mismatch: ${JSON.stringify(saved)}`);
  }

  if (postRequests.includes('/api/app/strategy/name')) {
    fail(`Lab called the deprecated naming route: ${JSON.stringify(postRequests)}`);
  }
  if (postRequests.includes(`/api/app/strategies/${strategyId}`)) {
    fail(`Lab issued a pre-run strategy update: ${JSON.stringify(postRequests)}`);
  }
  if (pageErrors.length > 0) {
    fail(`page errors: ${JSON.stringify(pageErrors)}`);
  }

  console.log(
    `[strategy-orchestration] PASS id=${strategyId} name=${JSON.stringify(saved.name)} trades=${saved.lastResult.trades}`,
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
