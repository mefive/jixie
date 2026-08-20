import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '沪深300多股票数据研究';
const markdown = `# 沪深300多股票数据研究

目的：验证 Research 可以直接读取某日股票截面和历史月末 Panel，并在普通 Python Cell 中检查数据与画图。

这里不计算正式 IC 或分层报告；如果探索结果形成因子，再交给 FactorReport 统一验证。`;
const crossSectionSource = `cross_section = data.cross_section(
    "index:000300.SH",
    date="20260730",
    minimum_listed_days=365,
    risk_warning="exclude",
)
cross_audit = cross_section.attrs["jixie"]
print(
    f"实际数据日 {cross_audit['periods'][0]['dataDate']} · "
    f"成分快照 {cross_audit['periods'][0]['membershipAsOfDate']} · "
    f"数据 revision {cross_audit['dataRevision']}"
)
cross_section[[
    "date", "code", "name", "industry", "pe_ttm",
    "total_market_cap_cny_10k", "turnover_rate_pct",
]].sort_values("total_market_cap_cny_10k", ascending=False).head(12)`;
const panelSource = `panel = data.panel(
    "index:000300.SH",
    start="20250101",
    end="20251231",
    frequency="month_end",
    minimum_listed_days=365,
    risk_warning="exclude",
)
panel_audit = panel.attrs["jixie"]
monthly_summary = panel.groupby("date", as_index=False).agg(
    stocks=("code", "nunique"),
    median_pe_ttm=("pe_ttm", "median"),
    median_turnover_pct=("turnover_rate_pct", "median"),
)
print(
    f"{len(panel_audit['periods'])} 个完整月末 · "
    f"{panel_audit['rowCount']} 行 · revision {panel_audit['dataRevision']}"
)
monthly_summary`;
const chartSource = `normalized_summary = monthly_summary[["date"]].copy()
normalized_summary["valuation_index"] = (
    monthly_summary["median_pe_ttm"] / monthly_summary["median_pe_ttm"].iloc[0] * 100
)
normalized_summary["turnover_index"] = (
    monthly_summary["median_turnover_pct"] /
    monthly_summary["median_turnover_pct"].iloc[0] * 100
)
charts.line(
    normalized_summary,
    x="date",
    y=["valuation_index", "turnover_index"],
    title="沪深300月末估值与换手率（2025-01 = 100）",
    labels={
        "valuation_index": "PE TTM 中位数指数",
        "turnover_index": "换手率中位数指数",
    },
)`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1800 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-research-equity-panel-${Date.now()}@test.com`);

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
  document = await updateCell(page, markdownCell, markdown);
  const currentPythonCell = document.cells.find((cell) => cell.id === initialPythonCell.id);
  document = await updateCell(page, currentPythonCell, crossSectionSource);
  const crossSectionCellId = initialPythonCell.id;

  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: panelSource }),
  });
  const panelCellId = document.cells.at(-1).id;
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: chartSource }),
  });
  const chartCellId = document.cells.at(-1).id;

  for (const cellId of [crossSectionCellId, panelCellId, chartCellId]) {
    document = await api(page, `/api/app/research/cells/${cellId}/run`, { method: 'POST' });
    const cell = document.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== 'success') {
      throw new Error(`Research equity Cell failed: ${JSON.stringify(cell)}`);
    }
  }
  const crossSectionCell = document.cells.find((cell) => cell.id === crossSectionCellId);
  const panelCell = document.cells.find((cell) => cell.id === panelCellId);
  const chartCell = document.cells.find((cell) => cell.id === chartCellId);
  if (
    !crossSectionCell.outputs.some((output) => output.type === 'table' && output.rowCount === 12) ||
    !panelCell.outputs.some((output) => output.type === 'table' && output.rowCount === 12) ||
    !chartCell.outputs.some((output) => output.type === 'chart')
  ) {
    throw new Error(`Research equity outputs are incomplete: ${JSON.stringify(document.cells)}`);
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.locator(`[data-cell-id="${crossSectionCellId}"]`).getByText('已运行').waitFor();
  await page.locator(`[data-cell-id="${panelCellId}"]`).getByText('已运行').waitFor();
  await page.locator(`[data-cell-id="${chartCellId}"]`).getByText('已运行').waitFor();
  await page.getByTestId('research-interactive-chart').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}research-equity-panel.png`, fullPage: true });
  const panelCellElement = page.locator(`[data-cell-id="${panelCellId}"]`);
  await panelCellElement.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await panelCellElement.screenshot({ path: `${SHOTS}research-equity-panel-summary.png` });
  await page.locator(`[data-cell-id="${chartCellId}"]`).scrollIntoViewIfNeeded();
  await page
    .locator(`[data-cell-id="${chartCellId}"]`)
    .screenshot({ path: `${SHOTS}research-equity-panel-chart.png` });

  console.log(
    `[research-equity-panel-e2e] cross-section=true panel-periods=12 native-chart=true document=${documentId}`,
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
