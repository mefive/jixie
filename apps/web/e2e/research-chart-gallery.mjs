import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const title = '量化研究原生统计图';
const sources = [
  `monthly_returns = [
    {"return": _return} for _return in
    [-0.061, -0.043, -0.032, -0.025, -0.018, -0.012, -0.009, -0.004,
     0.001, 0.004, 0.008, 0.011, 0.014, 0.019, 0.023, 0.027,
     0.031, 0.036, 0.042, 0.051, 0.067]
]
charts.histogram(  # type: ignore[arg-type]
    monthly_returns, column="return", bins=8,
    labels={"return": "月收益"}, title="月收益分布"
)`,
  `style_returns = (
    [{"style": "价值", "monthly_return": _value} for _value in [-0.03, -0.01, 0.00, 0.01, 0.02, 0.025, 0.03, 0.05]] +
    [{"style": "成长", "monthly_return": _value} for _value in [-0.06, -0.025, -0.01, 0.015, 0.03, 0.045, 0.06, 0.09]] +
    [{"style": "红利", "monthly_return": _value} for _value in [-0.015, -0.005, 0.004, 0.009, 0.014, 0.018, 0.024, 0.032]]
)
charts.boxplot(  # type: ignore[arg-type]
    style_returns, y="monthly_return", group="style",
    labels={"monthly_return": "月收益"}, title="风格月收益分布"
)`,
  `factor_correlation = [
    {"factor_x": "价值", "factor_y": "价值", "correlation": 1.00},
    {"factor_x": "价值", "factor_y": "质量", "correlation": 0.46},
    {"factor_x": "价值", "factor_y": "动量", "correlation": -0.18},
    {"factor_x": "价值", "factor_y": "低波", "correlation": 0.31},
    {"factor_x": "质量", "factor_y": "价值", "correlation": 0.46},
    {"factor_x": "质量", "factor_y": "质量", "correlation": 1.00},
    {"factor_x": "质量", "factor_y": "动量", "correlation": 0.22},
    {"factor_x": "质量", "factor_y": "低波", "correlation": 0.38},
    {"factor_x": "动量", "factor_y": "价值", "correlation": -0.18},
    {"factor_x": "动量", "factor_y": "质量", "correlation": 0.22},
    {"factor_x": "动量", "factor_y": "动量", "correlation": 1.00},
    {"factor_x": "动量", "factor_y": "低波", "correlation": -0.27},
    {"factor_x": "低波", "factor_y": "价值", "correlation": 0.31},
    {"factor_x": "低波", "factor_y": "质量", "correlation": 0.38},
    {"factor_x": "低波", "factor_y": "动量", "correlation": -0.27},
    {"factor_x": "低波", "factor_y": "低波", "correlation": 1.00},
]
charts.heatmap(  # type: ignore[arg-type]
    factor_correlation, x="factor_x", y="factor_y", value="correlation",
    labels={"correlation": "相关系数"}, title="因子相关性"
)`,
  `event_window = [
    {"event_day": _day, "car": _car}
    for _day, _car in zip(
        [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
        [-0.008, -0.006, -0.005, -0.003, -0.001, 0.012, 0.021, 0.025, 0.027, 0.026, 0.029],
    )
]
charts.event_path(  # type: ignore[arg-type]
    event_window, x="event_day", y="car",
    labels={"car": "累计异常收益"}, title="事件窗口累计异常收益"
)`,
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 3000 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

let documentId;
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research-chart-gallery@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  let document = await api(page, '/api/app/research/documents', {
    method: 'POST',
    body: JSON.stringify({ template: 'blank' }),
  });
  documentId = document.id;
  await api(page, `/api/app/research/conversations/${documentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });

  const initialPythonCell = document.cells.find((cell) => cell.kind === 'python');
  if (!initialPythonCell) {
    throw new Error('blank research document did not include a Python cell');
  }
  document = await api(page, `/api/app/research/cells/${initialPythonCell.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ source: sources[0] }),
  });
  const chartCellIds = [initialPythonCell.id];
  for (const source of sources.slice(1)) {
    document = await api(page, `/api/app/research/documents/${documentId}/cells`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'python', source }),
    });
    chartCellIds.push(document.cells.at(-1).id);
  }
  for (const cellId of chartCellIds) {
    document = await api(page, `/api/app/research/cells/${cellId}/run`, { method: 'POST' });
    const cell = document.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== 'success' || cell.outputs[0]?.type !== 'chart') {
      throw new Error(`chart cell failed: ${JSON.stringify(cell)}`);
    }
  }

  await page.goto(`${BASE}/research`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().click();
  const researchDocument = page.getByTestId('research-document');
  await researchDocument.waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '隐藏 Agent' }).click();
  await page.waitForTimeout(1_000);

  const charts = page.getByTestId('research-interactive-chart');
  if ((await charts.count()) !== 4) {
    throw new Error(`expected four native charts, rendered ${await charts.count()}`);
  }
  for (const cellId of chartCellIds) {
    await page.locator(`[data-cell-id="${cellId}"]`).getByText('已运行', { exact: true }).waitFor();
  }

  await page.screenshot({ path: `${SHOTS}research-chart-gallery.png`, fullPage: true });
  await page
    .locator(`[data-cell-id="${chartCellIds.at(-1)}"]`)
    .screenshot({ path: `${SHOTS}research-chart-event-path.png` });
  console.log('[research-chart-gallery-e2e] rendered histogram, boxplot, heatmap, and event path');
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
