import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

try {
  const login = await context.request.post(`${base}/api/auth/dev/login`, {
    data: { email: `research-retirement-${Date.now()}@fixture.invalid` },
  });
  assert.equal(login.status(), 200);
  const catalogResponse = await context.request.get(`${base}/api/app/factors/catalog`);
  assert.equal(catalogResponse.status(), 200);
  const catalog = await catalogResponse.json();
  assert.equal(
    catalog.some((factor) => ['mf_net_main', 'mf_net_total'].includes(factor.key)),
    false,
  );
  await page.goto(`${base}/research`);
  await page.locator('.jx-research-landing').waitFor();
  await page.locator('.jx-research-sidebarSkeleton').waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('research-create-fcff-valuation').count(), 0);
  await page.screenshot({ path: `${screenshots}/research-simple-home-zh.png`, fullPage: true });
  await page.getByText('EN', { exact: true }).last().click();
  await page.getByRole('heading', { name: 'New research', exact: true }).waitFor();
  assert.equal(await page.locator('.jx-research-templateStarter').count(), 0);
  await page.screenshot({ path: `${screenshots}/research-simple-home-en.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(
    () => document.querySelector('.jx-research-sidebar').getBoundingClientRect().right <= 0,
  );
  await page.screenshot({ path: `${screenshots}/research-simple-home-mobile.png`, fullPage: true });

  for (const template of ['index_relationship', 'equity_fcff_valuation']) {
    const rejected = await context.request.post(`${base}/api/app/research/documents`, {
      data: { template },
    });
    assert.equal(rejected.status(), 400);
  }
  const created = await context.request.post(`${base}/api/app/research/documents`, {
    data: { template: 'blank' },
  });
  assert.equal(created.status(), 200);
  let document = await created.json();
  assert.deepEqual(
    document.cells.map((cell) => cell.kind),
    ['markdown', 'python'],
  );
  const cellId = document.cells.find((cell) => cell.kind === 'python').id;
  for (const source of [
    'data.equity_flows("600000.SH", start="20260101", end="20260107")',
    'valuation.fcff_scenarios(None, None, None)',
    'valuation.implied_revenue_growth(None, None, None)',
    [
      'frame = pd.DataFrame({',
      '    "date": ["20260105", "20260106", "20260107"],',
      '    "value": [40, 42, 41],',
      '})',
      'charts.line(frame, x="date", y="value")',
    ].join('\n'),
  ]) {
    const cell = document.cells.find((item) => item.id === cellId);
    const updated = await context.request.patch(`${base}/api/app/research/cells/${cellId}`, {
      data: { source, expectedRevision: cell.revision },
    });
    assert.equal(updated.status(), 200);
    const saved = await context.request.get(`${base}/api/app/research/documents/${document.id}`);
    assert.equal((await saved.json()).cells.find((item) => item.id === cellId).source, source);
    const run = await context.request.post(`${base}/api/app/research/cells/${cellId}/run`);
    assert.equal(run.status(), 200);
    document = await run.json();
    const executed = document.cells.find((item) => item.id === cellId);
    assert.equal(
      executed.status,
      source.startsWith('valuation.') || source.startsWith('data.equity_flows')
        ? 'error'
        : 'success',
      JSON.stringify(executed),
    );
    assert.equal(executed.source, source);
    if (source.startsWith('valuation.') || source.startsWith('data.equity_flows')) {
      assert.match(
        JSON.stringify(executed.outputs),
        source.startsWith('data.') ? /equity_flows/ : /name 'valuation' is not defined/,
      );
    } else {
      assert.equal(
        executed.outputs.some((output) => output.type === 'chart' && output.kind === 'line'),
        true,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/research?document=${document.id}`);
  await page.getByTestId('research-document').waitFor();
  await page.getByTestId('research-interactive-chart').locator('canvas').first().waitFor();
  await page.waitForTimeout(400);
  await page.getByTestId('research-open-data-catalog').click();
  const dataCatalog = page.getByRole('dialog');
  await dataCatalog.waitFor();
  await dataCatalog.getByText('Datasets', { exact: true }).click();
  await page.getByTestId('research-data-catalog-method-equity_financial_values').waitFor();
  assert.equal(await page.getByTestId('research-data-catalog-method-equity_flows').count(), 0);
  await dataCatalog.screenshot({ path: `${screenshots}/research-retained-data-catalog-en.png` });
  await page.keyboard.press('Escape');
  await dataCatalog.waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${screenshots}/research-simple-chart-en.png`, fullPage: true });
  const archived = await context.request.post(
    `${base}/api/app/research/documents/${document.id}/archive`,
  );
  assert.equal(archived.status(), 200);
  assert.deepEqual(errors, []);
  console.log(
    '[research-extension-retirement] bilingual/mobile blank research, retired templates and SDK, unchanged source, ordinary Python/chart passed',
  );
} finally {
  await context.close();
  await browser.close();
}
