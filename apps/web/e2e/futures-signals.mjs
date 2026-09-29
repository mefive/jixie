import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

assert.equal(process.env.E2E_ISOLATED_DB, '1', 'Use the isolated job-system harness');
assert.ok(process.env.E2E_BASE);
const base = process.env.E2E_BASE;
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

async function api(path, body, method = body ? 'POST' : 'GET') {
  const response = await context.request.fetch(`${base}/api${path}`, { method, data: body });
  assert.equal(response.ok(), true, `${method} ${path}: ${await response.text()}`);

  return response.json();
}
async function completed(path) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const job = await api(path);
    if (job.status === 'done') {
      return job;
    }
    assert.ok(['queued', 'running'].includes(job.status), JSON.stringify(job));
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out: ${path}`);
}

try {
  await api('/auth/dev/login', { email: 'futures-signals@example.invalid' });
  for (const mixed of [false, true]) {
    const name = mixed ? 'Futures signals mixed fixture' : 'Futures signals pure fixture';
    const config = {
      name,
      start: '20260615',
      end: '20260618',
      initialCash: 10000000,
      code: `export default defineStrategy({ name: '${name}', watch: ${mixed ? "['600519.SH']" : '[]'},
        accounts: { stock: { cashWeight: ${mixed ? 0.7 : 0} }, futures: { cashWeight: ${mixed ? 0.3 : 1} } },
        onBar(ctx) {
          ${mixed ? "if (ctx.date === '20260615') ctx.setHoldings({ '600519.SH': 0.5 });" : ''}
          if (ctx.date === '20260618') ${mixed ? "ctx.hedgeFuture('IF.CFX', 1)" : "ctx.setFutureTargetContracts('IF.CFX', 2)"};
        }
      });`,
    };
    const strategy = await api('/app/strategies', config);
    const backtest = await api(`/app/strategies/${strategy.id}/backtests`, config);
    await completed(`/app/strategies/backtest-jobs/${backtest.jobId}`);
    const deployment = await api('/app/signals/deployments', { reportId: backtest.reportId });
    assert.equal(deployment.accountingVersion, 2);
    const run = await api(`/app/signals/deployments/${deployment.id}/runs`, {
      tradeDate: '20260618',
    });
    await completed(`/app/signals/run-jobs/${run.jobId}`);
    let history = await api(`/app/signals/deployments/${deployment.id}/executions`);
    const task = history.tasks.find((task) => task.intent.assetType === 'future');
    assert.ok(task);
    assert.equal(task.intent.intent.kind, mixed ? 'hedge' : 'contracts');
    const resolution = await api(`/app/signals/executions/${task.id}/resolutions`, {
      expectedRevision: history.revision,
      clientRequestId: `${deployment.id}-resolve`,
      cashExposure: mixed ? 1300000 : 0,
      exposureAsOf: '2026-06-19T09:31:00+08:00',
      price: 4010,
      priceSource: 'Synthetic confirmed quote',
      dependenciesConfirmed: true,
    });
    assert.equal(resolution.payload.target, mixed ? -1 : 2);
    const fill = {
      expectedRevision: history.revision,
      clientRequestId: `${deployment.id}-fill`,
      resolutionId: resolution.id,
      actualCode: task.intent.actualCode,
      action: mixed ? 'sell' : 'buy',
      effect: 'open',
      quantity: 1,
      price: 4010,
      fee: 20,
      tradeDate: '20260619',
      executedAt: '2026-06-19T09:32:00+08:00',
      sequence: 0,
      reason: 'Synthetic partial fill',
    };
    const recorded = await api(`/app/signals/executions/${task.id}/fills`, fill);
    assert.equal((await api(`/app/signals/executions/${task.id}/fills`, fill)).id, recorded.id);
    const next = await api(`/app/signals/deployments/${deployment.id}/runs`, {
      tradeDate: '20260619',
    });
    await completed(`/app/signals/run-jobs/${next.jobId}`);
    history = await api(`/app/signals/deployments/${deployment.id}/executions`);
    assert.equal(history.actual.at(-1).date, '20260619');
    assert.equal(history.actual.at(-1).futures.positions[0].contracts, mixed ? -1 : 1);
    assert.ok(history.simulation.at(-1).futures.positions.length);
    assert.equal(
      history.tasks.find((row) => row.id === task.id).summary.status,
      mixed ? 'filled' : 'partial',
    );
    await page.goto(`${base}/signals`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name, exact: true }).click();
    await page.locator('.jx-signalAccounts').waitFor();
    await page.locator('.jx-signalAccounts canvas').waitFor();
    if (!mixed) {
      await page.getByRole('button', { name: '录入实际成交', exact: true }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('手', { exact: true }).fill('1');
      await dialog.getByLabel('成交时间', { exact: false }).fill('2026-06-19T10:00:00+08:00');
      await dialog
        .getByLabel('执行依据/偏离原因', { exact: false })
        .fill('Second observed partial fill');
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith(`/executions/${task.id}/fills`),
      );
      await dialog.getByRole('button', { name: '确 定' }).click();
      assert.equal((await saved).status(), 200);
      await dialog.waitFor({ state: 'hidden' });
      history = await api(`/app/signals/deployments/${deployment.id}/executions`);
      assert.equal(history.actual.at(-1).futures.positions[0].contracts, 2);
    }
    await page.screenshot({
      path: `${screenshots}/futures-signals-${mixed ? 'mixed' : 'pure'}-zh.png`,
      fullPage: true,
    });
    if (mixed) {
      await page.getByText('EN', { exact: true }).first().click();
      await page.getByText('Dual-account execution', { exact: false }).first().waitFor();
      await page.screenshot({
        path: `${screenshots}/futures-signals-mixed-en.png`,
        fullPage: true,
      });
      await page.setViewportSize({ width: 430, height: 932 });
      await page.screenshot({
        path: `${screenshots}/futures-signals-mobile-en.png`,
        fullPage: true,
      });
      await page.locator('.jx-signalAccounts .ant-table').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${screenshots}/futures-signals-mobile-tasks-en.png`,
        fullPage: true,
      });
    }
    await api(`/app/signals/deployments/${deployment.id}/pause`, {});
  }
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
}
