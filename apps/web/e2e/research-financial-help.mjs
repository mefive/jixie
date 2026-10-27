import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.E2E_DOCS_BASE ?? process.env.E2E_BASE ?? 'http://localhost:5174';
const screenshots = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(`${base}/docs/help/research/financial-data`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1, name: '自主分析财报数据' }).waitFor();
  await page.screenshot({ path: `${screenshots}research-financial-help-zh.png` });
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'Analyze financial data' }).waitFor();
  await page.getByRole('heading', { name: 'Period bases', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screenshots}research-financial-help-en.png` });
  await page.goto(`${base}/docs/sdk?runtime=research#data.equity_financial_values`, {
    waitUntil: 'networkidle',
  });
  await page.getByRole('heading', { level: 1, name: 'data.equity_financial_values' }).waitFor();
  await page.screenshot({ path: `${screenshots}research-financial-sdk-en.png` });
  if (await page.getByRole('link', { name: /fcff_scenarios|implied_revenue_growth/ }).count()) {
    throw new Error('Retired valuation helpers remain in the SDK navigation.');
  }
  if (!(await page.locator('body').innerText()).includes('equity_financial_values')) {
    throw new Error('Public SDK reference did not expose selected financial values.');
  }
  await page.getByRole('link', { name: 'equity_financial_statements', exact: true }).click();
  await page.getByRole('heading', { level: 1, name: 'data.equity_financial_statements' }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { level: 1, name: 'data.equity_financial_values' }).waitFor();
  if (errors.length) {
    throw new Error(errors.join('\n'));
  }
  console.log(
    '[research-financial-help-e2e] zh=true en=true retired-valuation-absent=true sdk=true screenshots=3',
  );
} finally {
  await context.close();
  await browser.close();
}
