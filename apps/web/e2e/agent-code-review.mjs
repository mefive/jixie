import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// 验证真实持久化与用户接受交互；生成物是可重复的测试输入，不评估模型质量。
// Exercise real persistence and user acceptance with deterministic artifacts, not model quality.
const screenshots = fileURLToPath(new URL('../acceptance/', import.meta.url));
const apiDirectory = fileURLToPath(new URL('../../api/', import.meta.url));
const require = createRequire(new URL('../../api/package.json', import.meta.url));
await mkdir(screenshots, { recursive: true });
const log = createWriteStream(`${screenshots}/agent-code-review-server.log`);
const server = fork(`${apiDirectory}/tests/code-review-e2e-server.ts`, [], {
  cwd: apiDirectory,
  execArgv: ['--conditions=development', '--import', require.resolve('tsx')],
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
server.stdout.pipe(log, { end: false });
server.stderr.pipe(log, { end: false });
let browser;
let base;
try {
  const ready = await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Review fixture startup timed out')), 60000);
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`Fixture exited: ${code}`)));
    server.on('message', (message) => {
      if (message.type === 'ready' || message.type === 'error') {
        clearTimeout(timer);
        if (message.type === 'error') {
          reject(new Error(message.message));
        } else {
          resolveReady(message);
        }
      }
    });
  });
  base = ready.base;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const login = await context.request.post(`${base}/api/auth/dev/login`, {
    data: { email: ready.email },
  });
  assert.equal(login.status(), 200);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const selected = process.env.JIXIE_CODE_REVIEW_ONLY;
  for (const surface of ['factor', 'strategy']) {
    if (selected && selected !== surface) {
      continue;
    }
    const collection = surface === 'factor' ? 'factors' : 'strategies';
    const entityId = ready.entityIds[surface];
    const hostPath = `/api/app/${collection}/${entityId}`;
    const readSource = async () => {
      const response = await context.request.get(`${base}${hostPath}`);
      assert.equal(response.status(), 200);
      const host = await response.json();
      return surface === 'factor' ? host.code : host.config.code;
    };
    const original = await readSource();
    const route = surface === 'factor' ? `/factors?factor=${entityId}` : `/strategy?id=${entityId}`;
    await page.goto(`${base}${route}`);
    const card = page.getByTestId(`code-change-${ready.ids[surface]}`);
    await card.getByText('待审阅', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0, 'Review must not open automatically');
    assert.equal(await readSource(), original);
    await card.getByRole('button', { name: '查看修改', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('.monaco-diff-editor').waitFor();
    assert.equal(await readSource(), original, 'Opening a diff must not mutate code');
    await page.screenshot({
      path: `${screenshots}/agent-code-review-${surface}-diff.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await page.reload();
    await card.getByText('待审阅', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(
      await readSource(),
      original,
      'Pending suggestions must survive closing and refresh',
    );
    await card.getByRole('button', { name: '查看修改', exact: true }).click();
    const acceptedResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/code-change-proposals/${ready.ids[surface]}/accept`) &&
        response.request().method() === 'POST',
    );
    await page.getByTestId('code-change-accept').click();
    assert.equal((await acceptedResponse).status(), 200);
    await card.getByText('已接受', { exact: true }).waitFor();
    assert.notEqual(await readSource(), original);
    await page.keyboard.press('Escape');
    await page.reload();
    await card.getByText('已接受', { exact: true }).waitFor();
    assert.ok((await readSource()).includes('Save only after review.'));
    await page
      .locator(`.jx-${surface}-editor .monaco-editor .view-lines`)
      .getByText('Save only after review.', { exact: false })
      .waitFor();

    await page.screenshot({
      path: `${screenshots}/agent-code-review-${surface}-accepted.png`,
      fullPage: true,
    });
  }
  if (!selected || selected === 'research') {
    await page.goto(`${base}/research?document=${encodeURIComponent(ready.documentId)}`);
    await page.getByTestId('research-document').waitFor();
    const showAgent = page.getByRole('button', { name: '显示 Agent', exact: true });
    if (await showAgent.isVisible()) {
      await showAgent.click();
    }
    const card = page.getByTestId(`research-cell-change-${ready.researchProposalId}`);
    await card.waitFor();
    const documentPath = `${base}/api/app/research/documents/${ready.documentId}`;
    const readDocument = async () => {
      const response = await context.request.get(documentPath);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const original = await readDocument();
    assert.equal(original.cells[0].source, '## 原始研究问题');
    assert.equal(original.activeCellChangeReview, undefined);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await card.getByRole('button', { name: '审查变更', exact: true }).click();
    await page.getByRole('dialog').locator('.monaco-diff-editor').waitFor();
    assert.equal((await readDocument()).cells[0].source, original.cells[0].source);
    await page.screenshot({
      path: `${screenshots}/agent-code-review-research-diff.png`,
      fullPage: true,
    });
    await page.keyboard.press('Escape');
    await page.reload();
    await card.waitFor();
    assert.equal((await readDocument()).cells[0].source, original.cells[0].source);
    await card.getByRole('button', { name: '审查变更', exact: true }).click();
    await page.getByTestId('research-cell-change-accept-proposal').click();
    await card.getByText('已接受', { exact: true }).waitFor();
    const accepted = await readDocument();
    assert.ok(accepted.cells[0].source.includes('待验证假设'));
    assert.equal(accepted.activeCellChangeReview, undefined);
    assert.equal(accepted.cells[0].lastExecutedRevision, undefined);
    await page.keyboard.press('Escape');
    await page.reload();
    await card.getByText('已接受', { exact: true }).waitFor();
    await page.screenshot({
      path: `${screenshots}/agent-code-review-research-accepted.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    'PASS: code remains unchanged before acceptance; click-to-open diffs, close/reload recovery and explicit acceptance across requested surfaces.',
  );
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    if (server.connected) {
      server.send({ type: 'stop' });
    }
    const timer = setTimeout(() => server.kill('SIGKILL'), 10000);
    const [code, signal] = await exited;
    clearTimeout(timer);
    assert.equal(code, 0, `Fixture cleanup failed: ${signal ?? code}`);
  }
  log.end();
  if (base) {
    const socket = createConnection({ host: '127.0.0.1', port: Number(new URL(base).port) });
    const released = await new Promise((resolveReleased) => {
      socket.once('connect', () => {
        socket.destroy();
        resolveReleased(false);
      });
      socket.once('error', () => resolveReleased(true));
    });
    assert.ok(released, 'Fixture listener must be released');
  }
}
