import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');
const { ulid } = require('ulid');

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const databaseUrl =
  process.env.DATABASE_URL ??
  `file:${fileURLToPath(new URL('../../api/prisma/dev.db', import.meta.url))}`;
mkdirSync(SHOTS, { recursive: true });

const suffix = Date.now();
const ownerEmail = `e2e-backtest-latest-result-${suffix}@test.com`;
const strategyId = ulid();
const latestReportId = ulid();
const historicalReportId = ulid();
const strategyName = `最近结果验收 ${suffix}`;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const failures = [];
context.on('response', (response) => {
  if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) {
    failures.push(`${response.status()} ${response.url()}`);
  }
});
context.on('page', (openedPage) => {
  openedPage.on('pageerror', (error) => failures.push(error.message));
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let userId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);
  userId = (await database.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;
  await seedReports(userId);

  await page.goto(`${BASE}/strategy?id=${encodeURIComponent(strategyId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('backtest-report-open-research').waitFor({ timeout: 30_000 });
  await page.getByText('26.00%', { exact: true }).first().waitFor();
  assert.equal(await page.getByTestId('backtest-report-history').count(), 0);
  assert.equal(await page.getByTestId('backtest-report-compare-toggle').count(), 0);
  const retained = await context.request.get(
    `${BASE}/api/app/strategies/backtest-reports/${latestReportId}`,
  );
  const detail = await retained.json();
  assert.equal(retained.status(), 200);
  assert.equal('code' in detail.settings, false);
  assert.equal('codeHash' in detail, false);
  assert.equal('resultHash' in detail, false);
  await page.locator('.jx-strategy-chart canvas').first().waitFor();
  await page
    .locator('.jx-strategy-resultTabs')
    .screenshot({ path: `${SHOTS}backtest-latest-result-zh.png` });

  const popupPromise = page.waitForEvent('popup');
  await page.getByTestId('backtest-report-open-research').click();
  const researchPage = await popupPromise;
  researchPage.on('pageerror', (error) => console.log('[research-pageerror]', error.message));
  await researchPage.waitForURL(/\/research\?document=/, { timeout: 30_000 });
  await researchPage.getByTestId('research-document').waitFor({ timeout: 30_000 });
  const hideAgent = researchPage.getByRole('button', { name: '隐藏 Agent' });
  if (await hideAgent.isVisible()) {
    await hideAgent.click();
  }
  await researchPage.locator('.monaco-editor').first().waitFor({ timeout: 30_000 });

  const handoffDocument = await database.agentConversation.findFirstOrThrow({
    where: { userId, surface: 'research', title: `${strategyName} · 回测复核` },
    include: { researchDocument: { include: { cells: { orderBy: { position: 'asc' } } } } },
  });
  const pythonCell = handoffDocument.researchDocument?.cells.find((cell) => cell.kind === 'python');
  if (!pythonCell?.source.includes(`results.backtest_report("${latestReportId}")`)) {
    throw new Error('Research handoff did not preserve the retained report id.');
  }
  await researchPage.screenshot({
    path: `${SHOTS}research-backtest-report-handoff.png`,
    fullPage: true,
  });

  await researchPage.close();
  await page.evaluate(() => {
    localStorage.setItem('jx-locale', 'en');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('backtest-report-open-research').waitFor();
  await page.locator('.jx-strategy-chart canvas').first().waitFor();
  await page
    .locator('.jx-strategy-resultTabs')
    .screenshot({ path: `${SHOTS}backtest-latest-result-en.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}backtest-latest-result-mobile.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  const missing = await context.request.get(
    `${BASE}/api/app/strategies/backtest-reports/${historicalReportId}`,
  );
  assert.equal(missing.status(), 404);
  await page.goto(
    `${BASE}/strategy?id=${encodeURIComponent(strategyId)}&report=${historicalReportId}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('.jx-strategy-placeholder--error').waitFor();
  assert.equal(await page.getByTestId('backtest-report-open-research').count(), 0);
  assert.equal(await page.getByText('26.00%', { exact: true }).count(), 0);
  const unexpected = failures.filter((failure) => !failure.includes(historicalReportId));
  assert.deepEqual(unexpected, []);
  console.log(
    '[backtest-latest-result-e2e] latest=pass source-absent=pass old-link-fails=pass research=pass screenshots=4',
  );
} finally {
  try {
    if (userId) {
      const documents = await database.researchDocument.findMany({
        where: { userId },
        select: { id: true },
      });
      for (const document of documents) {
        const deleted = await context.request.delete(
          `${BASE}/api/app/research/documents/${document.id}`,
        );
        assert.equal(deleted.status(), 200, 'Research fixture cleanup failed');
      }
    }
  } finally {
    await context.close();
    await browser.close();
    if (userId) {
      await database.session.deleteMany({ where: { userId } });
      await database.user.deleteMany({ where: { id: userId } });
    }
    await database.$disconnect();
  }
}

async function seedReports(ownerId) {
  const config = {
    name: strategyName,
    start: '20200101',
    end: '20251231',
    initialCash: 1_000_000,
    cost: { slippageBps: 2, impactCoef: 0.1 },
    language: 'typescript',
    runtimeVersion: 'ts-v1',
    code: 'export default defineStrategy({ onBar() {} });',
  };
  const latestResult = reportResult(0.26, 1.42, 1_260_000);
  await database.strategy.create({
    data: {
      id: strategyId,
      userId: ownerId,
      name: strategyName,
      config,
    },
  });
  const { code: _code, ...settings } = config;
  await database.backtestReport.create({
    data: {
      id: latestReportId,
      userId: ownerId,
      strategyId,
      strategyName,
      legacyStatus: 'done',
      settings,
      payload: latestResult,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      computedAt: new Date('2026-09-01T10:05:00Z'),
    },
  });
}

function reportResult(totalReturn, sharpe, finalValue) {
  return {
    name: strategyName,
    start: '20200101',
    end: '20251231',
    days: 100,
    initialCash: 1_000_000,
    finalValue,
    totalReturn,
    annReturn: totalReturn / 3,
    sharpe,
    maxDrawdown: -0.09,
    trades: 12,
    tradeLog: [],
    nav: [
      { date: '20200102', value: 1_000_000 },
      { date: '20251231', value: finalValue },
    ],
  };
}

async function devLogin(pageHandle, email) {
  const status = await pageHandle.evaluate(async (loginEmail) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: loginEmail }),
    });
    return response.status;
  }, email);
  if (status !== 200) {
    throw new Error(`dev login failed for ${email}: ${status}`);
  }
}
