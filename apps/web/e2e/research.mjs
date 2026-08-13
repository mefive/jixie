import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const spec = {
  version: 1,
  source: { kind: 'equity_market', market: 'CN' },
  asOf: { kind: 'latest_available' },
  eligibility: { minimumListedDays: 0, suspension: 'exclude', riskWarning: 'include' },
  predicates: [{ measure: 'equity.pe_ttm', measureVersion: 1, op: '<', value: 20 }],
  missing: 'exclude',
  sort: {
    measure: 'equity.total_market_cap_cny_10k',
    measureVersion: 1,
    direction: 'desc',
  },
  select: [
    { measure: 'equity.close', measureVersion: 1 },
    { measure: 'equity.pe_ttm', measureVersion: 1 },
    { measure: 'equity.total_market_cap_cny_10k', measureVersion: 1 },
  ],
  limit: 20,
};

const relationshipPlan = {
  version: 1,
  question: {
    version: 1,
    kind: 'time_series_relationship',
    text: '沪深300和中证500的月收益是否正相关？',
    hypothesis: {
      estimand: 'regression_slope',
      direction: 'positive',
      nullValue: 0,
    },
  },
  start: '20200101',
  end: '20251231',
  inputs: [
    {
      type: 'series',
      id: 'csi300',
      source: { kind: 'instrument', assetType: 'index', id: '000300.SH' },
      measure: 'market.adjusted_close',
      transform: 'simple_return',
      label: '沪深300',
    },
    {
      type: 'series',
      id: 'csi500',
      source: { kind: 'instrument', assetType: 'index', id: '000905.SH' },
      measure: 'market.adjusted_close',
      transform: 'simple_return',
      label: '中证500',
    },
  ],
  alignment: { frequency: 'monthly', join: 'inner', partialPeriod: 'exclude' },
  protocol: {
    kind: 'time_series_relationship',
    version: 1,
    predictor: 'csi300',
    outcome: 'csi500',
    predictorLag: 0,
    correlations: ['pearson', 'spearman'],
    inference: { kind: 'newey_west', lag: 'automatic' },
    rollingWindow: 24,
  },
  outputs: [
    { kind: 'summary_table' },
    { kind: 'scatter' },
    { kind: 'rolling_relationship' },
    { kind: 'conclusion' },
    { kind: 'formula' },
    { kind: 'python_example' },
    { kind: 'documentation' },
  ],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const loginStatus = await page.evaluate(async () =>
    fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e-research@test.com' }),
    }).then((response) => response.status),
  );
  if (loginStatus !== 200) {
    throw new Error(`dev login failed: ${loginStatus}`);
  }

  const actual = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/universe/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, spec);
  if (actual.total < 1 || actual.rows.length < 1 || actual.stages.length !== 5) {
    throw new Error(`invalid Universe result: ${JSON.stringify(actual)}`);
  }

  const actualRelationship = await page.evaluate(async (input) => {
    const response = await fetch('/api/app/research/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(body));
    }
    return body;
  }, relationshipPlan);
  if (
    actualRelationship.result.observations < 24 ||
    !actualRelationship.conclusion?.level ||
    actualRelationship.coverage.length !== 2
  ) {
    throw new Error(`invalid relationship result: ${JSON.stringify(actualRelationship)}`);
  }

  const now = new Date().toISOString();
  const universeConversation = {
    id: 'e2e-universe',
    title: '低估值大市值股票池',
    preview: 'UniverseSpec V1',
    createdAt: now,
    updatedAt: now,
  };
  const relationshipConversation = {
    id: 'e2e-relationship',
    title: '指数月收益关系',
    preview: 'ResearchPlanSpec V1',
    createdAt: now,
    updatedAt: now,
  };
  await page.route('**/api/app/research/conversations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([relationshipConversation, universeConversation]),
    }),
  );
  await page.route('**/api/app/agent/conversations/e2e-universe/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'text', text: '这是按明确时点、资格和指标口径运行的股票池。' },
              { type: 'universe', title: universeConversation.title, spec },
            ],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/app/research/universe/run', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(actual) }),
  );
  await page.route('**/api/app/agent/conversations/e2e-relationship/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: [
          {
            role: 'assistant',
            parts: [
              { type: 'text', text: '以下结论由固定研究协议计算，文字说明不能修改结论等级。' },
              {
                type: 'research',
                title: relationshipConversation.title,
                run: actualRelationship,
              },
            ],
          },
        ],
      }),
    }),
  );
  let rerunPlan = null;
  await page.route('**/api/app/research/run', (route) => {
    rerunPlan = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(actualRelationship),
    });
  });

  await page.goto(`${BASE}/research`, { waitUntil: 'networkidle' });
  await page.getByText(universeConversation.title, { exact: true }).click();
  await page
    .locator('.jx-universeSpecCard-table .ant-table-row')
    .first()
    .waitFor({ timeout: 20_000 });
  const screenLinks = await page.getByRole('link', { name: '选股看图' }).count();
  if (screenLinks !== 0) {
    throw new Error('legacy Screen navigation is still visible');
  }
  await page.screenshot({ path: `${SHOTS}research-universe-desktop.png`, fullPage: true });

  const [objectPage] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.jx-universeSpecCard-table tbody a').first().click(),
  ]);
  await objectPage.waitForLoadState('networkidle');
  await objectPage.locator('canvas').first().waitFor({ timeout: 20_000 });
  await objectPage.screenshot({ path: `${SHOTS}research-object-detail.png`, fullPage: true });
  await objectPage.close();

  await page.getByText(relationshipConversation.title, { exact: true }).click();
  await page.locator('.jx-researchResult-conclusion').waitFor({ timeout: 20_000 });
  await page.getByText('调整参数', { exact: true }).click();
  await page.locator('.jx-researchResult-controls .ant-input-number input').first().fill('1');
  await page.screenshot({ path: `${SHOTS}research-relationship-controls-zh.png`, fullPage: true });
  await page.getByText('按新参数重跑', { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.jx-researchResult-controls'));
  if (rerunPlan?.protocol?.predictorLag !== 1) {
    throw new Error(`research rerun did not preserve edited lag: ${JSON.stringify(rerunPlan)}`);
  }
  await page.screenshot({ path: `${SHOTS}research-relationship-zh.png`, fullPage: true });

  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Data coverage', { exact: true }).click();
  await page.getByText('Observations loaded', { exact: true }).first().waitFor();
  await page.getByText('Method & reproduction', { exact: true }).click();
  await page.getByText('Method assumptions', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}research-relationship-en.png`, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('.jx-research-sidebar');
    const workspace = document.querySelector('.jx-research-workspace');
    const card = document.querySelector('.jx-researchResult');
    if (!sidebar || !workspace || !card) {
      return null;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return {
      sidebarRight: sidebarRect.right,
      sidebarTransform: getComputedStyle(sidebar).transform,
      workspaceWidth: workspaceRect.width,
      cardWidth: cardRect.width,
    };
  });
  if (
    !mobileLayout ||
    mobileLayout.sidebarRight > 1 ||
    mobileLayout.workspaceWidth < 370 ||
    mobileLayout.cardWidth < 350
  ) {
    throw new Error(`Research mobile layout is still compressed: ${JSON.stringify(mobileLayout)}`);
  }
  await page.screenshot({ path: `${SHOTS}research-relationship-mobile.png`, fullPage: true });
  console.log(
    '[research-e2e] Universe API, relationship protocol, parameter rerun, bilingual content, object detail, and responsive layout passed',
  );
} finally {
  await browser.close();
}
