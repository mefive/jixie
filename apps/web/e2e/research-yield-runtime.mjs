import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '美国国债收益率曲线与统计环境';
const markdownSource = `# 美国国债收益率曲线与统计环境

目标：读取美国国债 10Y 与 2Y 名义收益率月度水平，检查期限利差，并验证固定 SciPy / statsmodels 运行环境。

收益率水平单位是百分比，期限利差单位是百分点。本例只验证数据和运行能力，不把样本统计写成交易信号。`;
const yieldSource = `nominal_10y = data.yield_curve(
    "us_treasury_nominal",
    tenor="10Y",
    start="20240101",
    end="20251231",
    frequency="monthly",
    transform="level",
)
nominal_2y = data.yield_curve(
    "us_treasury_nominal",
    tenor="2Y",
    start="20240101",
    end="20251231",
    frequency="monthly",
    transform="level",
)
yield_sample = nominal_10y.rename(columns={"value": "nominal_10y_pct"}).merge(
    nominal_2y.rename(columns={"value": "nominal_2y_pct"}),
    on="date",
    how="inner",
)
yield_sample["spread_pp"] = yield_sample["nominal_10y_pct"] - yield_sample["nominal_2y_pct"]
print(f"sample={yield_sample['date'].min().date()}..{yield_sample['date'].max().date()} n={len(yield_sample)}")
nominal_10y.tail(12)`;
const statisticsSource = `from scipy import stats
import statsmodels.api as sm

clean_spread = yield_sample["spread_pp"].dropna()
t_stat, p_value = stats.ttest_1samp(clean_spread, popmean=0.0)
time_index = sm.add_constant(np.arange(len(clean_spread)))
trend = sm.OLS(clean_spread.to_numpy(), time_index).fit(
    cov_type="HAC",
    cov_kwds={"maxlags": 2},
)
runtime_summary = pd.DataFrame(
    {
        "metric": ["observations", "mean_spread_pp", "one_sample_t", "two_sided_p", "hac_trend_pp"],
        "value": [len(clean_spread), clean_spread.mean(), t_stat, p_value, trend.params[1]],
    }
)
runtime_summary`;
const chartSource = `charts.line(
    yield_sample,
    x="date",
    y=["nominal_10y_pct", "nominal_2y_pct"],
    title="US Treasury nominal yields",
    labels={
        "nominal_10y_pct": "10Y yield (%)",
        "nominal_2y_pct": "2Y yield (%)",
    },
)`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-research-yield-runtime-${Date.now()}@test.com`);

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
  const currentPythonCell = document.cells.find((cell) => cell.id === initialPythonCell.id);
  document = await updateCell(page, currentPythonCell, yieldSource);
  const yieldCellId = initialPythonCell.id;

  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: statisticsSource }),
  });
  const statisticsCellId = document.cells.at(-1).id;
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: chartSource }),
  });
  const chartCellId = document.cells.at(-1).id;

  for (const cellId of [yieldCellId, statisticsCellId, chartCellId]) {
    document = await api(page, `/api/app/research/cells/${cellId}/run`, { method: 'POST' });
    const cell = document.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== 'success') {
      throw new Error(`Research yield-runtime Cell failed: ${JSON.stringify(cell)}`);
    }
  }

  const yieldCell = document.cells.find((cell) => cell.id === yieldCellId);
  const statisticsCell = document.cells.find((cell) => cell.id === statisticsCellId);
  const chartCell = document.cells.find((cell) => cell.id === chartCellId);
  const yieldTable = yieldCell.outputs.find((output) => output.type === 'table');
  const statisticsTable = statisticsCell.outputs.find((output) => output.type === 'table');
  if (
    yieldTable?.rowCount !== 12 ||
    statisticsTable?.rowCount !== 5 ||
    !chartCell.outputs.some((output) => output.type === 'chart')
  ) {
    throw new Error(
      `Research yield-runtime outputs are incomplete: ${JSON.stringify(document.cells)}`,
    );
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '新建研究' }).waitFor({ timeout: 30_000 });
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}research-new-prompt.png` });

  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  for (const cellId of [yieldCellId, statisticsCellId, chartCellId]) {
    await page.locator(`[data-cell-id="${cellId}"]`).getByText('已运行').waitFor();
  }
  const yieldCellElement = page.locator(`[data-cell-id="${yieldCellId}"]`);
  await yieldCellElement.scrollIntoViewIfNeeded();
  await yieldCellElement.locator('.monaco-editor').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(250);
  await yieldCellElement.screenshot({ path: `${SHOTS}research-yield-runtime-data.png` });
  const statisticsCellElement = page.locator(`[data-cell-id="${statisticsCellId}"]`);
  await statisticsCellElement.scrollIntoViewIfNeeded();
  await statisticsCellElement.screenshot({ path: `${SHOTS}research-yield-runtime-stats.png` });
  const chartCellElement = page.locator(`[data-cell-id="${chartCellId}"]`);
  await chartCellElement.scrollIntoViewIfNeeded();
  await page.getByTestId('research-interactive-chart').waitFor({ timeout: 30_000 });
  await chartCellElement.screenshot({ path: `${SHOTS}research-yield-runtime-chart.png` });

  console.log(
    `[research-yield-runtime-e2e] rows=${yieldTable.rowCount} scipy=true statsmodels=true chart=true`,
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
