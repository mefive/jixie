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

  const document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

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
  await cells.nth(1).waitFor({ timeout: 30_000 });
  const composer = page.locator('.jx-research-agentComposer');
  await composer.waitFor();

  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor();
  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor({ state: 'detached' });

  await cells.nth(1).getByTestId('research-cell-drag-source').dragTo(composer);
  await page.getByText('Cell 02 · Python', { exact: true }).waitFor();
  await cells.nth(0).getByTestId('research-cell-attach-agent').click();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor();

  const prompt = page.locator('.jx-research-agentPrompt');
  await prompt.fill('比较这两个 Cell 的研究设计');
  const sendButton = composer.getByRole('button', { name: '发送消息' });
  await sendButton.waitFor();
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-composer.png` });
  await sendButton.click();
  await page.getByText('已收到 Cell 上下文。', { exact: true }).waitFor();

  const expectedCellIds = [document.cells[1].id, document.cells[0].id];
  if (
    submittedBody?.message !== '比较这两个 Cell 的研究设计' ||
    JSON.stringify(submittedBody.contextCellIds) !== JSON.stringify(expectedCellIds)
  ) {
    throw new Error(`Agent request omitted Cell context: ${JSON.stringify(submittedBody)}`);
  }
  const persistedContext = page.locator('.jx-messageParts-cellContext');
  await persistedContext.getByText('Cell 02 · Python', { exact: true }).waitFor();
  await persistedContext.getByText('Cell 01 · Markdown', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-agent-cell-context-message.png` });

  console.log(
    '[research-agent-cell-context-e2e] button=toggle drag=attach composer=unified request=explicit message=durable',
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
