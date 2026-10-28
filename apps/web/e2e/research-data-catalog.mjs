import assert from 'node:assert/strict';
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
  await api(page, `/api/app/research/documents/${documentId}`, {
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
  for (const method of [
    'cross_section',
    'panel',

    'equity_fundamentals',
    'equity_dividends',
    'etf_shares',
    'index_valuation',
    'equity_financial_statements',
    'equity_financial_metrics',
    'equity_financial_cross_section',
    'equity_financial_panel',
    'equity_financial_values',
  ]) {
    await page.getByTestId(`research-data-catalog-method-${method}`).waitFor();
  }
  assert.equal(await page.getByTestId('research-data-catalog-method-equity_flows').count(), 0);
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

  await page.getByTestId('research-data-catalog-method-equity_financial_metrics').click();
  await methodDetail.waitFor();
  if (!(await methodDetail.innerText()).includes('formula_version')) {
    throw new Error('The catalog did not expose auditable financial metric columns.');
  }
  await methodDetail.getByText('missing_reason', { exact: true }).hover();
  await page.getByText('缺失或无效时的机器可读原因。', { exact: true }).waitFor();
  await page.getByTestId('research-data-catalog-method-equity_financial_metrics').click();
  await methodDetail.waitFor({ state: 'detached' });

  const config = page.getByTestId('research-data-catalog-dataset-config');

  for (const method of [
    'commodity_returns',
    'commodity_warehouse_receipts',
    'commodity_holdings',
    'futures_settlement',
    'yield_curve',
    'macro',
    'fx',
  ]) {
    assert.equal(await page.getByTestId(`research-data-catalog-method-${method}`).count(), 0);
  }

  await drawer.getByRole('textbox', { name: '搜索股票、ETF、指数或数据读取方式' }).fill('沪深 300');
  for (const { query, method, identifier } of [
    { query: '510300.SH', method: 'etf_shares', identifier: '510300.SH' },
    { query: '000300.SH', method: 'index_valuation', identifier: '000300.SH' },
  ]) {
    await drawer.getByRole('textbox', { name: '搜索股票、ETF、指数或数据读取方式' }).fill(query);
    const referenceResult = page.getByTestId(
      `research-data-catalog-dataset-data.${method}:${identifier}`,
    );
    await referenceResult.waitFor({ timeout: 30_000 });
    await referenceResult.click();
    await config.waitFor();
    await config.scrollIntoViewIfNeeded();
    if (!(await config.innerText()).includes(`data.${method}(`)) {
      throw new Error(`The selected ${method} dataset did not generate an SDK call preview.`);
    }
  }
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-reference-datasets.png` });

  await drawer
    .getByRole('textbox', { name: '搜索股票、ETF、指数或数据读取方式' })
    .fill('标准化财务指标');
  const financialResult = page.getByTestId(
    'research-data-catalog-dataset-data.equity_financial_metrics',
  );
  await financialResult.waitFor({ timeout: 30_000 });
  await financialResult.click();
  await config.waitFor();
  const financialPreview = await config.innerText();
  if (
    !financialPreview.includes('data.equity_financial_metrics(') ||
    !financialPreview.includes('000858.SZ')
  ) {
    throw new Error(
      `Financial dataset did not generate the expected SDK call: ${financialPreview}`,
    );
  }
  await config.scrollIntoViewIfNeeded();
  await drawer.screenshot({ path: `${SHOTS}research-data-catalog-financial-metrics.png` });

  await drawer
    .getByRole('textbox', { name: '搜索股票、ETF、指数或数据读取方式' })
    .fill('自选财报科目');
  await page.getByTestId('research-data-catalog-dataset-data.equity_financial_values').click();
  await config.waitFor();
  await config.getByRole('textbox').first().fill('000858.SZ,600519.SH');
  const valuesPreview = await config.locator('pre').innerText();
  for (const expected of [
    'data.equity_financial_values(',
    '["000858.SZ","600519.SH"]',
    'report_start=',
    'report_end=',
    'as_of=',
    'period="annual"',
    'balance_sheet.totalAssets',
  ]) {
    if (!valuesPreview.includes(expected)) {
      throw new Error(`Missing financial query option: ${expected}`);
    }
  }
  await config.scrollIntoViewIfNeeded();
  await config.screenshot({ path: `${SHOTS}research-data-catalog-financial-values.png` });

  const insert = page.getByTestId('research-data-catalog-insert');
  if (!(await insert.isEnabled())) {
    throw new Error('A locally covered dataset must be insertable into Research.');
  }
  await insert.click();
  await page.getByText('已插入当前 Python Cell', { exact: true }).waitFor({ timeout: 10_000 });

  console.log(
    `[research-data-catalog-e2e] datasetMethods=21 coverage=retained ETF/index data financial=true inserted=true screenshots=9`,
  );
} finally {
  if (documentId) {
    await devLogin(page, ownerEmail).catch(() => {});
    await page
      .evaluate(async (id) => {
        await fetch(`/api/app/research/documents/${encodeURIComponent(id)}`, {
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
