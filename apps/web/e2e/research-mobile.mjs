import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '移动端研究工作台验收';
const ownerEmail = `e2e-research-mobile-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '研究记录', exact: true }).click();
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(200);
  await page.mouse.move(389, 843);

  const documentBox = await page.locator('.jx-research-workspace').boundingBox();
  if (!documentBox || documentBox.x > 1 || documentBox.width < 389) {
    throw new Error(`Research document remained offset after history closed: ${documentBox?.x}`);
  }

  const agentPane = page.locator('.jx-research-agentPane');
  if (await agentPane.isVisible()) {
    throw new Error('Research Agent must be closed by default on a narrow viewport.');
  }
  await page.getByTestId('research-mobile-actions').waitFor();
  await page.screenshot({ path: `${SHOTS}research-mobile-document.png` });

  await page.getByTestId('research-cell-attach-agent').first().click();
  await agentPane.waitFor();
  await page.getByTestId('research-agent-cell-context').waitFor();
  await page.getByText('Cell 01 · Markdown', { exact: true }).waitFor();
  const closeAgent = page.getByTestId('research-mobile-agent-close');
  await closeAgent.waitFor();
  const agentBox = await agentPane.boundingBox();
  if (!agentBox || agentBox.width < 380) {
    throw new Error(`Research Agent did not use the mobile workspace width: ${agentBox?.width}`);
  }
  await page.screenshot({ path: `${SHOTS}research-mobile-agent.png` });

  await closeAgent.click();
  await agentPane.waitFor({ state: 'detached' });
  await page.getByTestId('research-mobile-actions').click();
  const actionMenu = page.locator('.ant-dropdown-menu');
  await actionMenu.getByText('打开数据目录', { exact: true }).waitFor();
  await actionMenu.getByText('完整运行历史', { exact: true }).waitFor();
  await actionMenu.getByText('重置环境', { exact: true }).waitFor();
  await actionMenu.getByText('干净运行全文', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-mobile-actions.png` });

  await actionMenu.getByText('打开数据目录', { exact: true }).click();
  const dataCatalog = page.getByRole('dialog', { name: '数据目录' });
  await dataCatalog.waitFor();
  await dataCatalog.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('research-mobile-actions').click();
  await actionMenu.getByText('完整运行历史', { exact: true }).click();
  await page.getByTestId('research-execution-drawer').waitFor();

  console.log(
    '[research-mobile-e2e] default=document agent=full-width actions=accessible screenshots=3',
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
