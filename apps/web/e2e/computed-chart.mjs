import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// Computed-chart cards (ROADMAP 7.8 / computed-chart.md): a mocked factor conversation carries one
// sql-source combo chart and one compute-source area chart; the chart DATA endpoints hit the real
// API (whitelist + isolate), proving the persisted specs re-run fresh on render.
const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return response.status;
  });
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  const computeSpec = {
    source: 'compute',
    kind: 'area',
    queries: [
      {
        name: 'idx',
        sql: "SELECT tradeDate, close FROM IndexDaily WHERE tsCode='000300.SH' AND tradeDate >= '20240101' ORDER BY tradeDate",
      },
    ],
    code: 'export default ({ data }) => { const rows = data.idx.filter((row) => row.close != null); const base = rows[0].close; return rows.filter((_row, index) => index % 2 === 0).map((row) => ({ tradeDate: row.tradeDate, nav: row.close / base })); }',
    x: 'tradeDate',
    series: [{ column: 'nav', label: '重基净值' }],
  };
  const comboSpec = {
    kind: 'combo',
    sql: "SELECT tradeDate, close, vol FROM Daily WHERE tsCode='600519.SH' AND tradeDate >= '20250101' ORDER BY tradeDate LIMIT 200",
    x: 'tradeDate',
    series: [
      { column: 'close', label: '收盘' },
      { column: 'vol', label: '成交量', type: 'bar', yAxis: 'right' },
    ],
  };

  // The compute endpoint must validate and re-run the persisted spec server-side.
  const computeRows = await page.evaluate(async (spec) => {
    const response = await fetch('/api/app/agent/chart/compute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spec),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(`chart/compute failed: ${JSON.stringify(body)}`);
    }
    return body.rows;
  }, computeSpec);
  if (!Array.isArray(computeRows) || computeRows.length < 50 || computeRows.length > 500) {
    throw new Error(`unexpected compute row count: ${computeRows.length}`);
  }
  if (typeof computeRows[0].nav !== 'number' || Math.abs(computeRows[0].nav - 1) > 1e-9) {
    throw new Error(`compute rows are not rebased: ${JSON.stringify(computeRows[0])}`);
  }
  const badSpec = { ...computeSpec, series: [{ column: 'missing' }] };
  const badStatus = await page.evaluate(async (spec) => {
    const response = await fetch('/api/app/agent/chart/compute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(spec),
    });
    return response.status;
  }, badSpec);
  if (badStatus === 200) {
    throw new Error('a spec mapping a missing column must fail server-side');
  }

  // A mocked factor conversation renders both cards through the real data endpoints.
  const messages = [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: '画沪深300的重基净值和价量图' }] },
    {
      id: 'm2',
      role: 'assistant',
      parts: [
        { type: 'text', text: '两张图如下:' },
        { type: 'chart', title: '沪深300 重基净值(计算图)', chart: computeSpec },
        { type: 'chart', title: '贵州茅台 价量(双轴)', chart: comboSpec },
      ],
    },
  ];
  await page.route('**/api/app/factors/catalog', (route) =>
    route.fulfill({ json: [{ key: 'e2e-chart', label: 'E2E 图表', kind: 'custom' }] }),
  );
  await page.route('**/api/app/factors/custom/e2e-chart', (route) =>
    route.fulfill({
      json: {
        id: 'e2e-chart',
        name: 'E2E 图表',
        code: "export default defineFactor({ name: 'E2E', compute: (bar) => bar.close });\n",
        messages,
      },
    }),
  );
  await page.route('**/api/app/factor/reports?*', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto(`${BASE}/factors?factor=e2e-chart`, { waitUntil: 'domcontentloaded' });

  const charts = page.locator('.jx-chatChart');
  await charts.nth(1).waitFor({ timeout: 20000 });
  await page.locator('.jx-chatChart-body canvas').nth(1).waitFor({ timeout: 20000 });
  const errors = await page.locator('.jx-chatChart-status').count();
  if (errors) {
    throw new Error('a chart card rendered its error state');
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}7q-computed-chart-cards.png` });
  console.log(`[computed-chart-e2e] computeRows=${computeRows.length} cards=ok`);
} finally {
  await context.close();
  await browser.close();
}
