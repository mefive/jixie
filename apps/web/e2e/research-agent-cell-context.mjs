import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = 'Agent Cell 上下文验收';
const ownerEmail = `e2e-research-agent-context-${Date.now()}@test.com`;
const turnId = 'e2e-research-agent-context-turn';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
let submittedBody;
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
    body: JSON.stringify({ title }),
  });
  const markdownCell = document.cells.find((cell) => cell.kind === 'markdown');
  const initialPythonCell = document.cells.find((cell) => cell.kind === 'python');
  if (!markdownCell || !initialPythonCell) {
    throw new Error('blank Research document is missing its initial Cells');
  }
  const upstreamSource = 'base_value = 41';
  const downstreamSource = 'derived_value = base_value + 1';
  document = await api(page, `/api/app/research/cells/${initialPythonCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: upstreamSource,
      expectedRevision: initialPythonCell.revision,
    }),
  });
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: downstreamSource }),
  });
  const upstreamCell = document.cells.find((cell) => cell.id === initialPythonCell.id);
  const downstreamCell = document.cells.at(-1);
  if (!upstreamCell || !downstreamCell || downstreamCell.kind !== 'python') {
    throw new Error('dependent Python Cells were not created');
  }

  await page.route('**/api/app/research/agent', async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ conversationId: documentId, turnId }),
    });
  });
  await page.route(`**/api/app/agent/turns/${turnId}/stream`, async (route) => {
    const events = [
      { type: 'snapshot', text: '', trace: [], phase: 'reading_context' },
      {
        type: 'done',
        parts: [{ type: 'text', text: '已收到 Cell 上下文。' }],
        code: '',
        changed: false,
        attempts: 1,
        toolTrace: [],
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    });
  });

  await page.goto(`${BASE}/research?document=${encodeURIComponent(documentId)}`, {
    waitUntil: 'domcontentloaded',
  });
  const cells = page.locator('[data-cell-id]');
  await cells.nth(2).waitFor({ timeout: 30_000 });
  const composer = page.locator('.jx-research-agentComposer');
  await composer.waitFor();

  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor();
  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor({ state: 'detached' });

  await cells.nth(2).getByTestId('research-cell-drag-source').dragTo(composer);
  await page.getByText('Cell 03 · Python', { exact: true }).waitFor();
  await page.getByText('依赖 Cell 02 · Python', { exact: true }).waitFor();
  await page.getByText('已附加 1 个 Cell · 自动依赖 1 个', { exact: true }).waitFor();
  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor();

  const prompt = page.locator('.jx-research-agentPrompt');
  await prompt.fill('比较这两个 Cell 的研究设计');
  const sendButton = composer.getByRole('button', { name: '发送消息' });
  await sendButton.waitFor();
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-composer.png` });
  await sendButton.click();
  await page.getByText('已收到 Cell 上下文。', { exact: true }).waitFor();

  const expectedCellIds = [downstreamCell.id, markdownCell.id];
  if (
    submittedBody?.message !== '比较这两个 Cell 的研究设计' ||
    JSON.stringify(submittedBody.contextCellIds) !== JSON.stringify(expectedCellIds)
  ) {
    throw new Error(`Agent request omitted Cell context: ${JSON.stringify(submittedBody)}`);
  }
  const persistedContext = page.locator('.jx-messageParts-cellContext');
  await persistedContext.getByText('Cell 03 · Python', { exact: true }).waitFor();
  await persistedContext.getByText('Cell 01 · Markdown', { exact: true }).waitFor();
  await persistedContext.getByText('依赖 Cell 02 · Python', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-message.png` });

  const historicalDependency = page.getByTestId(`research-message-context-${upstreamCell.id}`);
  await historicalDependency.click();
  const currentUpstreamCell = page.locator(`[data-cell-id="${upstreamCell.id}"]`);
  await currentUpstreamCell.waitFor();
  await currentUpstreamCell.evaluate((element) =>
    element.scrollIntoView({ behavior: 'instant', block: 'center' }),
  );
  await currentUpstreamCell.evaluate((element) => {
    if (!element.classList.contains('jx-research-cell--contextTarget')) {
      throw new Error('Current dependency Cell was not highlighted');
    }
  });
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-navigation.png` });

  const upstreamEditor = currentUpstreamCell.locator('.monaco-editor');
  await upstreamEditor.waitFor({ timeout: 30_000 });
  await replaceEditorValue(page, upstreamEditor, 'base_value = 40');
  await currentUpstreamCell.locator('[data-save-status="dirty"]').waitFor({ timeout: 5_000 });
  await currentUpstreamCell.locator('[data-save-status="saved"]').waitFor({ timeout: 15_000 });
  await historicalDependency.getByText('已更新', { exact: true }).waitFor();
  await historicalDependency.click();
  const updatedSnapshot = page.getByRole('dialog', { name: '发送时的 Cell 上下文' });
  await updatedSnapshot.waitFor();
  await updatedSnapshot.getByText('当前 Cell 已更新', { exact: true }).waitFor();
  await updatedSnapshot.getByText(upstreamSource, { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-updated.png` });
  await updatedSnapshot.locator('.ant-modal-footer .ant-btn').first().click();

  const currentDownstreamCell = page.locator(`[data-cell-id="${downstreamCell.id}"]`);
  await currentDownstreamCell.getByRole('button', { name: '删除这个 Cell？' }).click();
  const deletionConfirmation = page.locator('.ant-popconfirm:visible');
  await deletionConfirmation.waitFor();
  await deletionConfirmation.locator('.ant-btn-primary').click();
  await currentDownstreamCell.waitFor({ state: 'detached' });
  const historicalDownstream = page.getByTestId(`research-message-context-${downstreamCell.id}`);
  await historicalDownstream.getByText('已删除', { exact: true }).waitFor();
  await historicalDownstream.click();
  const deletedSnapshot = page.getByRole('dialog', { name: '发送时的 Cell 上下文' });
  await deletedSnapshot.waitFor();
  await deletedSnapshot.getByText('当前 Cell 已删除', { exact: true }).waitFor();
  await deletedSnapshot.getByText(downstreamSource, { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-deleted.png` });

  console.log(
    '[research-agent-cell-context-e2e] attach=explicit dependency=automatic navigate=highlight updated=snapshot deleted=snapshot',
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
  await context.close();
  await browser.close();
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

async function replaceEditorValue(page, editor, value) {
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(value);
}
