import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '基本面研究数据能力验收';
const markdownSource = `# 基本面研究数据能力验收

目标：不用 SQL，从版本化三张表重建历史财务状态，并验证单股指标、PIT 截面与月末 Panel 使用同一套可审计口径。

结果中的单位、状态、缺失原因、公式版本与输入版本都是研究证据的一部分。`;
const statementSource = `statements = data.equity_financial_statements(
    "000858.SZ",
    as_of="20240429",
)
statement_sample = statements[
    (statements["report_period"] == "2022-12-31")
    & (statements["statement_kind"] == "income")
    & (statements["field"] == "revenue")
][[
    "report_period", "field", "value", "unit", "announcement_date",
    "available_date", "availability_quality", "source_row_fingerprint",
]]
statement_sample`;
const metricSource = `metrics = data.equity_financial_metrics(
    "000858.SZ",
    as_of="20250428",
)
metric_sample = metrics[
    (metrics["report_period"] == "2024-12-31")
    & metrics["metric"].isin(["revenue", "returnOnInvestedCapital", "freeCashFlowToFirm"])
][[
    "report_period", "metric", "value", "unit", "status",
    "missing_reason", "formula_version", "input_versions_json",
]]
metric_sample`;
const crossSectionSource = `financial_cross = data.equity_financial_cross_section(
    "index:000300.SH",
    date="20250428",
    metrics=["revenue", "returnOnInvestedCapital"],
    minimum_listed_days=365,
    risk_warning="exclude",
)
financial_cross[financial_cross["code"] == "000858.SZ"][[
    "date", "code", "name", "report_period", "metric", "value", "unit", "status",
]]`;
const panelSource = `financial_panel = data.equity_financial_panel(
    "index:000300.SH",
    start="20250401",
    end="20250430",
    frequency="month_end",
    metrics=["revenueGrowthYoY", "returnOnInvestedCapital"],
    minimum_listed_days=365,
    risk_warning="exclude",
)
financial_panel[financial_panel["code"] == "000858.SZ"][[
    "date", "code", "name", "report_period", "metric", "value", "unit", "status",
]]`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1600 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-research-financial-data-${Date.now()}@test.com`);

  let document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

  const markdownCell = document.cells.find((cell) => cell.kind === 'markdown');
  const initialPythonCell = document.cells.find((cell) => cell.kind === 'python');
  if (!markdownCell || !initialPythonCell) {
    throw new Error('blank research document is missing its initial Cells');
  }
  document = await updateCell(page, markdownCell, markdownSource);
  document = await updateCell(
    page,
    document.cells.find((cell) => cell.id === initialPythonCell.id),
    statementSource,
  );
  const statementCellId = initialPythonCell.id;

  const sources = [metricSource, crossSectionSource, panelSource];
  const cellIds = [statementCellId];
  for (const source of sources) {
    document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'python', source }),
    });
    cellIds.push(document.cells.at(-1).id);
  }

  const run = await api(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  if (run.execution?.status !== 'success' || run.execution.executedCellCount !== 5) {
    throw new Error(`Financial Research clean run failed: ${JSON.stringify(run.execution)}`);
  }
  const rowCounts = cellIds.map((cellId) => {
    const cell = run.document.cells.find((candidate) => candidate.id === cellId);
    return cell?.outputs.find((output) => output.type === 'table')?.rowCount;
  });
  if (rowCounts.join(',') !== '1,3,2,2') {
    throw new Error(`Unexpected financial Research output rows: ${rowCounts.join(',')}`);
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  for (const cellId of cellIds) {
    await page.locator(`[data-cell-id="${cellId}"]`).getByText('已运行').waitFor();
  }

  const metricCell = page.locator(`[data-cell-id="${cellIds[1]}"]`);
  await metricCell.scrollIntoViewIfNeeded();
  await metricCell.screenshot({ path: `${SHOTS}research-financial-metrics.png` });
  const panelCell = page.locator(`[data-cell-id="${cellIds[3]}"]`);
  await panelCell.scrollIntoViewIfNeeded();
  await panelCell.screenshot({ path: `${SHOTS}research-financial-panel.png` });

  console.log(
    `[research-financial-data-e2e] clean=true rows=${rowCounts.join('/')} methods=4 screenshots=2`,
  );
} finally {
  if (documentId) {
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

async function updateCell(page, cell, source) {
  return api(page, `/api/app/research/cells/${cell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ source, expectedRevision: cell.revision }),
  });
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
