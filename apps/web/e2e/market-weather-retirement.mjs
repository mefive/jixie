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
    data: { email: `market-retirement-${Date.now()}@fixture.invalid` },
  });
  assert.equal(login.status(), 200);
  await page.goto(base);
  await page.waitForURL('**/research');
  await page.locator('.jx-research').waitFor();
  assert.equal(await page.locator('a[href="/market"]').count(), 0);
  await page.locator('.jx-research-sidebarSkeleton').waitFor({ state: 'detached' });
  await page.screenshot({
    path: `${screenshots}/market-weather-retired-home-zh.png`,
    fullPage: true,
  });
  await page.getByText('EN', { exact: true }).last().click();
  await page.locator('.jx-topnav').getByRole('link', { name: 'Research', exact: true }).waitFor();
  assert.equal(await page.locator('a[href="/market"]').count(), 0);
  await page.screenshot({
    path: `${screenshots}/market-weather-retired-home-en.png`,
    fullPage: true,
  });
  await page.goto(`${base}/market`);
  await page.waitForURL('**/research');
  await page.locator('.jx-research').waitFor();
  await page.goto(`${base}/retired-unknown-bookmark`);
  await page.waitForURL('**/research');
  await page.locator('.jx-research').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.jx-research-sidebarSkeleton').waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => document.querySelector('.jx-research-sidebar').getBoundingClientRect().right <= 0,
  );
  await page.screenshot({
    path: `${screenshots}/market-weather-retired-home-mobile.png`,
    fullPage: true,
  });
  for (const query of ['', '?dimension=industry&frequency=month', '?dimension=unknown']) {
    assert.equal(
      (await context.request.get(`${base}/api/app/market/weather${query}`)).status(),
      404,
    );
  }

  const created = await context.request.post(`${base}/api/app/research/documents`, {
    data: { template: 'blank' },
  });
  assert.equal(created.status(), 200);
  let document = await created.json();
  const cellId = document.cells.find((cell) => cell.kind === 'python').id;
  for (const source of [
    'data.market_state("all", start="20200101", end="20251231")',
    'data.industry_state("801010.SI", start="20200101", end="20251231")',
    'print("ordinary Python still works")',
  ]) {
    const cell = document.cells.find((item) => item.id === cellId);
    const updated = await context.request.patch(`${base}/api/app/research/cells/${cellId}`, {
      data: { source, expectedRevision: cell.revision },
    });
    assert.equal(updated.status(), 200);
    const run = await context.request.post(`${base}/api/app/research/cells/${cellId}/run`);
    assert.equal(run.status(), 200);
    document = await run.json();
    const executed = document.cells.find((item) => item.id === cellId);
    assert.equal(
      executed.status,
      source.startsWith('data.') ? 'error' : 'success',
      JSON.stringify(executed),
    );
    if (source.startsWith('data.')) {
      assert.match(JSON.stringify(executed.outputs), /has no attribute/);
    }
  }
  assert.equal(
    (
      await context.request.post(`${base}/api/app/research/documents/${document.id}/runtime/reset`)
    ).status(),
    200,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  const valuation = await context.request.get(`${base}/api/app/market/index-valuations/000300.SH`);
  assert.equal(valuation.status(), 200);
  await page.goto(`${base}/valuation`);
  await page.locator('.jx-valuation-summary').waitFor();
  await page.locator('.jx-valuation-chartCard canvas').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${screenshots}/market-weather-retained-valuation-en.png`,
    fullPage: true,
  });
  await page.getByText('中', { exact: true }).last().click();
  await page.getByRole('heading', { name: '沪深300历史估值' }).waitFor();
  await page.locator('.jx-valuation-indexSelect').click();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
  const changed = page.waitForResponse((response) =>
    response.url().includes('/api/app/market/index-valuations/000905.SH'),
  );
  await dropdown.getByText('中证500 · 000905.SH', { exact: true }).click();
  assert.equal((await changed).status(), 200);
  await dropdown.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: '中证500历史估值' }).waitFor();
  await page
    .locator('.jx-valuation-chartControls .ant-segmented-item', { hasText: '市净率 PB' })
    .click();
  await page.locator('.jx-valuation-chartCard canvas').waitFor();
  await page
    .locator('.jx-valuation-chartControls .ant-segmented-item-selected', { hasText: '市净率 PB' })
    .waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: `${screenshots}/market-weather-retained-valuation-zh.png`,
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    '[market-weather-retirement] Research homepage, bilingual/mobile navigation, old bookmark, retired HTTP/SDK, ordinary Python and official valuation passed',
  );
} finally {
  await context.close();
  await browser.close();
}
