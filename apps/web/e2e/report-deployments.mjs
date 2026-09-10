import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// This scenario intentionally retains report/deployment history and must use a disposable database.
assert.equal(
  process.env.E2E_ISOLATED_DB,
  '1',
  'Use an isolated API database and set E2E_ISOLATED_DB=1',
);
const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const pageErrors = [];
const deploymentIds = new Set();
page.on('pageerror', (error) => pageErrors.push(error.message));

async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await page.request.fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { data: body }),
  });
  const result = await response.json();
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(result)}`);
  return result;
}

async function waitJob(path) {
  for (let attempt = 0; attempt < 240; attempt++) {
    const job = await api(path);
    if (job.status === 'done') {
      return job;
    }
    assert.ok(['running', 'queued'].includes(job.status), JSON.stringify(job));
    await page.waitForTimeout(500);
  }
  throw new Error(`Job timed out: ${path}`);
}

async function deploySelectedReport() {
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/signals/deployments',
  );
  await page.getByRole('button', { name: '部署上线', exact: true }).click();
  const completed = await response;
  assert.equal(completed.status(), 200, await completed.text());
  const deployment = await completed.json();
  deploymentIds.add(deployment.id);
  await page.getByRole('button', { name: '暂停上线', exact: true }).waitFor();
  return deployment;
}

try {
  await api('/api/auth/dev/login', { email: `report-deployments-${Date.now()}@fixture.invalid` });
  const config = {
    name: '报告独立部署验收',
    start: '20260701',
    end: '20260728',
    initialCash: 1_000_000,
    cost: { slippageBps: 2, impactCoef: 0.1 },
    code: `export default defineStrategy({ name: 'Report deployments', watch: ['600519.SH'], onBar(ctx) { if (ctx.date === '20260728') { ctx.setHoldings({ '600519.SH': 0.5 }); } } });`,
  };
  const strategy = await api('/api/app/strategies', config);
  const reports = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const submitted = await api(`/api/app/strategies/${strategy.id}/backtests`, config);
    await waitJob(`/api/app/strategies/backtest-jobs/${submitted.jobId}`);
    reports.push(submitted.reportId);
  }
  assert.notEqual(reports[0], reports[1]);
  const deployments = [];
  for (const reportId of reports) {
    await page.goto(`${base}/lab?id=${strategy.id}&report=${reportId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
    await page.waitForFunction((id) => {
      const button = document.querySelector('button[aria-label="部署上线"]');
      return button && !button.disabled && button.dataset.reportId === id;
    }, reportId);
    const deployment = await deploySelectedReport();
    assert.equal(deployment.backtestReportId, reportId);
    deployments.push(deployment);
  }
  assert.notEqual(deployments[0].id, deployments[1].id);
  assert.deepEqual(deployments[0].config, deployments[1].config);
  const repeated = await Promise.all(
    Array.from({ length: 3 }, () => api('/api/app/signals/deployments', { reportId: reports[0] })),
  );
  assert.ok(repeated.every((deployment) => deployment.id === deployments[0].id));

  // Both a local draft and a saved draft must leave the selected report deployment unchanged.
  await page.locator('.jx-lab-code .monaco-editor').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n// Unrun draft edit');
  await page.getByRole('button', { name: '暂停上线', exact: true }).waitFor();
  await api(
    `/api/app/strategies/${strategy.id}`,
    {
      config: { ...config, initialCash: 2_000_000 },
    },
    'PATCH',
  );
  const frozen = await api(`/api/app/signals/deployments?strategyId=${strategy.id}`);
  assert.equal(frozen.filter((deployment) => deployment.status === 'active').length, 2);
  assert.ok(frozen.every((deployment) => deployment.config.initialCash === 1_000_000));

  await page.goto(`${base}/signals`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-deployment-id="${deployments[0].id}"]`).waitFor();
  await page.route('**/api/app/signals/run', async (route) => {
    await route.continue({
      postData: JSON.stringify({ ...route.request().postDataJSON(), tradeDate: '20260728' }),
    });
  });
  const runs = [];
  for (const deployment of deployments) {
    await page.locator(`[data-deployment-id="${deployment.id}"]`).click();
    const response = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/app/signals/run',
    );
    await page.getByRole('button', { name: '立即生成', exact: true }).click();
    const submitted = await (await response).json();
    await waitJob(`/api/app/signals/jobs/${submitted.jobId}`);
    const run = await api(`/api/app/signals/runs/${submitted.runId}`);
    assert.equal(run.deploymentId, deployment.id);
    runs.push(run);
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.locator('.jx-signals-table').waitFor({ timeout: 30_000 });
  }
  assert.notEqual(runs[0].id, runs[1].id);
  assert.deepEqual(runs[0].signals, runs[1].signals);
  await page.unroute('**/api/app/signals/run');

  await page.locator(`[data-deployment-id="${deployments[0].id}"]`).click();
  const pausedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `/api/app/signals/deployments/${deployments[0].id}/pause`,
  );
  await page.getByRole('button', { name: '暂停部署', exact: true }).click();
  assert.equal((await pausedResponse).status(), 200);
  await page.waitForFunction(
    () => document.querySelector('.jx-signals-actions button')?.disabled === true,
  );
  const afterPause = await api(`/api/app/signals/deployments?strategyId=${strategy.id}`);
  assert.equal(
    afterPause.find((deployment) => deployment.id === deployments[1].id).status,
    'active',
  );
  await page.locator('.jx-signals-historyRow').first().waitFor();
  await page.screenshot({ path: `${screenshots}report-deployments-zh.png`, fullPage: true });

  await page.getByRole('link', { name: `回测报告 ${reports[0]}`, exact: true }).click();
  await page.getByRole('button', { name: '部署上线', exact: true }).waitFor();
  const restarted = await deploySelectedReport();
  assert.equal(restarted.backtestReportId, reports[0]);
  assert.notEqual(restarted.id, deployments[0].id);
  assert.deepEqual(await api(`/api/app/signals/runs?deploymentId=${restarted.id}`), []);
  assert.equal((await api(`/api/app/signals/runs?deploymentId=${deployments[0].id}`)).length, 1);

  await page.goto(`${base}/signals`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-deployment-id="${deployments[0].id}"]`).click();
  await page.getByText('EN', { exact: true }).click();
  await page.getByRole('heading', { name: 'Daily signals', exact: true }).waitFor();
  await page.screenshot({ path: `${screenshots}report-deployments-en.png`, fullPage: true });
  await page.setViewportSize({ width: 760, height: 1000 });
  await page.screenshot({ path: `${screenshots}report-deployments-mobile.png`, fullPage: true });
  assert.deepEqual(pageErrors, []);
  console.log(
    `[report-deployments] PASS reports=${reports.join(',')} deployments=${[...deploymentIds].join(',')}`,
  );
} catch (error) {
  await page
    .screenshot({ path: `${screenshots}report-deployments-error.png`, fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  for (const deploymentId of deploymentIds) {
    await api(`/api/app/signals/deployments/${deploymentId}/pause`, {}).catch(() => {});
  }
  await browser.close();
}
