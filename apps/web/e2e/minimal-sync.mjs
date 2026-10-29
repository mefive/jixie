import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

assert.equal(process.env.E2E_ISOLATED_DB, '1', 'Requires the disposable job fixture');
assert.ok(process.env.DATABASE_URL?.startsWith('file:'));
const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const database = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const { withDatabase } = await import('../../api/dist/src/infra/database/prisma.js');
const { withMaintenanceLock, withMarketPublication } =
  await import('../../api/dist/src/infra/coordination/market-access.js');
const { writeFinancialPartition } = await import('../../api/dist/src/market/fundamentals/write.js');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const base = process.env.E2E_BASE;
let documentId;
const id = `e2e-dividend-${Date.now()}`;
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function request(path, method = 'GET', data) {
  const response = await context.request.fetch(`${base}${path}`, {
    method,
    ...(data === undefined ? {} : { data }),
  });
  assert.equal(response.status(), 200, await response.text());
  return response.json();
}
async function publish(cashDiv, date) {
  await withDatabase(database, () =>
    withMaintenanceLock(() =>
      withMarketPublication(() =>
        database.$transaction(async (transaction) => {
          await writeFinancialPartition(
            transaction,
            {
              tables: [
                {
                  table: 'Dividend',
                  records: [
                    {
                      values: {
                        id,
                        tsCode: '600519.SH',
                        endDate: '20251231',
                        annDate: '20260301',
                        exDate: '20260601',
                        divProc: '实施',
                        cashDiv,
                      },
                    },
                  ],
                },
              ],
              status: 'partial',
              gaps: [],
              errors: [],
              observedDates: [],
              checks: {
                terminalPage: false,
                sourceFailed: false,
                emptyResponse: false,
                invalidRows: 0,
                pages: 1,
                sourceRows: 1,
              },
            },
            {
              dataset: 'dividends',
              scope: '600519.SH',
              startDate: '20250101',
              endDate: '20251231',
            },
            new Date(date),
          );
          await transaction.marketDataState.upsert({
            where: { key: 'global' },
            create: { key: 'global', revision: 1 },
            update: { revision: { increment: 1 } },
          });
        }),
      ),
    ),
  );
}
try {
  assert.deepEqual(
    await database.$queryRaw`SELECT name FROM sqlite_master WHERE name IN ('MarketRecordEvidence','MaintenanceState','MaintenanceCheckpoint','MarketCalculationState')`,
    [],
  );
  await publish(1, '2026-06-02T02:00:00Z');
  await request('/api/auth/dev/login', 'POST', {
    email: `e2e-minimal-sync-${Date.now()}@test.com`,
  });
  let document = await request('/api/app/research/documents', 'POST', { template: 'blank' });
  documentId = document.id;
  const first = document.cells.find((cell) => cell.kind === 'python');
  await request(`/api/app/research/cells/${first.id}`, 'PATCH', {
    expectedRevision: first.revision,
    source:
      'dividends = data.equity_dividends("600519.SH", start="20260101", end="20261231")\nprint(dividends[["date", "ex_date", "observed_at", "cash_dividend_pre_tax"]].to_string(index=False))',
  });
  document = await request(`/api/app/research/documents/${documentId}/cells`, 'POST', {
    kind: 'python',
    source: 'print("CAPTURED_DIVIDEND", float(dividends["cash_dividend_pre_tax"].max()))',
  });
  const second = document.cells.at(-1);
  document = (await request(`/api/app/research/cells/${first.id}/run-affected`, 'POST')).document;
  assert.equal(
    document.cells.find((cell) => cell.id === second.id).status,
    'success',
    JSON.stringify(document.cells),
  );
  assert.match(
    JSON.stringify(document.cells.find((cell) => cell.id === second.id).outputs),
    /CAPTURED_DIVIDEND.*1\.0/,
  );
  await publish(2, '2026-07-01T02:00:00Z');
  document = await request(`/api/app/research/cells/${second.id}/run`, 'POST');
  const invalidated = document.cells.find((cell) => cell.id === second.id);
  assert.equal(invalidated.status, 'error', JSON.stringify(invalidated.outputs));
  assert.match(JSON.stringify(invalidated.outputs), /NameError|not defined/);
  assert.doesNotMatch(JSON.stringify(invalidated.outputs), /CAPTURED_DIVIDEND.*1\.0/);
  document = (await request(`/api/app/research/cells/${first.id}/run-affected`, 'POST')).document;
  assert.equal(
    document.cells.find((cell) => cell.id === second.id).status,
    'success',
    JSON.stringify(document.cells),
  );
  assert.match(
    JSON.stringify(document.cells.find((cell) => cell.id === second.id).outputs),
    /CAPTURED_DIVIDEND.*2\.0/,
  );
  const status = await request('/api/maintenance/status');
  assert.equal(status.active, false);
  assert.notEqual(status.phase, 'postprocessing');
  await page.goto(`${base}/research?document=${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-research').waitFor();
  await page.locator('.jx-research-sidebarSkeleton').waitFor({ state: 'hidden' });
  await page
    .locator('.monaco-editor .view-lines')
    .filter({ hasText: 'data.equity_dividends' })
    .waitFor();
  await page
    .locator('.monaco-editor .view-lines')
    .filter({ hasText: 'CAPTURED_DIVIDEND' })
    .waitFor();
  await page.getByText('CAPTURED_DIVIDEND 2.0', { exact: false }).last().waitFor();
  assert.equal(await page.locator('.jx-maintenanceGate').count(), 0);
  await page.screenshot({
    path: new URL('../acceptance/minimal-sync-zh.png', import.meta.url).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('CAPTURED_DIVIDEND 2.0', { exact: false }).last().waitFor();
  await page.screenshot({
    path: new URL('../acceptance/minimal-sync-en.png', import.meta.url).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    '[minimal-sync] retired storage absent, typed dividend writer, captured availability, revision-driven Python rebuild and bilingual Research passed',
  );
} finally {
  try {
    if (documentId) {
      await context.request.delete(`${base}/api/app/research/documents/${documentId}`);
    }
    await withDatabase(database, () =>
      withMaintenanceLock(() =>
        withMarketPublication(() => database.dividend.deleteMany({ where: { id } })),
      ),
    );
  } finally {
    await database.$disconnect();
    await context.close();
    await browser.close();
  }
}
