import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/learning/', import.meta.url).pathname;
mkdirSync(OUTPUT, { recursive: true });

const title = '学习案例：中港美人民币月收益相关性';
const markdown = `# 中港美人民币月收益相关性

固定样本：2015-01 至 2025-12。对象为沪深 300、恒生指数和标普 500 价格指数，跨市场数据按中国收盘时点可得信息对齐。

主要证据：完整共同月度样本、36 个月滚动相关，以及固定随机种子的 12 个月区块 bootstrap 95% 区间。`;
const loadSource = `import numpy as np
import pandas as pd

START = "20150101"
END = "20251231"

def series_column(frame: pd.DataFrame, column: str) -> pd.DataFrame:
    return frame.rename(columns={"value": column}).set_index("date")

returns = pd.concat(
    [
        series_column(
            data.series(
                "index", "equity.cn.csi300.price",
                start=START, end=END, measure="market.cny_close",
                frequency="monthly", transform="simple_return",
                partial_period="exclude",
            ),
            "csi300_cny",
        ),
        series_column(
            data.series(
                "index", "equity.hk.hsi.price",
                start=START, end=END, measure="market.adjusted_close",
                frequency="monthly", transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_local",
        ),
        series_column(
            data.series(
                "index", "equity.hk.hsi.price",
                start=START, end=END, measure="market.cny_close",
                frequency="monthly", transform="simple_return",
                partial_period="exclude",
            ),
            "hsi_cny",
        ),
        series_column(
            data.series(
                "index", "equity.us.spx.price",
                start=START, end=END, measure="market.adjusted_close",
                frequency="monthly", transform="simple_return",
                partial_period="exclude",
            ),
            "spx_local",
        ),
        series_column(
            data.series(
                "index", "equity.us.spx.price",
                start=START, end=END, measure="market.cny_close",
                frequency="monthly", transform="simple_return",
                partial_period="exclude",
            ),
            "spx_cny",
        ),
    ],
    axis=1,
    join="inner",
).dropna().sort_index()

returns["hsi_fx"] = (1 + returns["hsi_cny"]) / (1 + returns["hsi_local"]) - 1
returns["spx_fx"] = (1 + returns["spx_cny"]) / (1 + returns["spx_local"]) - 1
hsi_identity_error = (
    (1 + returns["hsi_local"]) * (1 + returns["hsi_fx"]) - (1 + returns["hsi_cny"])
).abs().max()
spx_identity_error = (
    (1 + returns["spx_local"]) * (1 + returns["spx_fx"]) - (1 + returns["spx_cny"])
).abs().max()

sample_audit = pd.DataFrame([{
    "observations": len(returns),
    "first_month": returns.index.min(),
    "last_month": returns.index.max(),
    "hsi_identity_max_error": hsi_identity_error,
    "spx_identity_max_error": spx_identity_error,
}])
sample_audit`;
const rollingSource = `cny_columns = ["csi300_cny", "hsi_cny", "spx_cny"]
full_sample_correlation = returns[cny_columns].corr()

rolling_correlation = pd.DataFrame(index=returns.index)
rolling_correlation["CSI 300 / Hang Seng"] = returns["csi300_cny"].rolling(36).corr(
    returns["hsi_cny"]
)
rolling_correlation["CSI 300 / S&P 500"] = returns["csi300_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation["Hang Seng / S&P 500"] = returns["hsi_cny"].rolling(36).corr(
    returns["spx_cny"]
)
rolling_correlation = rolling_correlation.dropna().reset_index()

charts.line(
    rolling_correlation,
    x="date",
    y=["CSI 300 / Hang Seng", "CSI 300 / S&P 500", "Hang Seng / S&P 500"],
    title="36-month rolling correlation of CNY price-index returns",
)`;
const inferenceSource = `def block_bootstrap_correlation(
    frame: pd.DataFrame,
    left: str,
    right: str,
    block_length: int = 12,
    resamples: int = 5000,
    seed: int = 20260825,
) -> pd.Series:
    paired = frame[[left, right]].dropna().to_numpy()
    observation_count = len(paired)
    if observation_count < block_length * 2:
        raise ValueError("Sample is too short for the chosen block length")

    random = np.random.default_rng(seed)
    block_count = int(np.ceil(observation_count / block_length))
    maximum_start = observation_count - block_length + 1
    estimates = np.empty(resamples)
    for sample_index in range(resamples):
        starts = random.integers(0, maximum_start, size=block_count)
        indices = np.concatenate(
            [np.arange(start, start + block_length) for start in starts]
        )[:observation_count]
        sample = paired[indices]
        estimates[sample_index] = np.corrcoef(sample[:, 0], sample[:, 1])[0, 1]

    return pd.Series({
        "estimate": np.corrcoef(paired[:, 0], paired[:, 1])[0, 1],
        "ci_low": np.quantile(estimates, 0.025),
        "ci_high": np.quantile(estimates, 0.975),
        "observations": observation_count,
        "block_months": block_length,
    })

pairs = [
    ("沪深300 / 恒生", "CSI 300 / Hang Seng", "csi300_cny", "hsi_cny"),
    ("沪深300 / 标普500", "CSI 300 / S&P 500", "csi300_cny", "spx_cny"),
    ("恒生 / 标普500", "Hang Seng / S&P 500", "hsi_cny", "spx_cny"),
]
rows = []
for label, rolling_label, left, right in pairs:
    interval = block_bootstrap_correlation(returns, left, right)
    rows.append({
        "关系": label,
        "全样本相关": interval["estimate"],
        "95%下限": interval["ci_low"],
        "95%上限": interval["ci_high"],
        "滚动最小": rolling_correlation[rolling_label].min(),
        "滚动最大": rolling_correlation[rolling_label].max(),
        "月数": int(interval["observations"]),
    })

case_result = pd.DataFrame(rows).round(4)
case_result`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await devLogin(page, `e2e-learning-cross-market-${Date.now()}@test.com`);

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
    throw new Error('blank Research document is missing initial Cells');
  }
  document = await updateCell(page, markdownCell, markdown);
  document = await updateCell(
    page,
    document.cells.find((cell) => cell.id === initialPythonCell.id),
    loadSource,
  );
  const auditCellId = initialPythonCell.id;

  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: rollingSource }),
  });
  const rollingCellId = document.cells.at(-1).id;
  document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'python', source: inferenceSource }),
  });
  const resultCellId = document.cells.at(-1).id;

  const run = await api(page, `/api/app/research/documents/${documentId}/run`, {
    method: 'POST',
    body: JSON.stringify({ clean: true }),
  });
  if (
    run.execution?.status !== 'success' ||
    run.execution.cellCount !== 4 ||
    run.execution.executedCellCount !== 4
  ) {
    throw new Error(`cross-market Research execution failed: ${JSON.stringify(run.execution)}`);
  }

  const frozen = await api(page, `/api/app/research/executions/${run.execution.id}`);
  const auditOutput = tableOutput(frozen, auditCellId);
  const resultOutput = tableOutput(frozen, resultCellId);
  const chartOutput = outputOfType(frozen, rollingCellId, 'chart');
  const audit = auditOutput.rows[0];
  if (
    auditOutput.rowCount !== 1 ||
    Number(audit.observations) < 120 ||
    String(audit.first_month).slice(0, 7) !== '2015-01' ||
    String(audit.last_month).slice(0, 7) !== '2025-12' ||
    Number(audit.hsi_identity_max_error) > 1e-10 ||
    Number(audit.spx_identity_max_error) > 1e-10
  ) {
    throw new Error(`invalid cross-market sample audit: ${JSON.stringify(audit)}`);
  }
  if (resultOutput.rowCount !== 3 || chartOutput.rows.length < 80) {
    throw new Error(
      `cross-market evidence is incomplete: ${JSON.stringify({ resultOutput, chartOutput })}`,
    );
  }
  for (const row of resultOutput.rows) {
    const values = [
      row['全样本相关'],
      row['95%下限'],
      row['95%上限'],
      row['滚动最小'],
      row['滚动最大'],
    ].map(Number);
    if (
      values.some((value) => !Number.isFinite(value) || value < -1 || value > 1) ||
      Number(row['95%下限']) > Number(row['95%上限']) ||
      Number(row['滚动最小']) > Number(row['滚动最大'])
    ) {
      throw new Error(`invalid cross-market result row: ${JSON.stringify(row)}`);
    }
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  await page.getByTestId('research-document').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  for (const cellId of [auditCellId, rollingCellId, resultCellId]) {
    await page.locator(`[data-cell-id="${cellId}"]`).getByText('已运行', { exact: true }).waitFor();
  }
  const auditTable = page.locator(
    `[data-cell-id="${auditCellId}"] [data-testid="research-table-output"]`,
  );
  await auditTable.getByText('132', { exact: true }).first().waitFor();
  await auditTable.screenshot({ path: `${OUTPUT}cross-market-sample-audit.png` });

  const rollingChart = page.locator(
    `[data-cell-id="${rollingCellId}"] [data-testid="research-interactive-chart"]`,
  );
  await rollingChart.locator('canvas').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await rollingChart.screenshot({ path: `${OUTPUT}cross-market-rolling-correlation.png` });

  const resultTable = page.locator(
    `[data-cell-id="${resultCellId}"] [data-testid="research-table-output"]`,
  );
  await resultTable.getByText('沪深300 / 恒生', { exact: true }).waitFor({ timeout: 30_000 });
  await resultTable.screenshot({ path: `${OUTPUT}cross-market-case-result.png` });

  if (browserErrors.length) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[learning-cross-market] PASS execution=${run.execution.id} observations=${audit.observations} ` +
      `results=${JSON.stringify(resultOutput.rows)}`,
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

function tableOutput(execution, cellId) {
  return outputOfType(execution, cellId, 'table');
}

function outputOfType(execution, cellId, type) {
  const cell = execution.cells.find((candidate) => candidate.cellId === cellId);
  const output = cell?.outputs.find((candidate) => candidate.type === type);
  if (!output) {
    throw new Error(`missing ${type} output for Research Cell ${cellId}`);
  }
  return output;
}

async function updateCell(page, cell, source) {
  if (!cell) {
    throw new Error('Research Cell disappeared while building the case');
  }
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
        throw new Error(`${requestPath}: ${JSON.stringify(body)}`);
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
