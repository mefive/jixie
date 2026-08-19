import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '指数关系研究封存验收';
const promotedName = '沪深300与中证500月收益关系 · 基准版';
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
    body: JSON.stringify({ template: 'index_relationship' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

  const run = await api(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  if (
    run.execution?.status !== 'success' ||
    run.execution.cellCount !== 5 ||
    run.execution.executedCellCount !== 5 ||
    run.execution.contentRevision !== document.contentRevision
  ) {
    throw new Error(`invalid ResearchExecution summary: ${JSON.stringify(run.execution)}`);
  }

  const executionId = run.execution.id;
  const frozen = await api(page, `/api/app/research/executions/${executionId}`);
  const chartCell = frozen.cells.find((cell) =>
    cell.outputs.some((output) => output.type === 'chart'),
  );
  const validationCell = frozen.cells.find((cell) =>
    cell.outputs.some((output) => output.type === 'validation'),
  );
  if (
    frozen.status !== 'success' ||
    frozen.dag.length !== 5 ||
    !chartCell ||
    !validationCell ||
    !frozen.sourceHash ||
    !frozen.environmentFingerprint
  ) {
    throw new Error(`invalid frozen execution detail: ${JSON.stringify(frozen)}`);
  }

  const markdownCell = run.document.cells.find((cell) => cell.kind === 'markdown');
  if (!markdownCell) {
    throw new Error('template has no Markdown Cell');
  }
  document = await api(page, `/api/app/research/cells/${markdownCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: `${markdownCell.source}\n\n> 本段是在完整运行之后追加的草稿说明。`,
      expectedRevision: markdownCell.revision,
    }),
  });
  if (document.contentRevision === frozen.contentRevision) {
    throw new Error('draft revision did not advance after the frozen execution');
  }

  const frozenAfterDraftEdit = await api(page, `/api/app/research/executions/${executionId}`);
  if (
    frozenAfterDraftEdit.sourceHash !== frozen.sourceHash ||
    frozenAfterDraftEdit.cells[0].source !== frozen.cells[0].source ||
    frozenAfterDraftEdit.cells[0].source.includes('完整运行之后追加')
  ) {
    throw new Error('draft edit mutated the immutable ResearchExecution snapshot');
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.getByTestId('research-open-execution-history').click();
  const drawer = page.getByTestId('research-execution-drawer');
  await drawer.waitFor({ timeout: 30_000 });
  await drawer.getByTestId('research-execution-item').first().waitFor({ timeout: 30_000 });
  const historyText = await drawer.innerText();
  if (!historyText.includes('当前草稿已更新')) {
    throw new Error(`run history did not mark the newer draft: ${historyText}`);
  }
  await page.screenshot({ path: `${SHOTS}research-execution-history.png` });

  await drawer.getByTestId('research-execution-item').first().click();
  const detail = page.getByTestId('research-execution-detail');
  await detail.waitFor({ timeout: 30_000 });
  await detail.getByText('这是历史运行的只读快照；当前研究草稿已经发生变化。').waitFor();
  await detail.locator('.monaco-editor').first().waitFor({ timeout: 30_000 });
  await detail.locator('.jx-research-validationOutput').waitFor({ timeout: 30_000 });
  await detail.locator('.jx-research-chartOutput canvas').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}research-execution-readonly-snapshot.png` });
  await detail.locator('.jx-research-chartOutput').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-execution-chart-snapshot.png` });
  await detail.locator('.jx-research-validationOutput').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}research-execution-validation-snapshot.png` });

  await detail.getByRole('button', { name: '封存为研究版本' }).click();
  const modal = page.locator('.ant-modal').filter({ hasText: '封存研究版本' });
  await modal.waitFor();
  await modal.locator('input').nth(0).fill(promotedName);
  await modal.locator('input').nth(1).fill('指数, 月频, 相关性');
  await modal.locator('textarea').fill('作为后续滚动稳定性研究的可复现基准。');
  await modal.locator('.ant-modal-footer .ant-btn-primary').click();
  await detail.getByText(promotedName, { exact: true }).waitFor();
  await detail.getByText('作为后续滚动稳定性研究的可复现基准。', { exact: true }).waitFor();
  await modal.waitFor({ state: 'hidden' });
  await page.screenshot({ path: `${SHOTS}research-execution-promoted.png` });

  const promoted = await api(page, `/api/app/research/executions/${executionId}`);
  if (
    promoted.displayName !== promotedName ||
    !promoted.promotedAt ||
    promoted.tags.join(',') !== '指数,月频,相关性' ||
    promoted.sourceHash !== frozen.sourceHash
  ) {
    throw new Error(
      `promotion changed evidence or metadata is missing: ${JSON.stringify(promoted)}`,
    );
  }

  await api(page, `/api/app/research/cells/${markdownCell.id}`, { method: 'DELETE' });
  const retainedAfterCellDelete = await api(page, `/api/app/research/executions/${executionId}`);
  if (
    retainedAfterCellDelete.cells.length !== 5 ||
    retainedAfterCellDelete.cells[0].cellId !== markdownCell.id ||
    retainedAfterCellDelete.cells[0].source !== frozen.cells[0].source
  ) {
    throw new Error('deleting a draft Cell removed immutable ResearchExecution evidence');
  }

  console.log(
    `[research-execution-e2e] execution=${executionId} revision=${frozen.contentRevision} cells=5 chart=true validation=true immutable=true promoted=true delete-retained=true`,
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
