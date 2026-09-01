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
const ownerEmail = `e2e-research-report-catalog-${suffix}@test.com`;
const title = 'Factor 报告目录验收';
const factorId = `e2e-report-catalog-factor-${suffix}`;
const factorKey = `e2e_value_quality_${suffix}`;
const exploreReportId = `e2e-report-catalog-explore-${suffix}`;
const holdoutReportId = `e2e-report-catalog-holdout-${suffix}`;
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
  await seedReports(userId);

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 });

  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.waitFor();
  await drawer.getByText('Factor 报告', { exact: true }).click();
  await drawer.getByText('results.factor_report', { exact: true }).waitFor({ timeout: 15_000 });

  const reportSearch = drawer.getByRole('textbox', {
    name: '搜索 Factor 名称、Key 或报告 ID',
  });
  await reportSearch.fill('价值质量');
  const exploreReport = page.getByTestId(`research-data-catalog-report-${exploreReportId}`);
  const holdoutReport = page.getByTestId(`research-data-catalog-report-${holdoutReportId}`);
  await exploreReport.waitFor({ timeout: 15_000 });
  await holdoutReport.waitFor({ timeout: 15_000 });

  await holdoutReport.click();
  const reportConfig = page.getByTestId('research-data-catalog-report-config');
  await reportConfig.waitFor();
  if (!(await reportConfig.innerText()).includes('Holdout 尚未揭示')) {
    throw new Error('The sealed Holdout explanation was not shown.');
  }
  const insert = page.getByTestId('research-data-catalog-insert');
  if (await insert.isEnabled()) {
    throw new Error('An unrevealed Holdout report must not be insertable.');
  }
  await reportConfig.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await drawer.screenshot({ path: `${SHOTS}research-factor-report-catalog-sealed.png` });

  await exploreReport.click();
  await reportConfig.getByText(exploreReportId, { exact: true }).waitFor();
  if (!(await reportConfig.innerText()).includes('results.factor_report')) {
    throw new Error('The selected report did not generate an SDK call preview.');
  }
  if (!(await insert.isEnabled())) {
    throw new Error('A revealed completed report must be insertable.');
  }
  await reportConfig.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await drawer.screenshot({ path: `${SHOTS}research-factor-report-catalog.png` });

  await insert.click();
  await drawer.waitFor({ state: 'detached' });
  const insertedCall = `results.factor_report("${exploreReportId}")`;
  let savedPythonCell;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(500);
    savedPythonCell = await database.researchCell.findUnique({ where: { id: pythonCell.id } });
    if (savedPythonCell?.source.includes(insertedCall)) {
      break;
    }
  }
  if (!savedPythonCell?.source.includes(insertedCall)) {
    const visibleEditorText = await page
      .locator(`[data-cell-id="${pythonCell.id}"] .view-lines`)
      .textContent()
      .catch(() => '');
    throw new Error(
      `The report lookup was not inserted and autosaved in the Python Cell: persisted=${JSON.stringify(savedPythonCell?.source)} visible=${JSON.stringify(visibleEditorText)}`,
    );
  }

  console.log(
    '[research-factor-report-catalog-e2e] search=pass sealed=pass insert=pass screenshots=2',
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
  await database.factorReport.deleteMany({
    where: { id: { in: [exploreReportId, holdoutReportId] } },
  });
  await database.factor.deleteMany({ where: { id: factorId } });
  if (userId) {
    await database.session.deleteMany({ where: { userId } });
    await database.user.deleteMany({ where: { id: userId } });
  }
  await database.$disconnect();
  await context.close();
  await browser.close();
}

async function seedReports(ownerId) {
  const now = new Date();
  await database.factor.create({
    data: {
      id: factorId,
      userId: ownerId,
      key: factorKey,
      name: '价值质量因子',
      code: 'export default defineFactor({ key: "value-quality", compute: () => 1 })',
    },
  });
  const base = {
    userId: ownerId,
    factor: factorKey,
    status: 'done',
    analysisKind: 'cross_sectional',
    freq: 'month',
    neutral: 'none',
    start: '20200101',
    end: '20251231',
    payload: JSON.stringify({ report: { icMean: 0.08 } }),
    computedAt: now,
  };
  await database.factorReport.createMany({
    data: [
      {
        ...base,
        id: exploreReportId,
        phase: 'explore',
        revealedAt: now,
        createdAt: now,
      },
      {
        ...base,
        id: holdoutReportId,
        phase: 'holdout',
        revealedAt: null,
        createdAt: new Date(now.getTime() - 60_000),
      },
    ],
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
