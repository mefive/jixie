import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '量化研究大表预览';
const source = `candidate_table = [
    {
        "rank": _index + 1,
        "ticker": f"{600000 + _index:06d}.SH",
        "score": round(1 - _index / 300, 4),
        "return_1m": round(((_index % 17) - 8) / 100, 4),
        "volatility": round(0.08 + (_index % 11) / 100, 4),
        "pe_ttm": round(8 + (_index % 37) * 0.7, 2),
        "pb": round(0.8 + (_index % 19) * 0.13, 2),
        "note": ("异常值检查；" * 50) if _index == 0 else "通过基础数据检查",
    }
    for _index in range(260)
]
candidate_table`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-table-preview@test.com' }),
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
    body: JSON.stringify({ source, expectedRevision: pythonCell.revision }),
  });
  document = await api(page, `/api/app/research/cells/${pythonCell.id}/run`, { method: 'POST' });
  const executedCell = document.cells.find((cell) => cell.id === pythonCell.id);
  const output = executedCell?.outputs[0];
  if (
    executedCell?.status !== 'success' ||
    output?.type !== 'table' ||
    output.rowCount !== 260 ||
    output.rows.length !== 200 ||
    output.truncatedCells !== true
  ) {
    throw new Error(`bounded table output mismatch: ${JSON.stringify(executedCell)}`);
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const table = page.getByTestId('research-table-output');
  await table.getByText('200 / 260 行', { exact: true }).waitFor();
  await table.getByText('8 列', { exact: true }).waitFor();
  await table.getByText('超长单元格已截断', { exact: true }).waitFor();
  await table.getByText('预览第 1–50 行，共 200 行', { exact: true }).waitFor();

  const renderedRows = await table.locator('.ant-table-tbody .ant-table-row').count();
  if (renderedRows <= 0 || renderedRows >= 50) {
    throw new Error(`expected a virtualized subset of 50 rows, rendered ${renderedRows}`);
  }

  await table.locator('.ant-pagination-item[title="4"]').click();
  await table.getByText('预览第 151–200 行，共 200 行', { exact: true }).waitFor();
  await table.getByText('151', { exact: true }).first().waitFor();
  await table.screenshot({ path: `${SHOTS}research-table-preview.png` });
  console.log(
    `[research-table-preview-e2e] rows=200/260 rendered=${renderedRows} pagination=151-200`,
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
