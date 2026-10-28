import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const shots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let documentId;
try {
  const login = await context.request.post(`${base}/api/auth/dev/login`, {
    data: { email: `e2e-macro-retirement-${Date.now()}@test.com` },
  });
  assert.equal(login.status(), 200);
  const catalogResponse = await context.request.get(`${base}/api/app/factors/catalog`);
  assert.equal(catalogResponse.status(), 200);
  const catalog = await catalogResponse.json();
  for (const key of [
    'cgb_yield_decline_20',
    'cgb_curve_slope_10y_2y',
    'cgb_curve_curvature_2y_5y_10y',
    'china_growth_inflation_regime_v1',
  ]) {
    assert.equal(
      catalog.some((entry) => entry.key === key),
      false,
      key,
    );
  }
  assert.ok(catalog.some((entry) => entry.key === 'etf_trend_20'));
  const created = await context.request.post(`${base}/api/app/research/documents`, {
    data: { template: 'blank' },
  });
  assert.equal(created.status(), 200);
  let document = await created.json();
  documentId = document.id;
  const cellId = document.cells.find((cell) => cell.kind === 'python').id;
  for (const method of ['yield_curve', 'macro', 'fx']) {
    const cell = document.cells.find((item) => item.id === cellId);
    const patched = await context.request.patch(`${base}/api/app/research/cells/${cellId}`, {
      data: {
        source: `data.${method}("removed", start="20240101", end="20241231")`,
        expectedRevision: cell.revision,
      },
    });
    assert.equal(patched.status(), 200);
    const executed = await context.request.post(`${base}/api/app/research/cells/${cellId}/run`);
    assert.equal(executed.status(), 200);
    document = await executed.json();
    const failed = document.cells.find((item) => item.id === cellId);
    assert.equal(failed.status, 'error');
    assert.match(JSON.stringify(failed), new RegExp(method));
  }
  await page.goto(`${base}/research?document=${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('research-document').waitFor();
  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.waitFor();
  await drawer.getByText('数据集', { exact: true }).click();
  assert.equal(await drawer.getByRole('radio', { name: '数据集', exact: true }).isChecked(), true);
  await drawer.getByText('可用数据集', { exact: true }).waitFor();
  for (const method of ['yield_curve', 'macro', 'fx']) {
    assert.equal(await page.getByTestId(`research-data-catalog-method-${method}`).count(), 0);
  }
  await page.getByTestId('research-data-catalog-method-index_valuation').waitFor();
  await drawer.screenshot({
    path: `${shots}macro-retirement-catalog-zh.png`,
    animations: 'disabled',
  });
  await drawer.getByRole('button', { name: '关闭' }).click();
  await drawer.waitFor({ state: 'hidden' });
  await page.getByText('EN', { exact: true }).click();
  await page.getByTestId('research-open-data-catalog').click();
  const englishDrawer = page.getByRole('dialog', { name: 'Data catalog' });
  await englishDrawer.getByText('Available datasets', { exact: true }).waitFor();
  await englishDrawer.getByTestId('research-data-catalog-method-index_valuation').waitFor();
  await englishDrawer.screenshot({
    path: `${shots}macro-retirement-catalog-en.png`,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    '[macro-retirement] saved calls rejected, curve and macro templates absent, bilingual catalog retained',
  );
} finally {
  if (documentId) {
    await context.request.delete(`${base}/api/app/research/documents/${documentId}`);
  }
  await context.close();
  await browser.close();
}
