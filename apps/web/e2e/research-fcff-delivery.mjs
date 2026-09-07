import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [email, manifestPath] = process.argv.slice(2);
if (!email || !manifestPath) {
  throw new Error('Pass the existing owner email and replay manifest');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const base = process.env.E2E_BASE ?? 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
const page = await context.newPage();
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await devLogin(page, email);
  for (const entry of manifest) {
    const document = await api(page, `/api/app/research/documents/${entry.documentId}`);
    const execution = await api(page, `/api/app/research/executions/${entry.executionId}`);
    if (document.cells.length !== 29 || execution.status !== 'success' || !execution.promotedAt) {
      throw new Error(`Persistent Research delivery is incomplete: ${entry.company}`);
    }
    if (
      !document.cells.some((cell) =>
        cell.source.includes(`valuation_identifier = "${entry.identifier}"`),
      )
    ) {
      throw new Error('Persistent Research identifier mismatch');
    }
    await page.goto(`${base}/research?document=${entry.documentId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByTestId('research-document').waitFor({ timeout: 30000 });
    if (entry.identifier === '000333.SZ') {
      const hide = page.getByRole('button', { name: '隐藏 Agent' });
      if (await hide.isVisible()) {
        await hide.click();
      }
      const chartCell = document.cells.find((cell) =>
        cell.source.includes('market_comparison_chart_data ='),
      );
      if (!chartCell) {
        throw new Error('Market chart Cell missing');
      }
      const chart = page
        .locator(`[data-cell-id="${chartCell.id}"]`)
        .getByTestId('research-interactive-chart');
      await chart.scrollIntoViewIfNeeded();
      await chart.locator('canvas').first().waitFor();
      await chart.screenshot({
        path: new URL('../acceptance/research-fcff-delivery-market.png', import.meta.url).pathname,
      });
    }
  }
  console.log(
    '[research-fcff-delivery] three owned documents readable; 29 Cells each; three successful sealed executions; browser chart captured',
  );
} finally {
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
