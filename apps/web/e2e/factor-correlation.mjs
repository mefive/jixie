import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const databaseUrl =
  process.env.DATABASE_URL ??
  `file:${fileURLToPath(new URL('../../api/prisma/dev.db', import.meta.url))}`;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const failures = [];
const email = `e2e-factor-correlation-${Date.now()}@test.com`;
let userId;
page.on('pageerror', (error) => failures.push(error.message));
page.on('request', (request) => {
  const path = new URL(request.url()).pathname;
  if (path.includes('/analysis-jobs/') || path === '/api/app/factors/correlations/running') {
    failures.push(`Correlation used the wrong task route: ${path}`);
  }
});

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  const login = await page.evaluate(async (email) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return { status: response.status, body: await response.json() };
  }, email);
  assert.equal(login.status, 200);
  userId = login.body.user.id;
  await page.goto(`${base}/factors?factor=ep`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '相关性矩阵', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '因子相关性矩阵' });
  const selector = modal.getByRole('combobox');
  for (const [key, label] of [
    ['ep', '盈利收益率(1/PE_TTM)'],
    ['bp', '账面市值比(1/PB)'],
  ]) {
    await selector.fill(key);
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: label })
      .click();
  }
  await selector.press('Escape');
  await modal.getByText('因子相关性矩阵', { exact: true }).click();

  const submittedPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/factors/correlations',
  );
  const polledPromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith('/api/app/factors/correlation-jobs/'),
  );
  await modal.getByRole('button', { name: /计\s*算/ }).click();
  const submitted = await submittedPromise;
  assert.equal(submitted.status(), 200);
  assert.equal(new URL(submitted.url()).search, '');
  const body = submitted.request().postDataJSON();
  assert.deepEqual([...body.keys].sort(), ['bp', 'ep']);
  assert.equal(body.refresh, false);
  const reference = await submitted.json();
  assert.equal(typeof reference.jobId, 'string');
  const polled = await polledPromise;
  assert.equal(
    new URL(polled.url()).pathname,
    `/api/app/factors/correlation-jobs/${reference.jobId}`,
  );
  assert.equal(polled.status(), 200);
  await modal.locator('.jx-factor-corrChart canvas').first().waitFor({ timeout: 180_000 });

  // An unchanged submission must return the cached matrix without another job.
  const cachedPromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/app/factors/correlations',
  );
  await modal.getByRole('button', { name: /计\s*算/ }).click();
  const cached = await (await cachedPromise).json();
  assert.equal(cached.done, true);
  assert.deepEqual(cached.report.keys.filter((key) => key !== 'size').sort(), ['bp', 'ep']);

  // Simulate completion after active lookup; task logs and the matrix still come from the real API.
  await modal.locator('.ant-modal-close').click();
  await modal.waitFor({ state: 'hidden' });
  await page.route(
    '**/api/app/factors/correlation-jobs/active?*',
    (route) => route.fulfill({ json: reference }),
    { times: 1 },
  );
  const reattachedPromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/app/factors/correlation-jobs/${reference.jobId}` &&
      new URL(response.url()).searchParams.get('since') === '0',
  );
  await page.getByRole('button', { name: '相关性矩阵', exact: true }).click();
  assert.equal((await (await reattachedPromise).json()).status, 'done');
  await modal.locator('.jx-factor-corrChart canvas').first().waitFor({ timeout: 30_000 });
  await modal.screenshot({ path: `${screenshots}factor-correlation.png` });
  assert.deepEqual(failures, []);
  console.log('[factor-correlation-e2e] json-submit=pass job-poll=pass cache=pass reattach=pass');
} catch (error) {
  await page
    .screenshot({ path: `${screenshots}factor-correlation-error.png`, fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  if (userId) {
    await database.job.deleteMany({ where: { userId } });
    await database.factorCorrelation.deleteMany({ where: { userId } });
    await database.user.deleteMany({ where: { id: userId } });
  }
  await database.$disconnect();
}
