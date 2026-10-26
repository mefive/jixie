import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '五粮液 FCFF 估值闭环示例';
const ownerEmail = `e2e-research-fcff-${Date.now()}@test.com`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1400 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, ownerEmail);
  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });

  const starter = page.getByTestId('research-create-fcff-valuation');
  await starter.waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}research-fcff-template-entry.png` });
  await starter.click();
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });

  const documents = await api(page, '/api/app/research/documents?state=active');
  const documentSummary = documents.find((document) => document.title === title);
  if (!documentSummary) {
    throw new Error('FCFF starter did not create a Research document');
  }
  documentId = documentSummary.id;

  const created = await api(page, `/api/app/research/documents/${documentId}`);
  if (created.cells.length !== 29) {
    throw new Error(`FCFF template created ${created.cells.length} Cells instead of 29`);
  }
  const parameterCell = created.cells.find(
    (cell) => cell.kind === 'python' && cell.source.includes('valuation_identifier = "000858.SZ"'),
  );
  if (!parameterCell) {
    throw new Error('FCFF template is missing its parameter Cell');
  }

  const run = await api(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  if (run.document.cells.some((cell) => cell.status !== 'success') || 'execution' in run) {
    throw new Error(`FCFF current output run failed: ${JSON.stringify(run)}`);
  }

  const scenarioCell = findCell(run.document.cells, 'scenario_valuation["scenario_range_low_cny"]');
  const sensitivityCell = findCell(run.document.cells, 'sensitivity_chart = charts.heatmap');
  const reverseCell = findCell(run.document.cells, 'reverse_valuation = valuation.implied');
  const reviewCell = findCell(run.document.cells, 'narrative_review = pd.DataFrame');
  const scenarioOutput = tableOutput(scenarioCell);
  const reverseOutput = tableOutput(reverseCell);
  const reviewOutput = tableOutput(reviewCell);
  const sensitivityOutput = sensitivityCell.outputs.find((output) => output.type === 'chart');
  if (
    scenarioOutput.rowCount !== 3 ||
    !scenarioOutput.rows.every((row) => row.scenario_range_low_cny < row.scenario_range_high_cny)
  ) {
    throw new Error(`FCFF scenario output is invalid: ${JSON.stringify(scenarioOutput)}`);
  }
  const baseScenario = scenarioOutput.rows.find((row) => row.scenario === 'base');
  if (
    !baseScenario?.diagnostics.includes('high_terminal_value_share') ||
    !scenarioOutput.rows.every((row) =>
      row.diagnostics.includes('operating_cash_assumption_requires_review'),
    )
  ) {
    throw new Error(`FCFF diagnostics are missing: ${JSON.stringify(scenarioOutput)}`);
  }
  if (reverseOutput.rows[0]?.status !== 'solved') {
    throw new Error(`FCFF reverse valuation was not identified: ${JSON.stringify(reverseOutput)}`);
  }
  if (
    reviewOutput.rowCount !== 4 ||
    !reviewOutput.rows.every((row) => row.review_report_period === '2025-12-31')
  ) {
    throw new Error(`FCFF narrative review is invalid: ${JSON.stringify(reviewOutput)}`);
  }
  if (!sensitivityOutput) {
    throw new Error('FCFF sensitivity chart was not produced');
  }

  await page.goto(`${BASE}/research?document=${encodeURIComponent(documentId)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();

  const scenarioElement = page.locator(`[data-cell-id="${scenarioCell.id}"]`);
  await scenarioElement.getByText('已运行', { exact: true }).waitFor();
  await scenarioElement.scrollIntoViewIfNeeded();
  await scenarioElement.screenshot({ path: `${SHOTS}research-fcff-scenarios.png` });

  const sensitivityElement = page.locator(`[data-cell-id="${sensitivityCell.id}"]`);
  await sensitivityElement.locator('.jx-research-chartOutput canvas').first().waitFor({
    timeout: 30_000,
  });
  await sensitivityElement.scrollIntoViewIfNeeded();
  await sensitivityElement.screenshot({ path: `${SHOTS}research-fcff-sensitivity.png` });

  const reviewElement = page.locator(`[data-cell-id="${reviewCell.id}"]`);
  await reviewElement.scrollIntoViewIfNeeded();
  await reviewElement.screenshot({ path: `${SHOTS}research-fcff-narrative-review.png` });

  const updated = await api(page, `/api/app/research/cells/${parameterCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      source: parameterCell.source.replace('forecast_years = 5', 'forecast_years = 6'),
      expectedRevision: parameterCell.revision,
    }),
  });
  for (const outputCell of [
    scenarioCell,
    sensitivityCell,
    reverseCell,
    reviewCell,
    run.document.cells.find((cell) => cell.source.includes('classification_valuation_rows = []')),
  ]) {
    const current = updated.cells.find((cell) => cell.id === outputCell.id);
    if (current?.status !== 'stale') {
      throw new Error(`parameter change did not stale ${outputCell.id}: ${current?.status}`);
    }
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByTestId('research-document').waitFor();
  if (await page.getByTestId('research-open-execution-history').count()) {
    throw new Error('Retired history entry remains');
  }
  await page.screenshot({ path: `${SHOTS}research-fcff-current-stale.png` });
  console.log(
    '[research-fcff-valuation-e2e] cells=29 scenarios=3 reverse=solved review=4 stale=true history=removed screenshots=5',
  );
  console.log(
    `[research-fcff-valuation-e2e] result=${JSON.stringify({
      scenarios: scenarioOutput.rows.map((row) => ({
        scenario: row.scenario,
        perShareValueCny: row.per_share_value_cny,
        marketPricePerShareCny: row.market_price_per_share_cny,
        terminalValueShare: row.terminal_value_share,
        diagnostics: row.diagnostics,
      })),
      reverseRevenueGrowth: reverseOutput.rows[0]?.implied_value,
      review: reviewOutput.rows.map((row) => ({
        assumption: row.assumption,
        actual: row.actual,
        assessment: row.assessment,
      })),
    })}`,
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

function findCell(cells, sourceFragment) {
  const cell = cells.find((candidate) => candidate.source.includes(sourceFragment));
  if (!cell) {
    throw new Error(`Research Cell not found for ${sourceFragment}`);
  }
  return cell;
}

function tableOutput(cell) {
  const output = cell.outputs.find((candidate) => candidate.type === 'table');
  if (!output) {
    throw new Error(`Research Cell ${cell.id} has no table output`);
  }
  return output;
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
