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
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const cell = page.locator(`[data-cell-id="${fixture.pythonCellId}"]`);
  const editor = cell.locator('.monaco-editor');
  await editor.waitFor({ timeout: 30_000 });
  const initial = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const original = initial.cells.find((candidate) => candidate.id === fixture.pythonCellId)?.source;
  if (!original) {
    throw new Error('Python Cell source was not found.');
  }
  const autosavedSource = `${original}\n\nautosave_probe = 42`;

  await replaceEditorValue(page, editor, autosavedSource);
  await cell.locator('[data-save-status="dirty"]').waitFor({ timeout: 2_000 });
  await cell.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-autosave-dirty.png` });

  await cell.locator('[data-save-status="saved"]').waitFor({ timeout: 15_000 });
  const saved = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  const savedCell = saved.cells.find((candidate) => candidate.id === fixture.pythonCellId);
  if (
    savedCell?.source !== autosavedSource ||
    savedCell.revision !== 2 ||
    saved.contentRevision !== 2
  ) {
    throw new Error(
      `Timer autosave did not persist the Cell revision: ${JSON.stringify(savedCell)}`,
    );
  }
  await page.screenshot({ path: `${SHOTS}research-autosave-saved.png` });

  const remoteSource = `${autosavedSource}\nremote_revision = True`;
  await api(page, `/api/app/research/cells/${fixture.pythonCellId}`, {
    method: 'PATCH',
    body: JSON.stringify({ source: remoteSource, expectedRevision: savedCell.revision }),
  });
  await replaceEditorValue(page, editor, `${autosavedSource}\nlocal_revision = True`);
  await cell.locator('[data-save-status="conflict"]').waitFor({ timeout: 15_000 });
  const conflicted = await api(page, `/api/app/research/documents/${fixture.documentId}`);
  if (
    conflicted.cells.find((candidate) => candidate.id === fixture.pythonCellId)?.source !==
    remoteSource
  ) {
    throw new Error('A stale autosave overwrote the newer server revision.');
  }
  await page.screenshot({ path: `${SHOTS}research-autosave-conflict.png` });

  console.log(
    `[research-autosave-e2e] dirty=immediate saved=timer revision=${savedCell.revision} contentRevision=${saved.contentRevision} conflict=protected`,
  );
} finally {
  await context.close();
  await browser.close();
  await cleanupResearchCellChangeFixture();
}

async function replaceEditorValue(page, editor, value) {
  await editor.click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(value);
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
