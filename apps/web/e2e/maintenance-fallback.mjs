import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let serviceAvailable = false;
let maintenanceRequests = 0;
let maintenancePhase = 'idle';

await context.route('**/api/auth/me', (route) => {
  if (!serviceAvailable) {
    return gatewayUnavailable(route);
  }
  return json(route, {
    user: { id: 'maintenance-user', email: 'maintenance@test.com', name: null },
  });
});
await context.route('**/api/maintenance/status', (route) => {
  maintenanceRequests += 1;
  if (!serviceAvailable) {
    return gatewayUnavailable(route);
  }
  return json(route, {
    ...inactiveMaintenanceStatus(),
    phase: maintenancePhase,
    active: maintenancePhase === 'publishing',
    stage: maintenancePhase === 'publishing' ? 'publishing' : null,
    kind: maintenancePhase === 'idle' ? null : 'sync',
  });
});
await context.route('**/api/maintenance/version', (route) =>
  json(route, { revision: 'maintenance-review' }),
);
await context.route('**/api/app/market/weather**', (route) => json(route, marketWeatherSeries()));

const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message));

try {
  await page.goto(`${BASE}/market?from=maintenance`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '服务暂时不可用', exact: true }).waitFor();
  await page.getByText('系统可能正在更新或重启，我们会持续尝试连接。', { exact: true }).waitFor();
  await page.getByText('等待服务恢复', { exact: true }).waitFor();
  await assertCurrentRoute(page);
  await page.screenshot({ path: `${SHOTS}maintenance-service-unavailable.png`, fullPage: true });

  const recoveryNavigation = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 10_000,
  });
  serviceAvailable = true;
  await recoveryNavigation;
  await page.locator('.jx-maintenanceGate').waitFor({ state: 'detached' });
  await page.locator('.jx-market').waitFor();
  await assertCurrentRoute(page);

  if ((await page.locator('.jx-login').count()) !== 0) {
    throw new Error('expected recovery to preserve the authenticated route, got the login page');
  }

  if (maintenanceRequests < 2) {
    throw new Error(`expected the maintenance status to be retried, got ${maintenanceRequests}`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`unexpected page errors: ${pageErrors.join('; ')}`);
  }

  await page.getByText('等待完整输入', { exact: true }).waitFor();
  maintenancePhase = 'preparing';
  await page.getByText('数据准备中', { exact: true }).waitFor({ timeout: 10_000 });
  if (await page.locator('.jx-maintenanceGate').count()) {
    throw new Error('Preparation must not gate the published application');
  }
  await page.screenshot({ path: `${SHOTS}maintenance-preparing-zh.png`, fullPage: true });
  await page.getByText('EN', { exact: true }).click();
  await page.getByText('Preparing data', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}maintenance-preparing-en.png`, fullPage: true });

  maintenancePhase = 'error';
  await page.getByText('Data update awaiting retry', { exact: true }).waitFor({ timeout: 10_000 });
  if (await page.locator('.jx-maintenanceGate').count()) {
    throw new Error('Candidate failure must not gate the published application');
  }
  await page.screenshot({ path: `${SHOTS}maintenance-candidate-error.png`, fullPage: true });

  maintenancePhase = 'publishing';
  await page.locator('.jx-maintenanceGate').waitFor({ timeout: 10_000 });
  await page.getByText('Publishing market data', { exact: true }).waitFor();
  await assertCurrentRoute(page);
  await page.screenshot({ path: `${SHOTS}maintenance-publishing-en.png`, fullPage: true });
  const resumed = page.waitForEvent('framenavigated', {
    predicate: (frame) => frame === page.mainFrame(),
    timeout: 10_000,
  });
  maintenancePhase = 'idle';
  await resumed;
  await page.locator('.jx-maintenanceGate').waitFor({ state: 'detached' });
  await assertCurrentRoute(page);
  await page.screenshot({ path: `${SHOTS}maintenance-service-recovered.png`, fullPage: true });
  console.log('[maintenance-fallback-e2e] gateway outage is gated and recovers automatically');
} finally {
  await browser.close();
}

function gatewayUnavailable(route) {
  return route.fulfill({
    status: 502,
    contentType: 'text/html',
    body: '<html><body>Bad Gateway</body></html>',
  });
}

function inactiveMaintenanceStatus() {
  return {
    active: false,
    runId: null,
    kind: null,
    targetDate: '20260805',
    running: false,
    revision: 7,
    coverage: [
      {
        dataset: 'stock-prices',
        scope: 'all',
        maxObservedDate: '20260805',
        verifiedThrough: null,
        pending: 1,
        errors: 0,
      },
    ],
    stage: null,
    startedAt: null,
    heartbeatAt: null,
    error: null,
    retryAfterSeconds: 0,
  };
}

function marketWeatherSeries() {
  return {
    dimension: 'industry',
    frequency: 'month',
    startDate: '20260801',
    endDate: '20260805',
    groups: [{ key: 'financial', codes: ['801780.SI'] }],
    periods: [
      {
        key: '2026-08',
        startDate: '20260801',
        endDate: '20260805',
        snapshotDate: '20260805',
        items: [
          {
            code: '801780.SI',
            name: '银行',
            periodReturn: 0.012,
            benchmarkCode: null,
            benchmarkName: null,
            relativeReturn: null,
            heatScore: null,
            heatChange: null,
            activityScore: null,
            breadthScore: null,
            valuationPercentile: 32,
            valuationSource: 'official',
            state: 'waiting',
            coverage: 'partial',
          },
        ],
      },
    ],
  };
}

async function assertCurrentRoute(page) {
  const current = new URL(page.url());
  if (current.pathname !== '/market' || current.search !== '?from=maintenance') {
    throw new Error(
      `expected the protected route to be preserved, got ${current.pathname}${current.search}`,
    );
  }
}

function json(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}
