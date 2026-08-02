import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const OUTPUT = new URL('../../docs/public/images/help/zh/factors/', import.meta.url).pathname;
const EMAIL = 'e2e-help-factor-composite@test.com';
const COMPOSITE_NAME = '质量价值等权示例';
mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
let compositeId = '';

try {
  await login();
  await cleanup();
  compositeId = await createComposite();
  await captureDefinition();
  const reportId = await runCompositeAnalysis();
  await captureReport(reportId);
  console.log(`[help-factor-composite-e2e] PASS composite=${compositeId} report=${reportId}`);
} finally {
  await cleanup().catch(() => {});
  await context.close();
  await browser.close();
}

async function login() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async (email) => {
    const response = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.status;
  }, EMAIL);
  if (status !== 200) {
    throw new Error(`dev login failed: ${status}`);
  }
  await page.evaluate(() => localStorage.setItem('jx-locale', 'zh'));
}

async function createComposite() {
  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: '新建多因子合成' }).click();
  const modal = page.getByRole('dialog', { name: '新建多因子合成' });
  await modal.getByRole('textbox', { name: '名称' }).fill(COMPOSITE_NAME);
  await modal.getByRole('button', { name: '保 存' }).click();
  await page.locator('.jx-factor-compositeWorkspace').waitFor({ timeout: 15_000 });

  const result = await page.evaluate(async (name) => {
    const catalog = await fetch('/api/app/factors/catalog').then((response) => response.json());
    const composite = catalog.find(
      (factor) => factor.kind === 'composite' && factor.label === name,
    );
    if (!composite) {
      return { error: 'created composite missing from catalog' };
    }
    const definition = {
      version: 1,
      name,
      standardization: 'rank',
      weighting: 'equal',
      components: [
        { factor: 'ep', direction: 'positive' },
        { factor: 'roe', direction: 'positive' },
      ],
    };
    const updated = await fetch(`/api/app/factors/composites/${composite.key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition }),
    });
    return updated.ok
      ? { id: composite.key, definition }
      : { error: `update failed: ${updated.status}` };
  }, COMPOSITE_NAME);
  if (result.error) {
    throw new Error(result.error);
  }
  return result.id;
}

async function captureDefinition() {
  await page.goto(`${BASE}/factors?factor=${encodeURIComponent(compositeId)}`, {
    waitUntil: 'domcontentloaded',
  });
  const workspace = page.locator('.jx-factor-compositeWorkspace');
  await workspace.filter({ hasText: '盈利收益率' }).waitFor({ timeout: 15_000 });
  await workspace.filter({ hasText: 'ROE质量' }).waitFor();
  await annotatedScreenshot(page, `${OUTPUT}factor-composite-definition-01.png`, [
    { locator: page.locator('.jx-factor-agent'), number: 1 },
    { locator: workspace.locator('.jx-factor-compositeHead'), number: 2 },
    { locator: workspace.locator('.jx-factor-compositeComponents'), number: 3 },
    { locator: workspace.locator('.ant-alert'), number: 4 },
    { locator: page.locator('.jx-factor-runButton'), number: 5 },
  ]);
}

async function runCompositeAnalysis() {
  const definition = {
    version: 1,
    name: COMPOSITE_NAME,
    standardization: 'rank',
    weighting: 'equal',
    components: [
      { factor: 'ep', direction: 'positive' },
      { factor: 'roe', direction: 'positive' },
    ],
  };
  const started = await page.evaluate(
    async ({ factor, composite }) => {
      const response = await fetch('/api/app/factor/analysis/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          factor,
          spec: {
            version: 4,
            freq: 'month',
            start: '20200101',
            end: '20221231',
            neutral: 'size_industry',
            universe: {
              minimumListingDays: 365,
              liquidityDropFraction: 0.25,
              minimumCandidates: 100,
              excludeRiskWarnings: true,
              excludePendingDelisting: true,
            },
            missing: { minimumWindowCoverage: 2 / 3 },
            outliers: {
              factorExposure: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
              forwardReturn: { method: 'winsor', tailFraction: 0.01, madThreshold: 5 },
            },
            costs: {
              commissionPerSide: 0.00025,
              stampDutySellSide: 0.0005,
              slippagePerSide: 0.001,
            },
            composite,
          },
          parentReportId: null,
          researchIntent: {
            version: 1,
            mode: 'exploratory',
            expectedDirection: 'unknown',
          },
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { factor: compositeId, composite: definition },
  );
  if (started.status !== 200) {
    throw new Error(`composite run failed: ${started.status} ${JSON.stringify(started.body)}`);
  }
  const detail = await page.evaluate(async (reportId) => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const report = await fetch(`/api/app/factor/reports/${reportId}`).then((response) =>
        response.json(),
      );
      if (report.status !== 'running') {
        return report;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`timed out waiting for ${reportId}`);
  }, started.body.reportId);
  if (detail.status !== 'done' || detail.spec?.version !== 4) {
    throw new Error(`invalid composite report: ${JSON.stringify(detail)}`);
  }
  return started.body.reportId;
}

async function captureReport(reportId) {
  await page.goto(
    `${BASE}/factors?factor=${encodeURIComponent(compositeId)}&report=${encodeURIComponent(reportId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  const methodology = page.locator('.jx-factor-methodology');
  await methodology.filter({ hasText: '2 个成分' }).waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-metrics').first().waitFor();
  await annotatedScreenshot(page, `${OUTPUT}factor-composite-report-01.png`, [
    { locator: page.locator('.jx-factor-compositeWorkspace'), number: 1 },
    { locator: page.locator('.jx-factor-resultHead'), number: 2 },
    { locator: methodology, number: 3 },
    { locator: page.locator('.jx-factor-metrics').first(), number: 4 },
  ]);
}

async function cleanup() {
  const ids = await page.evaluate(async (name) => {
    const catalog = await fetch('/api/app/factors/catalog').then((response) => response.json());
    return catalog
      .filter((factor) => factor.kind === 'composite' && factor.label === name)
      .map((factor) => factor.key);
  }, COMPOSITE_NAME);
  for (const id of ids) {
    await page.evaluate(
      async (factorId) => fetch(`/api/app/factors/composites/${factorId}`, { method: 'DELETE' }),
      id,
    );
  }
  compositeId = '';
}

async function annotatedScreenshot(targetPage, path, marks) {
  const annotations = [];
  for (const mark of marks) {
    const box = await mark.locator.first().boundingBox();
    if (!box) {
      throw new Error(`annotation ${mark.number} is not visible for ${path}`);
    }
    annotations.push({ ...box, number: mark.number });
  }
  await targetPage.evaluate((items) => {
    const layer = document.createElement('div');
    layer.dataset.helpAnnotations = 'true';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    for (const item of items) {
      const outline = document.createElement('div');
      outline.style.cssText = [
        'position:absolute',
        `left:${Math.max(2, item.x - 4)}px`,
        `top:${Math.max(2, item.y - 4)}px`,
        `width:${Math.max(8, item.width + 8)}px`,
        `height:${Math.max(8, item.height + 8)}px`,
        'border:3px solid #e8463b',
        'border-radius:9px',
        'box-sizing:border-box',
        'box-shadow:0 0 0 2px rgba(255,255,255,.9)',
      ].join(';');
      const badge = document.createElement('div');
      badge.textContent = String(item.number);
      badge.style.cssText = [
        'position:absolute',
        `left:${Math.max(4, item.x - 15)}px`,
        `top:${Math.max(4, item.y - 15)}px`,
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'width:28px',
        'height:28px',
        'border:2px solid #fff',
        'border-radius:999px',
        'background:#e8463b',
        'color:#fff',
        'font-size:15px',
        'font-weight:700',
        'line-height:1',
        'box-shadow:0 2px 7px rgba(0,0,0,.3)',
      ].join(';');
      layer.append(outline, badge);
    }
    document.body.append(layer);
  }, annotations);
  await targetPage.screenshot({ path });
  await targetPage.evaluate(() => {
    document.querySelector('[data-help-annotations="true"]')?.remove();
  });
}
