import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const ownerEmail = `e2e-research-cell-deletion-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);

  let document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: '依赖感知删除验收' }),
  });
  const upstreamSeed = document.cells.find((cell) => cell.kind === 'python');
  if (!upstreamSeed) {
    throw new Error('blank Research document is missing its initial Python Cell');
  }
  document = await api(page, `/api/app/research/cells/${upstreamSeed.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ source: 'base_value = 41', expectedRevision: upstreamSeed.revision }),
  });
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: 'derived_value = base_value + 1' }),
  });
  const middleCell = document.cells.at(-1);
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: 'final_value = derived_value * 2' }),
  });
  const finalCell = document.cells.at(-1);
  const upstreamCell = document.cells.find((cell) => cell.id === upstreamSeed.id);
  if (!upstreamCell || !middleCell || !finalCell) {
    throw new Error('dependent Python Cells were not created');
  }

  await page.goto(`${BASE}/research?document=${encodeURIComponent(documentId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  const hideAgent = page.getByRole('button', { name: '隐藏 Agent' });
  if (await hideAgent.isVisible()) {
    await hideAgent.click();
  }

  const upstream = page.locator(`[data-cell-id="${upstreamCell.id}"]`);
  await upstream.getByRole('button', { name: '删除这个 Cell？' }).click();
  const confirmation = page.locator('.ant-popconfirm:visible');
  await confirmation.waitFor();
  await confirmation.getByText('删除 Cell 02？', { exact: true }).waitFor();
  const impact = confirmation.getByTestId('research-cell-delete-impact');
  await impact.getByText('删除后，以下 2 个下游 Cell 将无法运行：', { exact: true }).waitFor();
  await impact.getByText('Cell 03 · Python', { exact: true }).waitFor();
  await impact.getByText('Cell 04 · Python', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}research-cell-delete-impact.png` });

  await confirmation.getByRole('button', { name: '仍然删除' }).click();
  await upstream.waitFor({ state: 'detached' });
  await confirmation.waitFor({ state: 'detached' });

  const middle = page.locator(`[data-cell-id="${middleCell.id}"]`);
  const final = page.locator(`[data-cell-id="${finalCell.id}"]`);
  for (const cell of [middle, final]) {
    await cell.getByText('待修复', { exact: true }).waitFor();
    await cell.getByTestId('research-cell-blocked-notice').waitFor();
    await cell.getByRole('button', { name: '运行', exact: true }).evaluate((button) => {
      if (!button.disabled) {
        throw new Error('blocked Cell run action is enabled');
      }
    });
    await cell.getByTestId('research-run-affected').evaluate((button) => {
      if (!button.disabled) {
        throw new Error('blocked affected-run action is enabled');
      }
    });
  }
  await middle
    .getByTestId('research-cell-blocked-notice')
    .getByText('已删除的原 Cell 02 · 缺少 base_value', { exact: true })
    .waitFor();
  await final
    .getByTestId('research-cell-blocked-notice')
    .getByText('已删除的原 Cell 02 · 缺少 base_value', { exact: true })
    .waitFor();
  await page.getByTestId('research-run-all').evaluate((button) => {
    if (!button.disabled) {
      throw new Error('blocked full-document run action is enabled');
    }
  });

  const blockedDocument = await api(page, `/api/app/research/documents/${documentId}`);
  assertBlockedCell(blockedDocument, middleCell.id, upstreamCell.id);
  assertBlockedCell(blockedDocument, finalCell.id, upstreamCell.id);
  const cellRun = await apiResponse(page, `/api/app/research/cells/${middleCell.id}/run`, {
    method: 'POST',
  });
  const documentRun = await apiResponse(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  for (const result of [cellRun, documentRun]) {
    if (result.status !== 400 || result.body?.error?.code !== 'VALIDATION_FAILED') {
      throw new Error(`blocked run was not rejected: ${JSON.stringify(result)}`);
    }
  }
  await middle.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-cell-delete-blocked.png` });

  const middleEditor = middle.locator('.monaco-editor');
  await middleEditor.waitFor({ timeout: 30_000 });
  await replaceEditorValue(page, middleEditor, 'derived_value = 42');
  await middle.locator('[data-save-status="dirty"]').waitFor({ timeout: 5_000 });
  await middle.locator('[data-save-status="saved"]').waitFor({ timeout: 15_000 });
  for (const cell of [middle, final]) {
    await cell.getByText('未运行', { exact: true }).waitFor();
    await cell.getByTestId('research-cell-blocked-notice').waitFor({ state: 'detached' });
  }
  await middle.getByRole('button', { name: '运行', exact: true }).evaluate((button) => {
    if (button.disabled) {
      throw new Error('repaired Cell run action is still disabled');
    }
  });

  const repairedDocument = await api(page, `/api/app/research/documents/${documentId}`);
  for (const cellId of [middleCell.id, finalCell.id]) {
    const cell = repairedDocument.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== 'idle' || cell.dependencyIssues.length !== 0) {
      throw new Error(`dependency repair was not reconciled: ${JSON.stringify(cell)}`);
    }
  }
  await page.screenshot({ path: `${SHOTS}research-cell-delete-repaired.png` });

  console.log('[research-cell-deletion-e2e] warning=2 blocked=2 run-guard=api+ui repair=automatic');
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
  await context.close();
  await browser.close();
}

function assertBlockedCell(document, cellId, sourceCellId) {
  const cell = document.cells.find((candidate) => candidate.id === cellId);
  const issue = cell?.dependencyIssues?.find(
    (candidate) => candidate.sourceCellId === sourceCellId,
  );
  if (
    cell?.status !== 'blocked' ||
    issue?.reason !== 'deleted_upstream_cell' ||
    !issue.missingDefinitions.includes('base_value')
  ) {
    throw new Error(`Cell was not persistently blocked: ${JSON.stringify(cell)}`);
  }
}

async function api(page, path, init) {
  const result = await apiResponse(page, path, init);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(JSON.stringify(result.body));
  }
  return result.body;
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

async function replaceEditorValue(page, editor, value) {
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(value);
}
