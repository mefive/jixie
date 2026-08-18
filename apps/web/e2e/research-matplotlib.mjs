import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = 'Python 静态图验收';
const source = `import matplotlib.pyplot as plt

months = list(range(1, 25))
strategy_nav = [1.00, 1.03, 1.01, 1.06, 1.09, 1.12, 1.10, 1.16,
                1.20, 1.18, 1.24, 1.29, 1.27, 1.34, 1.38, 1.36,
                1.43, 1.47, 1.45, 1.52, 1.57, 1.61, 1.59, 1.68]
benchmark_nav = [1.00, 1.01, 1.00, 1.03, 1.05, 1.07, 1.06, 1.09,
                 1.12, 1.10, 1.14, 1.17, 1.15, 1.20, 1.22, 1.21,
                 1.25, 1.28, 1.27, 1.31, 1.34, 1.36, 1.35, 1.39]

fig, ax = plt.subplots(figsize=(10, 4.6))
ax.plot(months, strategy_nav, color="#111827", linewidth=2.2, label="Strategy")
ax.plot(months, benchmark_nav, color="#d45b52", linewidth=2.0, label="Benchmark")
ax.fill_between(months, benchmark_nav, strategy_nav, color="#dbe5f4", alpha=0.55)
ax.set(title="Strategy vs Benchmark NAV", xlabel="Month", ylabel="Cumulative NAV")
ax.grid(axis="y", color="#e5e7eb", linewidth=0.8)
ax.spines[["top", "right"]].set_visible(False)
ax.legend(frameon=False, loc="upper left")
fig.tight_layout()`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1800 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-matplotlib@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  let document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

  const pythonCell = document.cells.find((cell) => cell.kind === 'python');
  if (!pythonCell) {
    throw new Error('blank research document did not include a Python cell');
  }
  document = await api(page, `/api/app/research/cells/${pythonCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ source }),
  });
  document = await api(page, `/api/app/research/cells/${pythonCell.id}/run`, { method: 'POST' });
  const executedCell = document.cells.find((cell) => cell.id === pythonCell.id);
  const image = executedCell?.outputs.find((output) => output.type === 'image');
  if (
    executedCell?.status !== 'success' ||
    image?.type !== 'image' ||
    image.mimeType !== 'image/png' ||
    typeof image.byteSize !== 'number' ||
    image.byteSize <= 0 ||
    image.byteSize > 4 * 1024 * 1024
  ) {
    throw new Error(`Matplotlib output mismatch: ${JSON.stringify(executedCell)}`);
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const cell = page.locator(`[data-cell-id="${pythonCell.id}"]`);
  const editor = cell.locator('.monaco-editor');
  const outputImage = cell.locator('.jx-research-imageOutput img');
  await editor.waitFor({ timeout: 30_000 });
  await editor.locator('.view-line').first().waitFor({ timeout: 30_000 });
  await outputImage.waitFor({ timeout: 30_000 });
  await outputImage.evaluate((element) => element.complete && element.naturalWidth > 0);
  await editor.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await cell.screenshot({ path: `${SHOTS}research-matplotlib-cell.png` });
  await page.screenshot({ path: `${SHOTS}research-matplotlib-workbench.png` });
  console.log(
    `[research-matplotlib-e2e] mime=${image.mimeType} bytes=${image.byteSize} rendered=true`,
  );
} finally {
  if (documentId) {
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
