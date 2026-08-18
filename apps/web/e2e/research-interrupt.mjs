import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const now = new Date().toISOString();
const cell = (input) => ({
  version: 1,
  documentId: 'e2e-interrupt',
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
  id: 'e2e-interrupt',
  conversationId: 'e2e-interrupt',
  title: '中断长时间量化计算',
  runtimeVersion: 'research-py-v1',
  messages: [],
  createdAt: now,
  updatedAt: now,
  cells: [
    cell({
      id: 'cell-long-running',
      position: 0,
      kind: 'python',
      source: 'while True:\n    pass',
      status: 'stale',
      definitions: ['monthly'],
      references: [],
      outputs: [{ type: 'value', value: '上次成功输出：60 期月收益' }],
    }),
    cell({
      id: 'cell-summary',
      position: 1,
      kind: 'python',
      source: 'summary = monthly.describe()\nsummary',
      status: 'stale',
      definitions: ['summary'],
      references: ['monthly'],
      outputs: [{ type: 'value', value: '上次统计结果保持可见' }],
    }),
  ],
};
const interruptedDocument = {
  ...initialDocument,
  updatedAt: new Date(Date.now() + 1_000).toISOString(),
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let currentDocument = initialDocument;
let affectedRunCalls = 0;
let interruptCalls = 0;
let releaseAffectedRun;
const affectedRunInterrupted = new Promise((resolve) => {
  releaseAffectedRun = resolve;
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-interrupt@test.com' }),
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
          staleCount: currentDocument.cells.filter((item) => item.status === 'stale').length,
          createdAt: currentDocument.createdAt,
          updatedAt: currentDocument.updatedAt,
        },
      ],
    }),
  );
  await page.route('**/api/app/research/documents/e2e-interrupt', (route) =>
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
  await page.route('**/api/app/research/cells/cell-long-running/run-affected', async (route) => {
    affectedRunCalls += 1;
    await affectedRunInterrupted;
    await route.fulfill({
      json: {
        version: 1,
        document: interruptedDocument,
        executedCellIds: [],
        clean: false,
      },
    });
  });
  await page.route('**/api/app/research/documents/e2e-interrupt/interrupt', async (route) => {
    interruptCalls += 1;
    currentDocument = interruptedDocument;
    releaseAffectedRun();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({
      json: { version: 1, document: interruptedDocument, interrupted: true },
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(initialDocument.title, { exact: true }).click();
  const document = page.getByTestId('research-document');
  await document.waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const activeCell = page.locator('[data-cell-id="cell-long-running"]');
  const downstreamCell = page.locator('[data-cell-id="cell-summary"]');
  await activeCell.getByTestId('research-run-affected').click();
  await page.getByTestId('research-interrupt').waitFor();
  await activeCell.getByRole('button', { name: '停止当前运行' }).hover();
  await page.getByText('停止当前运行', { exact: true }).last().waitFor();
  await page.screenshot({ path: `${SHOTS}research-interrupt-running.png` });

  await activeCell.getByRole('button', { name: '停止当前运行' }).click();
  await page.getByText('运行已停止；未完成的 Cell 不会继续执行。', { exact: true }).waitFor();
  await activeCell.getByText('待重跑', { exact: true }).waitFor();
  await downstreamCell.getByText('待重跑', { exact: true }).waitFor();
  await activeCell
    .locator('.jx-research-valueOutput')
    .filter({ hasText: '上次成功输出：60 期月收益' })
    .waitFor();
  await downstreamCell
    .locator('.jx-research-valueOutput')
    .filter({ hasText: '上次统计结果保持可见' })
    .waitFor();

  if (affectedRunCalls !== 1 || interruptCalls !== 1) {
    throw new Error(
      `expected one run and one interrupt; received ${affectedRunCalls} run(s), ${interruptCalls} interrupt(s)`,
    );
  }

  await page.mouse.move(800, 900);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}research-interrupt-stopped.png` });
  console.log(
    '[research-interrupt-e2e] active run stopped; stale outputs and descendants preserved',
  );
} finally {
  await context.close();
  await browser.close();
}
