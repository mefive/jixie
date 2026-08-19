import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import {
  cleanupResearchCellChangeFixture,
  RESEARCH_CELL_CHANGE_FIXTURE as fixture,
  seedResearchCellChangeFixture,
  seedResearchCellChangeFollowupProposal,
} from './research-cell-change-fixture.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

await seedResearchCellChangeFixture();
const initialReview = await seedResearchCellChangeFollowupProposal({
  suffix: 'initial',
  title: '把单值均值改为滚动风险摘要',
  summary: '先建立可继续编辑的滚动风险版本，不运行 Cell。',
  appendedSource: '',
  definition: 'research_summary',
  replacementSource: `import pandas as pd

returns = pd.Series([0.012, -0.006, 0.018, 0.004])
risk_window = 3
rolling_mean = returns.rolling(risk_window).mean()
rolling_vol = returns.rolling(risk_window).std()
research_summary = pd.DataFrame({"mean": rolling_mean, "vol": rolling_vol})
research_summary`,
  definitions: ['returns', 'risk_window', 'rolling_mean', 'rolling_vol', 'research_summary'],
});
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, fixture.email);
  await openFixture(page);

  await api(
    page,
    `/api/app/research/cell-change-proposals/${initialReview.proposalId}/apply-for-review`,
    { method: 'POST' },
  );
  await reloadFixture(page);

  const reviewCell = page.locator(`[data-cell-id="${fixture.pythonCellId}"]`);
  await reviewCell.getByTestId('research-cell-agent-review').waitFor({ timeout: 30_000 });
  const modifiedEditor = reviewCell.locator('.monaco-diff-editor .editor.modified .monaco-editor');
  await modifiedEditor.waitFor({ timeout: 30_000 });
  await assertStandardInlineDiff(page, reviewCell);
  const firstReview = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  if (
    firstReview.activeCellChangeReview?.stepCount !== 1 ||
    firstReview.activeCellChangeReview.cells[0]?.beforeSource.includes('monthly_mean') !== true
  ) {
    throw new Error(`Initial editable review was not opened: ${JSON.stringify(firstReview)}`);
  }
  const blockedRun = await apiResponse(
    page,
    `/api/app/research/cells/${fixture.pythonCellId}/run`,
    { method: 'POST' },
  );
  if (blockedRun.status !== 409) {
    throw new Error(`An open Agent review did not block execution: ${blockedRun.status}`);
  }

  const firstSource = firstReview.cells.find((cell) => cell.id === fixture.pythonCellId).source;
  const userAdjustedSource = `${firstSource}\nuser_floor = -0.01`;
  await replaceEditorValue(page, modifiedEditor, userAdjustedSource);
  await waitForCellSource(page, userAdjustedSource);
  await assertSavedStatus(reviewCell);
  await reviewCell.scrollIntoViewIfNeeded();
  await page.mouse.move(40, 40);
  await page.screenshot({ path: `${SHOTS}research-cell-change-inline-review.png` });

  const followup = await seedResearchCellChangeFollowupProposal({
    suffix: 'followup',
    title: '在用户调整后追加稳定性标记',
    summary: '继续基于当前未接受源码追加一行，而不是回到第一版重新生成 Diff。',
    appendedSource: 'agent_followup = 1',
    definition: 'agent_followup',
  });
  await reloadFixture(page);
  await api(
    page,
    `/api/app/research/cell-change-proposals/${followup.proposalId}/apply-for-review`,
    { method: 'POST' },
  );
  await reloadFixture(page);

  const nestedReview = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const nestedCell = nestedReview.cells.find((cell) => cell.id === fixture.pythonCellId);
  if (
    nestedReview.activeCellChangeReview?.stepCount !== 2 ||
    nestedReview.activeCellChangeReview.cells[0]?.beforeSource.includes('monthly_mean') !== true ||
    !nestedCell?.source.includes('user_floor = -0.01') ||
    !nestedCell.source.includes('agent_followup = 1')
  ) {
    throw new Error(
      `Follow-up proposal did not fold into the open review: ${JSON.stringify(nestedReview)}`,
    );
  }

  const nestedReviewCell = page.locator(`[data-cell-id="${fixture.pythonCellId}"]`);
  const nestedModifiedEditor = nestedReviewCell.locator(
    '.monaco-diff-editor .editor.modified .monaco-editor',
  );
  await nestedModifiedEditor.waitFor({ timeout: 30_000 });
  const finalSource = `${nestedCell.source}\nfinal_window = 6`;
  await replaceEditorValue(page, nestedModifiedEditor, finalSource);
  await waitForCellSource(page, finalSource);
  await assertSavedStatus(nestedReviewCell);
  const followupCard = page.getByTestId(`research-cell-change-${followup.proposalId}`);
  await followupCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-cell-change-followup-review.png` });
  await followupCard.getByTestId('research-cell-change-accept').click();
  await followupCard.getByText('已接受', { exact: true }).waitFor({ timeout: 30_000 });

  const accepted = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const acceptedCell = accepted.cells.find((cell) => cell.id === fixture.pythonCellId);
  if (accepted.activeCellChangeReview || acceptedCell?.source !== finalSource) {
    throw new Error(
      `Accept did not retain the user-edited final source: ${JSON.stringify(accepted)}`,
    );
  }

  const reversible = await seedResearchCellChangeFollowupProposal({
    suffix: 'revert',
    title: '临时追加一个待回滚修改',
    summary: '用于验证整个开放会话可恢复到开始时的已接受源码。',
    appendedSource: 'temporary_agent_line = True',
    definition: 'temporary_agent_line',
  });
  await reloadFixture(page);
  await api(
    page,
    `/api/app/research/cell-change-proposals/${reversible.proposalId}/apply-for-review`,
    { method: 'POST' },
  );
  await reloadFixture(page);
  const revertReview = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const revertReviewCell = revertReview.cells.find((cell) => cell.id === fixture.pythonCellId);
  const revertCell = page.locator(`[data-cell-id="${fixture.pythonCellId}"]`);
  const revertEditor = revertCell.locator('.monaco-diff-editor .editor.modified .monaco-editor');
  await revertEditor.waitFor({ timeout: 30_000 });
  const temporaryUserSource = `${revertReviewCell.source}\nuser_temporary_edit = 2`;
  await replaceEditorValue(page, revertEditor, temporaryUserSource);
  await waitForCellSource(page, temporaryUserSource);
  await assertSavedStatus(revertCell);

  const revertCard = page.getByTestId(`research-cell-change-${reversible.proposalId}`);
  await revertCard.getByTestId('research-cell-change-revert').click();
  const revertConfirmation = page.locator('.ant-popconfirm:visible');
  await revertConfirmation.waitFor({ timeout: 10_000 });
  await revertConfirmation.locator('.ant-btn-primary').click();
  await revertCard.getByText('已撤销', { exact: true }).waitFor({ timeout: 30_000 });
  const reverted = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const revertedCell = reverted.cells.find((cell) => cell.id === fixture.pythonCellId);
  if (reverted.activeCellChangeReview || revertedCell?.source !== finalSource) {
    throw new Error(
      `Review rollback did not restore its first baseline: ${JSON.stringify(reverted)}`,
    );
  }
  await revertCell.locator('.monaco-diff-editor').waitFor({ state: 'detached', timeout: 30_000 });
  await revertCell.locator('[role="code"].monaco-editor').waitFor({ timeout: 30_000 });
  await revertCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-cell-change-review-resolved.png` });

  console.log(
    `[research-cell-change-review-e2e] inline=standard+editable no-strikethrough followup=folded steps=${nestedReview.activeCellChangeReview.stepCount} accept=user-final rollback=first-baseline run=blocked`,
  );
} finally {
  await context.close();
  await browser.close();
  await cleanupResearchCellChangeFixture();
}

async function openFixture(page) {
  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(fixture.title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
}

async function reloadFixture(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(fixture.title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
}

async function replaceEditorValue(page, editor, value) {
  await editor.click();
  const changed = await page.evaluate(
    ({ documentId, cellId, source }) => {
      const monaco = window.__researchMonaco;
      const model = monaco?.editor
        .getModels()
        .find(
          (candidate) =>
            candidate.uri.path.includes(`/research/${documentId}/`) &&
            candidate.uri.path.includes(cellId),
        );
      if (!model) {
        return false;
      }
      model.setValue(source);
      return true;
    },
    { documentId: fixture.documentId, cellId: fixture.pythonCellId, source: value },
  );
  if (!changed) {
    throw new Error('The editable review Monaco model was not found.');
  }
}

async function assertStandardInlineDiff(page, cell) {
  const trueInlineFragments = await cell
    .locator('.monaco-diff-editor .inline-deleted-text')
    .count();
  const strikethroughFragments = await cell
    .locator('.monaco-diff-editor *')
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => getComputedStyle(node).textDecorationLine.includes('line-through'))
          .length,
    );
  const editorModes = await page.evaluate(
    ({ documentId, cellId }) => {
      const monaco = window.__researchMonaco;
      const editor = monaco?.editor
        .getDiffEditors()
        .find((candidate) =>
          candidate
            .getModifiedEditor()
            .getModel()
            ?.uri.path.includes(`/research/${documentId}/${cellId}`),
        );
      if (!editor) {
        return null;
      }
      return {
        originalReadOnly: editor.getOriginalEditor().getOption(monaco.editor.EditorOption.readOnly),
        modifiedReadOnly: editor.getModifiedEditor().getOption(monaco.editor.EditorOption.readOnly),
      };
    },
    { documentId: fixture.documentId, cellId: fixture.pythonCellId },
  );
  if (
    trueInlineFragments !== 0 ||
    strikethroughFragments !== 0 ||
    editorModes?.originalReadOnly !== true ||
    editorModes.modifiedReadOnly !== false
  ) {
    throw new Error(
      `Standard inline review mismatch: ${JSON.stringify({
        trueInlineFragments,
        strikethroughFragments,
        editorModes,
      })}`,
    );
  }
}

async function waitForCellSource(page, expectedSource) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const document = await api(page, `/api/app/research/documents/${fixture.documentId}`);
    if (
      document.cells.find((cell) => cell.id === fixture.pythonCellId)?.source === expectedSource
    ) {
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error('Inline review source was not persisted by autosave.');
}

async function assertSavedStatus(cell) {
  const status = cell.getByTestId('research-cell-save-status');
  try {
    await cell.locator('[data-save-status="saved"]').waitFor({ timeout: 5_000 });
  } catch {
    throw new Error(
      `Inline review save state remained ${await status.getAttribute('data-save-status')}.`,
    );
  }
}

async function api(page, path, init) {
  const response = await apiResponse(page, path, init);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(JSON.stringify(response.body));
  }
  return response.body;
}

async function apiResponse(page, path, init) {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        headers: { 'content-type': 'application/json' },
        ...requestInit,
      });
      return { status: response.status, body: await response.json() };
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
