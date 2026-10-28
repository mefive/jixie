import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

assert.equal(process.env.E2E_ISOLATED_DB, '1', 'Only run against the isolated job fixture');
assert.ok(process.env.DATABASE_URL?.startsWith('file:'));
const execute = promisify(execFile);
const cli = new URL('../../api/dist/src/maintenance/cli/data.js', import.meta.url).pathname;
const run = async (...args) => {
  const result = await execute(process.execPath, [cli, ...args], {
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30_000,
  });
  return JSON.parse(result.stdout);
};
const originalEtfs = await run('etf', 'list');
const originalIndices = await run('index', 'list');
const base = process.env.E2E_BASE;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let documentId;
try {
  await run('etf', 'add', '510300.SH');
  await run('etf', 'add', '510300.SH');
  const added = await run('etf', 'list');
  assert.equal(added.rows.filter((row) => row.tsCode === '510300.SH').length, 1);
  assert.ok(added.rows.find((row) => row.tsCode === '510300.SH').coverage._count._all > 0);
  await run('etf', 'remove', '510300.SH');
  assert.equal(
    (await run('etf', 'list')).rows.some((row) => row.tsCode === '510300.SH'),
    false,
  );
  await run('index', 'add', '000016.SH');
  assert.ok((await run('index', 'list')).rows.some((row) => row.tsCode === '000016.SH'));
  await run('index', 'remove', '000016.SH');

  const login = await context.request.post(`${base}/api/auth/dev/login`, {
    data: { email: `e2e-download-lists-${Date.now()}@test.com` },
  });
  assert.equal(login.status(), 200);
  const response = await context.request.post(`${base}/api/app/research/documents`, {
    data: { template: 'blank' },
  });
  assert.equal(response.status(), 200);
  const document = await response.json();
  documentId = document.id;
  const cell = document.cells.find((row) => row.kind === 'python');
  const changed = await context.request.patch(`${base}/api/app/research/cells/${cell.id}`, {
    data: {
      source: 'data.etf_shares("510300.SH", start="20200101", end="20251231")',
      expectedRevision: cell.revision,
    },
  });
  assert.equal(changed.status(), 200);
  const execution = await context.request.post(`${base}/api/app/research/cells/${cell.id}/run`);
  assert.equal(execution.status(), 200);
  const failed = (await execution.json()).cells.find((row) => row.id === cell.id);
  assert.equal(failed.status, 'error');
  assert.match(JSON.stringify(failed.outputs), /etf_shares/);
  const prices = await context.request.get(
    `${base}/api/app/market/instruments/etf/510300.SH/series?start=20240101&end=20240331`,
  );
  assert.equal(prices.status(), 200);

  await page.goto(`${base}/research?document=${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.getByText('数据集', { exact: true }).click();
  await drawer.getByText('可用数据集', { exact: true }).waitFor();
  await drawer.getByTestId('research-data-catalog-method-index_valuation').waitFor();
  assert.equal(await drawer.getByTestId('research-data-catalog-method-etf_shares').count(), 0);
  await drawer.screenshot({
    path: new URL('../acceptance/download-lists-zh.png', import.meta.url).pathname,
    animations: 'disabled',
  });
  await drawer.getByRole('button', { name: '关闭' }).click();
  await drawer.waitFor({ state: 'hidden' });
  await page.getByText('EN', { exact: true }).click();
  await page.getByTestId('research-open-data-catalog').click();
  const english = page.getByRole('dialog', { name: 'Data catalog' });
  await english.getByText('Available datasets', { exact: true }).waitFor();
  await english.screenshot({
    path: new URL('../acceptance/download-lists-en.png', import.meta.url).pathname,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    '[download-lists] compiled CLI, idempotence, preserved historical prices, retired shares and bilingual catalog passed',
  );
} finally {
  if (documentId) {
    await context.request.delete(`${base}/api/app/research/documents/${documentId}`);
  }
  for (const [assetType, original] of [
    ['etf', originalEtfs],
    ['index', originalIndices],
  ]) {
    const current = await run(assetType, 'list');
    const expected = new Set(original.rows.map((row) => row.tsCode));
    for (const row of current.rows) {
      if (!expected.has(row.tsCode)) {
        await run(assetType, 'remove', row.tsCode);
      }
    }
    for (const code of expected) {
      await run(assetType, 'add', code);
    }
  }
  await context.close();
  await browser.close();
}
