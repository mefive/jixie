import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
let strategyId = null;

page.on('pageerror', (error) => pageErrors.push(error.message));

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

  const seeded = await page.evaluate(async () => {
    const code = [
      "let last = '';",
      'export default defineStrategy({',
      "  name: 'Parameter scan E2E',",
      "  params: { lookback: 3, shares: 100, sizing: 'fixed' },",
      "  watch: ['510300.SH'],",
      '  onBar(ctx) {',
      "    const period = ctx.period('monthly');",
      '    const history = ctx.history("510300.SH", "close", ctx.params.lookback);',
      '    if (period !== last && history.length === ctx.params.lookback) {',
      '      last = period;',
      "      if (ctx.params.sizing === 'equal') ctx.orderTargetPercent('510300.SH', 1);",
      "      else if (ctx.params.sizing === 'atr') ctx.order('510300.SH', ctx.atrUnits('510300.SH', 0.01, 2));",
      "      else ctx.order('510300.SH', ctx.params.shares);",
      '    }',
      '  },',
      '});',
    ].join('\n');
    const response = await fetch('/api/app/strategies', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '参数扫描验收',
        start: '20240101',
        end: '20240331',
        initialCash: 1_000_000,
        cost: { slippageBps: 2, impactCoef: 0.1 },
        code,
      }),
    });
    return { status: response.status, body: await response.json() };
  });
  if (seeded.status !== 200 || !seeded.body.id) {
    throw new Error(`strategy seed failed: ${JSON.stringify(seeded)}`);
  }
  strategyId = seeded.body.id;

  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-lab-code .monaco-editor').waitFor({ timeout: 30_000 });
  const runAction = page.getByRole('button', { name: '运行回测' });
  const scanAction = page.getByRole('button', { name: '参数扫描' }).first();
  const deployAction = page.getByRole('button', { name: '部署上线' });
  const editAction = page.getByRole('button', { name: '编辑启动参数' });
  for (const [label, action] of [
    ['run', runAction],
    ['scan', scanAction],
    ['deploy', deployAction],
    ['edit', editAction],
  ]) {
    if ((await action.textContent()).trim()) {
      throw new Error(`${label} action should be icon-only`);
    }
  }
  await scanAction.hover();
  await page.getByRole('tooltip').filter({ hasText: '参数扫描' }).waitFor();
  await scanAction.click();
  await page.getByRole('dialog', { name: '扫描与仓位对比' }).waitFor();
  await page.locator('.jx-parameterScan-dimension .ant-input').first().waitFor({
    timeout: 15_000,
  });
  await page.locator('.jx-parameterScan-dimension .ant-input').first().fill('2, 3');
  await page.getByRole('checkbox', { name: '扫描第二个参数' }).check();
  await page.locator('.jx-parameterScan-dimension .ant-input').nth(1).fill('100, 200');
  await page.getByRole('button', { name: '开始扫描' }).click();

  await page.getByRole('tab', { name: '参数扫描' }).click();
  await Promise.race([
    page.locator('.jx-parameterScan-chart canvas').first().waitFor({ timeout: 120_000 }),
    page.locator('.jx-parameterScan-error').waitFor({ timeout: 120_000 }),
  ]);
  const scanError = await page
    .locator('.jx-parameterScan-error')
    .textContent()
    .catch(() => null);
  if (scanError) {
    throw new Error(`parameter scan failed: ${scanError}`);
  }
  const rowCount = await page
    .locator('.jx-parameterScan-table .ant-table-row[data-row-key]')
    .count();
  if (rowCount !== 4) {
    throw new Error(`expected four scan cells, got ${rowCount}`);
  }

  const persisted = await page.evaluate(async (id) => {
    const strategy = await (await fetch(`/api/app/strategies/${id}`)).json();
    const reports = await (await fetch(`/api/app/strategy/scans?strategyId=${id}`)).json();
    const detail = await (await fetch(`/api/app/strategy/scans/${reports[0].id}`)).json();
    return { strategy, reports, detail };
  }, strategyId);
  if (persisted.strategy.lastResult != null) {
    throw new Error('parameter scan overwrote Strategy.lastResult');
  }
  if (persisted.detail.status !== 'done' || persisted.detail.payload?.cells?.length !== 4) {
    throw new Error(`invalid persisted scan: ${JSON.stringify(persisted.detail)}`);
  }

  await page.getByRole('button', { name: '参数扫描' }).first().click();
  await page.getByRole('dialog', { name: '扫描与仓位对比' }).waitFor();
  await page.getByText('仓位方案对比', { exact: true }).click();
  await page.locator('.jx-parameterScan-dimension .ant-input').first().waitFor();
  await page.locator('.jx-parameterScan-dimension .ant-input').first().fill('equal, fixed, atr');
  await page.getByRole('button', { name: '开始扫描' }).click();
  await page.locator('.jx-parameterScan-progress').waitFor({ timeout: 30_000 });
  await page.locator('.jx-parameterScan-progress').waitFor({ state: 'detached', timeout: 120_000 });
  await page.locator('.jx-parameterScan-chart canvas').first().waitFor({ timeout: 30_000 });
  const sizingRows = await page
    .locator('.jx-parameterScan-table .ant-table-row[data-row-key]')
    .count();
  if (sizingRows !== 3) {
    throw new Error(`expected three sizing schemes, got ${sizingRows}`);
  }
  const sizingReport = await page.evaluate(async (id) => {
    const reports = await (await fetch(`/api/app/strategy/scans?strategyId=${id}`)).json();
    return await (await fetch(`/api/app/strategy/scans/${reports[0].id}`)).json();
  }, strategyId);
  if (
    sizingReport.spec?.view !== 'sizing' ||
    sizingReport.payload?.cells?.length !== 3 ||
    sizingReport.payload.cells.some((cell) => !Array.isArray(cell.nav) || cell.nav.length === 0)
  ) {
    throw new Error(`invalid sizing report: ${JSON.stringify(sizingReport)}`);
  }
  if (pageErrors.length) {
    throw new Error(`page errors: ${JSON.stringify(pageErrors)}`);
  }

  await runAction.hover();
  await page.getByRole('tooltip').filter({ hasText: '运行回测' }).waitFor();
  await page.screenshot({ path: `${SHOTS}strategy-parameter-scan.png`, fullPage: true });
  console.log(
    `[strategy-parameter-scan] PASS id=${strategyId} parameterCells=${rowCount} sizingCells=${sizingRows}`,
  );
} catch (error) {
  await page
    .screenshot({ path: `${SHOTS}strategy-parameter-scan-error.png`, fullPage: true })
    .catch(() => {});
  if (strategyId) {
    const diagnostic = await page
      .evaluate(async (id) => {
        const reports = await (await fetch(`/api/app/strategy/scans?strategyId=${id}`)).json();
        const detail = reports[0]
          ? await (await fetch(`/api/app/strategy/scans/${reports[0].id}`)).json()
          : null;
        return { reports, detail };
      }, strategyId)
      .catch(() => null);
    console.error('[strategy-parameter-scan] diagnostic', JSON.stringify(diagnostic));
  }
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
