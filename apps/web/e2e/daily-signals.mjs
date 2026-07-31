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
      postData: JSON.stringify({ ...body, tradeDate: '20260728' }),
    });
  });
  const signalSubmission = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/run',
  );
  await page.getByRole('button', { name: '立即生成' }).click();
  const signalResponse = await signalSubmission;
  if (signalResponse.status() !== 200) {
    fail(`signal submission failed: ${signalResponse.status()} ${await signalResponse.text()}`);
  }

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

  await page.unroute('**/api/app/signals/run');
  const settlement = await page.evaluate(async (deploymentId) => {
    const submitted = await fetch('/api/app/signals/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deploymentId, tradeDate: '20260729' }),
    });
    const body = await submitted.json();
    if (!submitted.ok) {
      return { status: submitted.status, body };
    }
    if (!body.jobId) {
      return { status: 200, body };
    }
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await (await fetch(`/api/app/signals/jobs/${body.jobId}`)).json();
      if (job.status !== 'running') {
        return { status: 200, body: job };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { status: 408, body: { error: 'signal settlement polling timed out' } };
  }, persisted.deployment.id);
  if (settlement.status !== 200 || settlement.body.status === 'error') {
    fail(`next-day settlement failed: ${JSON.stringify(settlement)}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '每日信号验收' }).waitFor({ timeout: 15_000 });
  await page.locator('.jx-signals-historyRow').filter({ hasText: '2026-07-28' }).click();
  const executionRow = page.locator('.jx-signals-table .ant-table-row[data-row-key]').first();
  await executionRow.getByText('已模拟成交', { exact: true }).waitFor({ timeout: 15_000 });

  const executionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.startsWith('/api/app/signals/executions/'),
  );
  await executionRow.getByRole('button', { name: '记录' }).click();
  const modal = page.locator('.ant-modal').last();
  await modal.locator('.ant-select').first().click();
  await page.getByText('已执行', { exact: true }).last().click();
  await modal.getByRole('button', { name: '保存执行' }).click();
  if ((await executionResponse).status() !== 200) {
    fail('actual execution update failed');
  }
  await modal.waitFor({ state: 'hidden' });
  await executionRow.getByText('已执行', { exact: true }).waitFor({ timeout: 15_000 });

  const accounting = await page.evaluate(
    async (deploymentId) =>
      await (await fetch(`/api/app/signals/deployments/${deploymentId}/execution-overview`)).json(),
    persisted.deployment.id,
  );
  if (
    accounting.simulation?.length < 2 ||
    accounting.actual?.length < 2 ||
    accounting.execution?.filled !== 1 ||
    accounting.execution?.executionRate !== 1
  ) {
    fail(`invalid execution accounting: ${JSON.stringify(accounting)}`);
  }

  await page.screenshot({ path: `${SHOTS}daily-signals-zh.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('heading', { name: 'Daily signals' }).waitFor();
  await page.getByText('Buy', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}daily-signals-en.png`, fullPage: true });

  await page.setViewportSize({ width: 760, height: 1000 });
  await page.getByRole('heading', { name: 'Daily signals' }).waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.jx-signals-executionChart canvas');
    return canvas instanceof HTMLCanvasElement && canvas.getBoundingClientRect().width > 500;
  });
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
