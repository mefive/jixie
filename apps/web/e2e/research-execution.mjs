import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '指数关系当前输出验收';
const ownerEmail = `e2e-research-execution-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1500 } });
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
  await api(page, `/api/app/research/documents/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'python',
      source: 'import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [2, 4, 3])\n42',
    }),
  });

  const run = await api(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  if ('execution' in run || run.document.cells.some((cell) => cell.status !== 'success')) {
    throw new Error(`Invalid current output run: ${JSON.stringify(run)}`);
  }
  if (!run.document.cells.some((cell) => cell.outputs.some((output) => output.type === 'image'))) {
    throw new Error('Expected current image output');
  }
  const markdownCell = run.document.cells.find((cell) => cell.kind === 'markdown');
  await api(page, `/api/app/research/cells/${markdownCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: markdownCell.source + '\n\nCurrent editable note',
      expectedRevision: markdownCell.revision,
    }),
  });
  for (const [method, path] of [
    ['GET', `/documents/${documentId}/executions`],
    ['GET', '/executions/old'],
    ['POST', '/executions/old/promote'],
  ]) {
    const response = await context.request.fetch(`${BASE}/api/app/research${path}`, { method });
    if (response.status() !== 404) {
      throw new Error(`Retired execution endpoint remains: ${method} ${path}`);
    }
  }
  await page.goto(`${BASE}/research?document=${documentId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('research-document').waitFor();
  if (await page.getByTestId('research-open-execution-history').count()) {
    throw new Error('Retired history remains visible');
  }
  await page.getByTestId('research-image-output').locator('img').first().waitFor();
  await page
    .getByTestId('research-image-output')
    .locator('img')
    .first()
    .evaluate((image) => image.decode());
  await page.locator('.monaco-editor .view-lines').last().waitFor({ state: 'visible' });
  await page.screenshot({ path: `${SHOTS}research-current-output.png` });
  console.log('[research-current-output-e2e] clean=pass editable=pass chart=pass retired-apis=404');
} finally {
  if (documentId) {
    await devLogin(page, ownerEmail).catch(() => {});
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/research/documents/${encodeURIComponent(id)}`, {
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
