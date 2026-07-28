import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
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
      body: JSON.stringify({ email: 'e2e-signals@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    fail(`dev login failed with status ${loginStatus}`);
  }

  const seed = await page.evaluate(async () => {
    const code = [
      'export default defineStrategy({',
      "  name: 'Daily signals E2E',",
      "  watch: ['600519.SH'],",
      '  onBar(ctx) {',
      "    if (ctx.date === '20260728') {",
      "      ctx.setHoldings({ '600519.SH': 0.5 });",
      '    }',
      '  },',
      '});',
    ].join('\n');
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '每日信号验收',
        start: '20260701',
        end: '20260728',
        initialCash: 1_000_000,
        cost: { slippageBps: 2, impactCoef: 0.1 },
        code,
      }),
    });
    return {
      status: response.status,
      body: await response.json(),
      config: {
        name: '每日信号验收',
        start: '20260701',
        end: '20260728',
        initialCash: 1_000_000,
        cost: { slippageBps: 2, impactCoef: 0.1 },
        code,
      },
    };
  });
  if (seed.status !== 200 || !seed.body.id) {
    fail(`strategy seed failed: ${JSON.stringify(seed)}`);
  }
  strategyId = seed.body.id;

  const backtest = await page.evaluate(
    async ({ id, config }) => {
      const submitted = await fetch(`/api/app/strategy/backtest?strategyId=${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      });
      const body = await submitted.json();
      if (!submitted.ok) {
        return { status: submitted.status, body };
      }
      for (let attempt = 0; attempt < 120; attempt++) {
        const job = await (await fetch(`/api/app/strategy/backtest/${body.jobId}`)).json();
        if (job.status !== 'running') {
          return { status: 200, body: job };
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return { status: 408, body: { error: 'backtest polling timed out' } };
    },
    { id: strategyId, config: seed.config },
  );
  if (backtest.status !== 200 || backtest.body.status !== 'done') {
    const saved = await page.evaluate(
      async (id) => await (await fetch(`/api/app/strategies/${id}`)).json(),
      strategyId,
    );
    fail(`backtest failed: ${JSON.stringify({ backtest, submitted: seed.config, saved })}`);
  }

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.locator('.jx-lab-metricValue').first().waitFor({ timeout: 120_000 });

  const deployResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/deployments',
  );
  await page.getByRole('button', { name: '部署上线' }).click();
  if ((await deployResponse).status() !== 200) {
    fail('deployment request failed');
  }
  await page.getByRole('button', { name: '暂停上线' }).waitFor({ timeout: 15_000 });

  await page.getByRole('link', { name: '今日信号' }).click();
  await page.getByRole('heading', { name: '每日信号验收' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: '立即生成' }).click();

  await page.locator('.jx-signals-table').waitFor({ timeout: 120_000 });
  const row = page.locator('.jx-signals-table .ant-table-row[data-row-key]').first();
  await row.waitFor();
  const rowText = await row.innerText();
  if (!rowText.includes('600519.SH') || !rowText.includes('买入')) {
    fail(`unexpected signal row: ${rowText}`);
  }

  const persisted = await page.evaluate(async () => {
    const entries = await (await fetch('/api/app/signals/today')).json();
    const entry = entries.find((item) => item.deployment.strategyName === '每日信号验收');
    return entry ?? null;
  });
  const signal = persisted?.run?.signals?.[0];
  if (
    persisted?.run?.status !== 'done' ||
    persisted.run.tradeDate !== '20260728' ||
    persisted.run.execDate !== '20260729' ||
    signal?.code !== '600519.SH' ||
    signal.action !== 'buy' ||
    signal.shares <= 0 ||
    signal.shares % 100 !== 0 ||
    signal.refPrice !== 1320
  ) {
    fail(`invalid durable signal result: ${JSON.stringify(persisted)}`);
  }
  if (persisted.run.notifiedAt != null || persisted.run.notificationError != null) {
    fail(`development notification should be skipped: ${JSON.stringify(persisted.run)}`);
  }

  await page.screenshot({ path: `${SHOTS}daily-signals-zh.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('heading', { name: 'Daily signals' }).waitFor();
  await page.getByText('Buy', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}daily-signals-en.png`, fullPage: true });

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.getByRole('heading', { name: 'Daily signals' }).waitFor();
  await page.screenshot({ path: `${SHOTS}daily-signals-mobile.png`, fullPage: true });

  if (pageErrors.length > 0) {
    fail(`page errors: ${JSON.stringify(pageErrors)}`);
  }

  console.log(
    `[daily-signals] PASS strategy=${strategyId} run=${persisted.run.id} shares=${signal.shares}`,
  );
} catch (error) {
  await page
    .screenshot({ path: `${SHOTS}daily-signals-error.png`, fullPage: true })
    .catch(() => {});
  throw error;
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
