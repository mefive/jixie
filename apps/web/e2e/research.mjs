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

  const now = new Date().toISOString();
  const conversation = {
    id: 'e2e-universe',
    title: '低估值大市值股票池',
    preview: 'UniverseSpec V1',
    createdAt: now,
    updatedAt: now,
  };
  await page.route('**/api/app/research/conversations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([conversation]),
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
              { type: 'universe', title: conversation.title, spec },
            ],
          },
        ],
      }),
    }),
  );
  await page.route('**/api/app/research/universe/run', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(actual) }),
  );

  await page.goto(`${BASE}/research`, { waitUntil: 'networkidle' });
  await page.getByText(conversation.title, { exact: true }).click();
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

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const mobileLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('.jx-research-sidebar');
    const workspace = document.querySelector('.jx-research-workspace');
    const card = document.querySelector('.jx-universeSpecCard');
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
  await page.screenshot({ path: `${SHOTS}research-universe-mobile.png`, fullPage: true });
  console.log(
    '[research-e2e] Universe API, Research card, object detail, and responsive layout passed',
  );
} finally {
  await browser.close();
}
