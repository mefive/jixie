import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const require = createRequire(new URL('../../api/package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
const databaseUrl = `file:${fileURLToPath(new URL('../../api/prisma/dev.db', import.meta.url))}`;
mkdirSync(SHOTS, { recursive: true });

const suffix = Date.now();
const ownerEmail = `e2e-backtest-report-history-${suffix}@test.com`;
const strategyId = `e2e-backtest-report-history-strategy-${suffix}`;
const latestReportId = `e2e-backtest-report-history-latest-${suffix}`;
const historicalReportId = `e2e-backtest-report-history-old-${suffix}`;
const strategyName = `价值轮动历史验收 ${suffix}`;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let userId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);
  userId = (await database.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;
  await seedReports(userId);

  await page.goto(`${BASE}/lab?id=${encodeURIComponent(strategyId)}`, {
    waitUntil: 'domcontentloaded',
  });
  const history = page.getByTestId('backtest-report-history');
  await history.waitFor({ timeout: 30_000 });
  await page.getByText('最新 · 2026-09-01 18:05 · 26.00%', { exact: true }).waitFor();

  await history.click();
  const historicalOption = page
    .locator('.ant-select-item-option')
    .filter({ hasText: '历史 · 2026-08-01 18:05 · 8.00%' });
  await historicalOption.click();
  await page.getByText('8.00%', { exact: true }).first().waitFor({ timeout: 15_000 });
  await page.locator('.jx-lab-resultTabs').screenshot({
    path: `${SHOTS}backtest-report-history.png`,
  });

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
  if (!pythonCell?.source.includes(`results.backtest_report("${historicalReportId}")`)) {
    throw new Error('Research handoff did not preserve the selected historical report id.');
  }
  await researchPage.screenshot({
    path: `${SHOTS}research-backtest-report-handoff.png`,
    fullPage: true,
  });

  console.log('[backtest-report-history-e2e] history=pass research-handoff=pass screenshots=2');
} finally {
  await context.close();
  await browser.close();
  if (userId) {
    await database.session.deleteMany({ where: { userId } });
    await database.user.deleteMany({ where: { id: userId } });
  }
  await database.$disconnect();
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
      lastResult: latestResult,
    },
  });
  await database.backtestReport.createMany({
    data: [
      {
        id: latestReportId,
        userId: ownerId,
        strategyId,
        strategyName,
        status: 'done',
        config,
        payload: latestResult,
        createdAt: new Date('2026-09-01T10:00:00.000Z'),
        computedAt: new Date('2026-09-01T10:05:00.000Z'),
      },
      {
        id: historicalReportId,
        userId: ownerId,
        strategyId,
        strategyName,
        status: 'done',
        config: { ...config, start: '20210101', end: '20241231' },
        payload: reportResult(0.08, 0.74, 1_080_000),
        createdAt: new Date('2026-08-01T10:00:00.000Z'),
        computedAt: new Date('2026-08-01T10:05:00.000Z'),
      },
    ],
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
