import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const now = new Date().toISOString();
const cell = (input) => ({
  version: 1,
  documentId: 'e2e-affected',
  config: undefined,
  revision: 2,
  lastExecutedRevision: 1,
  lastExecutedAt: now,
  createdAt: now,
  updatedAt: now,
  ...input,
});
const initialDocument = {
  version: 1,
  id: 'e2e-affected',
  conversationId: 'e2e-affected',
  title: '受影响 Cell 批量运行验收',
  runtimeVersion: 'research-py-v1',
  messages: [],
  createdAt: now,
  updatedAt: now,
  cells: [
    cell({
      id: 'cell-load',
      position: 0,
      kind: 'python',
      source: 'monthly = [0.01, 0.02, -0.01, 0.03]\nmonthly',
      status: 'stale',
      definitions: ['monthly'],
      references: [],
      outputs: [{ type: 'value', value: ['旧数据：4 期'] }],
    }),
    cell({
      id: 'cell-summary',
      position: 1,
      kind: 'python',
      source: 'mean_return = sum(monthly) / len(monthly)\nmean_return',
      status: 'stale',
      definitions: ['mean_return'],
      references: ['monthly'],
      outputs: [{ type: 'value', value: 0.004 }],
    }),
    cell({
      id: 'cell-conclusion',
      position: 2,
      kind: 'python',
      source: 'conclusion = "positive" if mean_return > 0 else "negative"\nconclusion',
      status: 'stale',
      definitions: ['conclusion'],
      references: ['mean_return'],
      outputs: [{ type: 'value', value: '旧结论' }],
    }),
    cell({
      id: 'cell-independent',
      position: 3,
      kind: 'python',
      source: 'independent_control = 999\nindependent_control',
      status: 'success',
      revision: 1,
      definitions: ['independent_control'],
      references: [],
      outputs: [{ type: 'value', value: 999 }],
    }),
  ],
};
const completedDocument = {
  ...initialDocument,
  updatedAt: new Date(Date.now() + 1_000).toISOString(),
  cells: initialDocument.cells.map((researchCell) => {
    if (researchCell.id === 'cell-independent') {
      return researchCell;
    }
    const outputById = {
      'cell-load': [{ type: 'value', value: ['新数据：4 期'] }],
      'cell-summary': [{ type: 'value', value: 0.0125 }],
      'cell-conclusion': [{ type: 'value', value: 'positive' }],
    };
    return {
      ...researchCell,
      status: 'success',
      lastExecutedRevision: researchCell.revision,
      outputs: outputById[researchCell.id],
    };
  }),
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let currentDocument = initialDocument;
let affectedRunCalls = 0;

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-affected@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  await page.route('**/api/app/research/documents', (route) =>
    route.fulfill({
      json: [
        {
          id: currentDocument.id,
          title: currentDocument.title,
          preview: '',
          cellCount: currentDocument.cells.length,
          staleCount: currentDocument.cells.filter(
            (researchCell) => researchCell.status === 'stale',
          ).length,
          createdAt: currentDocument.createdAt,
          updatedAt: currentDocument.updatedAt,
        },
      ],
    }),
  );
  await page.route('**/api/app/research/documents/e2e-affected', (route) =>
    route.fulfill({ json: currentDocument }),
  );
  await page.route('**/api/app/research/curator/runs/latest', (route) =>
    route.fulfill({ json: null }),
  );
  await page.route('**/api/app/agent/turns/running**', (route) =>
    route.fulfill({ json: { turnId: null } }),
  );
  await page.route('**/api/app/research/language', async (route) => {
    const request = route.request().postDataJSON();
    const emptyResult = {
      completion: { items: [], incomplete: false },
      hover: null,
      signature_help: null,
      definition: [],
      references: [],
      prepare_rename: null,
      rename: [],
      diagnostics: [],
    }[request.action];
    await route.fulfill({ json: { version: 1, action: request.action, result: emptyResult } });
  });
  await page.route('**/api/app/research/cells/cell-load/run-affected', async (route) => {
    affectedRunCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 350));
    currentDocument = completedDocument;
    await route.fulfill({
      json: {
        version: 1,
        document: completedDocument,
        executedCellIds: ['cell-load', 'cell-summary', 'cell-conclusion'],
        clean: false,
      },
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(initialDocument.title, { exact: true }).click();
  const document = page.getByTestId('research-document');
  await document.waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const firstCell = page.locator('[data-cell-id="cell-load"]');
  const independentCell = page.locator('[data-cell-id="cell-independent"]');
  await firstCell.getByText('待重跑', { exact: true }).waitFor();
  await independentCell
    .locator('.jx-research-valueOutput')
    .getByText('999', { exact: true })
    .waitFor();

  await firstCell.getByTestId('research-run-affected').click();
  await firstCell.getByText('已运行', { exact: true }).waitFor({ timeout: 10_000 });
  await page
    .locator('[data-cell-id="cell-summary"]')
    .getByText('已运行', { exact: true })
    .waitFor();
  await page
    .locator('[data-cell-id="cell-conclusion"]')
    .getByText('已运行', { exact: true })
    .waitFor();
  await independentCell
    .locator('.jx-research-valueOutput')
    .getByText('999', { exact: true })
    .waitFor();

  if (affectedRunCalls !== 1) {
    throw new Error(`expected one affected run request, received ${affectedRunCalls}`);
  }

  await firstCell.getByTestId('research-run-affected').hover();
  await page.getByText('运行当前 Cell 及受影响下游', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-affected-run.png` });
  console.log(
    '[research-affected-run-e2e] affected branch ran once; independent cell was preserved',
  );
} finally {
  await context.close();
  await browser.close();
}
