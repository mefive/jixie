import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const ownerEmail = `e2e-research-documents-${Date.now()}@test.com`;
const titles = ['沪深300波动研究', '商品期限结构研究', '备用配置研究'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

const documentIds = [];
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);

  for (const title of titles) {
    const document = await api(page, '/api/app/research/documents', {
      method: 'POST',
      body: JSON.stringify({ template: 'blank' }),
    });
    documentIds.push(document.id);
    await api(page, `/api/app/research/conversations/${document.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  const sidebar = page.locator('.jx-research-sidebar');
  const search = page.getByTestId('research-document-search');
  await search.waitFor();
  await search.fill('期限结构');
  await page.getByText(titles[1], { exact: true }).waitFor();
  if (await page.getByText(titles[0], { exact: true }).isVisible()) {
    throw new Error('Document search did not filter non-matching titles.');
  }
  await page.mouse.move(1439, 899);
  await sidebar.screenshot({ path: `${SHOTS}research-document-search.png` });

  await search.clear();
  await page.getByText(titles[1], { exact: true }).click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByTestId(`research-document-menu-${documentIds[1]}`).click();
  await page.getByText('归档', { exact: true }).click();
  await page.getByText('新建研究', { exact: true }).waitFor();
  await page.locator('.ant-message-notice').last().waitFor({ state: 'detached' });
  await page.getByText('已归档', { exact: true }).click();

  const archivedItem = page.getByTestId(`research-document-item-${documentIds[1]}`);
  await archivedItem.waitFor();
  await page.waitForTimeout(300);
  await sidebar.screenshot({ path: `${SHOTS}research-document-archived.png` });
  await page.getByTestId(`research-document-menu-${documentIds[1]}`).click();
  await page.getByText('恢复', { exact: true }).waitFor();
  await page.getByText('永久删除', { exact: true }).waitFor();
  await page.getByText('恢复', { exact: true }).click();
  await archivedItem.waitFor({ state: 'detached' });
  await page.locator('.ant-message-notice').last().waitFor({ state: 'detached' });

  await page.getByText('当前', { exact: true }).click();
  await page.getByText(titles[1], { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '研究记录', exact: true }).click();
  await search.fill('商品期限');
  await page.getByText(titles[1], { exact: true }).waitFor();
  await page.getByTestId(`research-document-menu-${documentIds[1]}`).click();
  await page.getByText('归档', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-document-mobile.png` });

  console.log(
    '[research-document-management-e2e] search=pass archive=pass restore=pass mobile=pass',
  );
} finally {
  await devLogin(page, ownerEmail).catch(() => {});
  for (const documentId of documentIds) {
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
