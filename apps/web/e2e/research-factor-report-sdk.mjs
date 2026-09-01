import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const ownerEmail = `e2e-research-factor-report-${Date.now()}@test.com`;
const title = 'FactorReport 只读结果验收';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);

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

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const cell = page.locator(`[data-cell-id="${pythonCell.id}"]`);
  const editor = cell.locator('.monaco-editor');
  await editor.waitFor({ timeout: 30_000 });
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText('factor_report = results.');
  await page.keyboard.press('Control+Space');

  const suggestion = page
    .locator('.suggest-widget.visible')
    .getByText('factor_report', { exact: true })
    .first();
  await suggestion.waitFor({ timeout: 15_000 });
  await cell.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-factor-report-sdk.png` });

  console.log('[research-factor-report-sdk-e2e] completion=pass screenshot=1');
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
