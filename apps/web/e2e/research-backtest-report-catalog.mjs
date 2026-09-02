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
const ownerEmail = `e2e-research-backtest-catalog-${suffix}@test.com`;
const title = '回测报告目录验收';
const strategyId = `e2e-backtest-catalog-strategy-${suffix}`;
const reportId = `e2e-backtest-catalog-report-${suffix}`;
const scanReportId = `e2e-backtest-catalog-scan-${suffix}`;
const strategyName = `价值轮动验收 ${suffix}`;
const database = new PrismaClient({ datasourceUrl: databaseUrl });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
let userId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);
  userId = (await database.user.findUniqueOrThrow({ where: { email: ownerEmail } })).id;

  const document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  const pythonCell = document.cells.find((cell) => cell.kind === 'python');
  if (!pythonCell) {
    throw new Error('Blank Research document did not create a Python Cell.');
  }
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  await seedBacktestReport(userId);

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 });

  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.waitFor();
  await drawer.getByText('回测报告', { exact: true }).click();
  await drawer.getByText('results.backtest_report', { exact: true }).waitFor({ timeout: 15_000 });
  await drawer
    .getByText('results.strategy_scan_report', { exact: true })
    .waitFor({ timeout: 15_000 });

  const reportSearch = drawer.getByRole('textbox', { name: '搜索策略名称或报告 ID' });
  await reportSearch.fill('价值轮动验收');
  const report = page.getByTestId(`research-data-catalog-backtest-report-${reportId}`);
  await report.waitFor({ timeout: 15_000 });
  await report.click();

  const reportConfig = page.getByTestId('research-data-catalog-backtest-report-config');
  await reportConfig.waitFor();
  const configText = await reportConfig.innerText();
  if (!configText.includes('2020-01-01 – 2025-12-31')) {
    throw new Error('The frozen backtest period was not shown.');
  }
  if (!configText.includes(`results.backtest_report("${reportId}")`)) {
    throw new Error('The selected report did not generate an SDK call preview.');
  }
  const insert = page.getByTestId('research-data-catalog-insert');
  if (!(await insert.isEnabled())) {
    throw new Error('A completed backtest report must be insertable.');
  }
  await reportConfig.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await drawer.screenshot({ path: `${SHOTS}research-backtest-report-catalog.png` });

  const scan = page.getByTestId(`research-data-catalog-strategy-scan-${scanReportId}`);
  await scan.waitFor({ timeout: 15_000 });
  await scan.click();
  const scanConfig = page.getByTestId('research-data-catalog-strategy-scan-config');
  await scanConfig.waitFor();
  if (!(await scanConfig.innerText()).includes(`results.strategy_scan_report("${scanReportId}")`)) {
    throw new Error('The strategy scan did not generate an SDK call preview.');
  }
  await scanConfig.scrollIntoViewIfNeeded();
  await drawer.screenshot({ path: `${SHOTS}research-strategy-scan-catalog.png` });

  await report.click();
  await reportConfig.waitFor();

  await insert.click();
  await drawer.waitFor({ state: 'detached' });
  await page.getByTestId('research-document').click({ position: { x: 8, y: 8 } });
  const insertedCall = `results.backtest_report("${reportId}")`;
  let savedPythonCell;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(500);
    savedPythonCell = await database.researchCell.findUnique({ where: { id: pythonCell.id } });
    if (savedPythonCell?.source.includes(insertedCall)) {
      break;
    }
  }
  if (!savedPythonCell?.source.includes(insertedCall)) {
    throw new Error('The backtest report lookup was not inserted and autosaved.');
  }

  console.log(
    '[research-backtest-report-catalog-e2e] search=pass scan=pass insert=pass screenshots=2',
  );
} finally {
  if (documentId) {
    await devLogin(page, ownerEmail).catch(() => {});
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/research/conversations/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      }, documentId)
      .catch(() => {});
  }
  await database.backtestReport.deleteMany({ where: { id: reportId } });
  await database.strategyScanReport.deleteMany({ where: { id: scanReportId } });
  await database.strategy.deleteMany({ where: { id: strategyId } });
  if (userId) {
    await database.session.deleteMany({ where: { userId } });
    await database.user.deleteMany({ where: { id: userId } });
  }
  await database.$disconnect();
  await context.close();
  await browser.close();
}

async function seedBacktestReport(ownerId) {
  const now = new Date();
  const config = {
    name: strategyName,
    start: '20200101',
    end: '20251231',
    initialCash: 1_000_000,
    cost: { slippageBps: 2, impactCoef: 0.1 },
    language: 'python',
    runtimeVersion: 'py-v1',
    code: 'def strategy(context):\n    pass',
  };
  await database.strategy.create({
    data: { id: strategyId, userId: ownerId, name: strategyName, config },
  });
  await database.backtestReport.create({
    data: {
      id: reportId,
      userId: ownerId,
      strategyId,
      strategyName,
      status: 'done',
      config,
      codeHash: 'e2e-code-hash',
      resultHash: 'e2e-result-hash',
      payload: {
        metrics: { totalReturn: 0.24, annualizedReturn: 0.11, maxDrawdown: -0.08 },
        nav: [
          { date: '20200102', nav: 1 },
          { date: '20251231', nav: 1.24 },
        ],
        tradeLog: [],
      },
      createdAt: now,
      computedAt: now,
    },
  });
  await database.strategyScanReport.create({
    data: {
      id: scanReportId,
      userId: ownerId,
      strategyId,
      strategyName,
      status: 'done',
      config,
      spec: {
        dimensions: [{ key: 'window', values: [10, 20, 30] }],
        splitDate: '20240101',
      },
      codeHash: 'e2e-code-hash',
      dataCutoff: '20251231',
      payload: {
        parameters: { window: 20 },
        cells: [{ params: { window: 20 }, full: { sharpe: 1.2 } }],
      },
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function api(pageHandle, path, init) {
  return pageHandle.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        headers: { 'content-type': 'application/json' },
        ...requestInit,
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(JSON.stringify(body));
      }
      return body;
    },
    { requestPath: path, requestInit: init },
  );
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
