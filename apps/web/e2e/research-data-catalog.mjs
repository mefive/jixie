import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '研究数据目录可发现性验收';
const ownerEmail = `e2e-research-data-catalog-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 });

  await page.getByTestId('research-open-data-catalog').click();
  const drawer = page.getByRole('dialog', { name: '数据目录' });
  await drawer.waitFor();
  await page.getByTestId('research-data-catalog-capabilities').waitFor();
  for (const method of ['data.series', 'data.cross_section', 'data.panel', 'data.yield_curve']) {
    await drawer.getByText(method, { exact: true }).waitFor();
  }
  await drawer.locator('.ant-drawer-body').evaluate((element) => element.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.mouse.move(0, 999);
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-capabilities.png` });

  await page.getByTestId('research-data-catalog-method-panel').click();
  const methodDetail = page.getByTestId('research-data-catalog-method-detail');
  await methodDetail.waitFor();
  await drawer.locator('.ant-drawer-body').evaluate((element) => element.scrollTo(0, 0));
  await page.waitForTimeout(100);
  if (!(await methodDetail.innerText()).includes('data.panel(')) {
    throw new Error('The catalog did not expose the data.panel signature.');
  }
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-method-detail.png` });
  await page.getByTestId('research-data-catalog-method-panel').click();
  await methodDetail.waitFor({ state: 'detached' });

  await drawer.getByText('指数', { exact: true }).click();
  await drawer.getByRole('textbox', { name: '输入证券代码、指数名称或关键词' }).fill('000300.SH');
  const result = page.getByTestId('research-data-catalog-result-000300.SH');
  await result.waitFor({ timeout: 30_000 });
  const coverage = page.getByTestId('research-data-catalog-coverage-000300.SH');
  const coverageText = await coverage.innerText();
  if (!/\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}.*条/.test(coverageText)) {
    throw new Error(`Index coverage was not exposed: ${coverageText}`);
  }
  await result.click();
  const config = page.getByTestId('research-data-catalog-config');
  await config.waitFor();
  await config.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.mouse.move(0, 999);
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-coverage.png` });

  const insert = page.getByTestId('research-data-catalog-insert');
  if (!(await insert.isEnabled())) {
    throw new Error('A locally covered index must be insertable into Research.');
  }
  if (!(await config.innerText()).includes('data.series(')) {
    throw new Error('The selected local series did not generate an SDK call preview.');
  }

  console.log(
    `[research-data-catalog-e2e] methods=4 coverage=${coverageText} insertable=true screenshots=3`,
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
