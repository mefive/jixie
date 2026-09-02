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
  await drawer.getByText('data.series', { exact: true }).waitFor();
  await drawer.locator('.ant-drawer-body').evaluate((element) => element.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.mouse.move(0, 999);
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-capabilities.png` });

  await drawer.getByText('数据集', { exact: true }).click();
  for (const method of ['cross_section', 'panel', 'yield_curve', 'macro', 'fx']) {
    await page.getByTestId(`research-data-catalog-method-${method}`).waitFor();
  }
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

  await drawer.getByRole('textbox', { name: '搜索市场、指数、期限或数据读取方式' }).fill('10Y');
  const result = page.getByTestId(
    'research-data-catalog-dataset-data.yield_curve:us_treasury_nominal:10Y',
  );
  await result.waitFor({ timeout: 30_000 });
  const coverageText = await result.locator('.jx-researchDataCatalog-coverage').innerText();
  if (!/\d{4}-\d{2}-\d{2}.*\d{4}-\d{2}-\d{2}/.test(coverageText)) {
    throw new Error(`Dataset coverage was not exposed: ${coverageText}`);
  }
  await result.click();
  const config = page.getByTestId('research-data-catalog-dataset-config');
  await config.waitFor();
  await config.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.mouse.move(0, 999);
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-datasets.png` });

  await drawer.getByRole('textbox', { name: '搜索市场、指数、期限或数据读取方式' }).fill('CPI');
  const macroResult = page.getByTestId('research-data-catalog-dataset-data.macro:cn_cpi_yoy');
  await macroResult.waitFor({ timeout: 30_000 });
  await macroResult.click();
  await config.waitFor();
  await config.scrollIntoViewIfNeeded();
  if (!(await config.innerText()).includes('data.macro(')) {
    throw new Error('The selected macro dataset did not generate an SDK call preview.');
  }
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-macro.png` });

  const insert = page.getByTestId('research-data-catalog-insert');
  if (!(await insert.isEnabled())) {
    throw new Error('A locally covered dataset must be insertable into Research.');
  }
  await insert.click();
  await page.getByText('已插入当前 Python Cell', { exact: true }).waitFor({ timeout: 10_000 });

  console.log(
    `[research-data-catalog-e2e] datasetMethods=5 coverage=${coverageText} inserted=true screenshots=4`,
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
