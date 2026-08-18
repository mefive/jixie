import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  cleanupResearchCellChangeFixture,
  RESEARCH_CELL_CHANGE_FIXTURE as fixture,
  seedResearchCellChangeFixture,
} from './research-cell-change-fixture.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

await seedResearchCellChangeFixture();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, fixture.email);
  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(fixture.title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });

  const applyCard = page.getByTestId(`research-cell-change-${fixture.applyProposalId}`);
  await applyCard.waitFor({ timeout: 30_000 });
  await applyCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-cell-change-pending.png` });

  const colors = await applyCard.evaluate((element) => ({
    added: getComputedStyle(element.querySelector('.jx-researchCellChange-added')).color,
    removed: getComputedStyle(element.querySelector('.jx-researchCellChange-removed')).color,
    border: getComputedStyle(element).borderLeftColor,
  }));
  if (
    colors.added !== 'rgb(25, 112, 68)' ||
    colors.removed !== 'rgb(180, 35, 24)' ||
    colors.border !== 'rgb(216, 222, 230)'
  ) {
    throw new Error(`Cell change semantic colors mismatch: ${JSON.stringify(colors)}`);
  }

  await applyCard.getByRole('button', { name: '审查变更' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 30_000 });
  await dialog.locator('.monaco-diff-editor').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}research-cell-change-diff.png` });
  await page.keyboard.press('Escape');

  const beforeRun = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const afterRun = await api(page, `/api/app/research/cells/${fixture.pythonCellId}/run`, {
    method: 'POST',
  });
  if (afterRun.contentRevision !== beforeRun.contentRevision) {
    throw new Error('Executing a Cell must not increment the document content revision.');
  }

  await applyCard.getByRole('button', { name: '应用提案' }).click();
  await applyCard.getByText('已应用', { exact: true }).waitFor({ timeout: 30_000 });
  const appliedDocument = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  if (
    !appliedDocument.cells.some(
      (cell) => cell.id === fixture.pythonCellId && cell.source.includes('rolling_vol'),
    ) ||
    !appliedDocument.cells.some((cell) => cell.id === fixture.createdCellId) ||
    appliedDocument.cells.some((cell) => cell.id === fixture.scratchCellId)
  ) {
    throw new Error('Applied proposal did not atomically update, create, and delete its Cells.');
  }

  await applyCard.getByRole('button', { name: '运行提案影响的 Cells' }).click();
  const attemptCard = applyCard.getByTestId('research-cell-change-attempt');
  await attemptCard.getByText('成功', { exact: true }).waitFor({ timeout: 30_000 });
  let attemptedDocument = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const firstAttempt = attemptedDocument.cellChangeAttempts.find(
    (attempt) => attempt.proposalId === fixture.applyProposalId,
  );
  if (
    firstAttempt?.status !== 'success' ||
    firstAttempt.contentRevision !== appliedDocument.contentRevision ||
    firstAttempt.cells.length !== 1 ||
    firstAttempt.cells[0]?.cellId !== fixture.pythonCellId
  ) {
    throw new Error(`Controlled Cell attempt was not audited: ${JSON.stringify(firstAttempt)}`);
  }
  await applyCard.getByRole('button', { name: '重新运行提案影响的 Cells' }).click();
  await attemptCard.getByText('尝试 2', { exact: true }).waitFor({ timeout: 30_000 });
  await attemptCard.getByText('代码变化 0', { exact: true }).waitFor({ timeout: 30_000 });
  await attemptCard.getByText('输出变化 0', { exact: true }).waitFor({ timeout: 30_000 });
  await applyCard.getByRole('button', { name: '让 Agent 解释本次运行' }).waitFor();
  attemptedDocument = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const latestAttempt = attemptedDocument.cellChangeAttempts.find(
    (attempt) => attempt.proposalId === fixture.applyProposalId,
  );
  if (!latestAttempt?.comparisonToPrevious || latestAttempt.cells.length !== 1) {
    throw new Error(`Controlled attempt comparison is missing: ${JSON.stringify(latestAttempt)}`);
  }
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-testid="research-cell-change-run"]');
    return button && !button.hasAttribute('disabled');
  });
  await applyCard.scrollIntoViewIfNeeded();
  await page.mouse.move(800, 100);
  await page.screenshot({ path: `${SHOTS}research-cell-change-attempt.png` });

  const rejectCard = page.getByTestId(`research-cell-change-${fixture.rejectProposalId}`);
  await rejectCard.getByRole('button', { name: '拒绝提案' }).click();
  await rejectCard.getByText('已拒绝', { exact: true }).waitFor({ timeout: 30_000 });

  await api(page, `/api/app/research/cells/${fixture.markdownCellId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: '## 用户刚刚修改的研究标题',
      expectedRevision: 1,
    }),
  });
  const conflictCard = page.getByTestId(`research-cell-change-${fixture.conflictProposalId}`);
  await conflictCard.getByRole('button', { name: '应用提案' }).click();
  await conflictCard.getByText('有冲突', { exact: true }).waitFor({ timeout: 30_000 });
  const conflictedDocument = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const currentMarkdown = conflictedDocument.cells.find(
    (cell) => cell.id === fixture.markdownCellId,
  );
  if (currentMarkdown?.source !== '## 用户刚刚修改的研究标题') {
    throw new Error("Revision conflict overwrote the user's newer Cell source.");
  }
  await conflictCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-cell-change-resolved.png` });

  console.log(
    `[research-cell-change-e2e] apply=create/update/delete attempts=audited+compared reject=ok conflict=protected colors=${JSON.stringify(colors)}`,
  );
} finally {
  await context.close();
  await browser.close();
  await cleanupResearchCellChangeFixture();
}

async function api(page, path, init) {
  return page.evaluate(
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

async function devLogin(page, email) {
  const status = await page.evaluate(async (loginEmail) => {
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
