import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
const ASSETS = ['510300.SH', '518880.SH', '511010.SH'];
let factorId = null;
let strategyId = null;

page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Warning: [antd:')) {
    browserErrors.push(`console: ${message.text()}`);
  }
});

const api = async (path, init) =>
  page.evaluate(
    async ({ path, init }) => {
      const response = await fetch(path, init);
      return { ok: response.ok, status: response.status, body: await response.json() };
    },
    { path, init },
  );

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const login = await api('/api/auth/dev/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `e2e-custom-time-series-${Date.now()}@test.com` }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '新建' }).click();
  await page.getByRole('menuitem', { name: 'ETF 时间序列信号' }).click();
  const createModal = page.getByTestId('new-factor-modal');
  await createModal.getByTestId('new-factor-name').fill('E2E ETF 趋势信号');
  await createModal.getByTestId('new-factor-key').fill('e2e_etf_trend');
  await createModal.getByRole('button', { name: /创\s*建/ }).click();
  await page.waitForURL(/\/factors\?factor=[^&]+/, { timeout: 30_000 });
  factorId = new URL(page.url()).searchParams.get('factor');
  if (!factorId) {
    throw new Error(`custom factor id missing from ${page.url()}`);
  }
  await page.getByText('自定义时间序列定义，创建后研究协议不可更改').waitFor();
  await page.locator('.jx-factor-keyValue', { hasText: 'e2e_etf_trend' }).waitFor();
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByText('窗口：21 个交易日').waitFor();
  await page.screenshot({
    path: `${SHOTS}10a-custom-time-series-definition.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: '运行分析' }).click();
  const researchCard = page.getByRole('dialog', { name: '运行前研究卡' });
  await researchCard.getByText('纯探索', { exact: true }).click();
  await researchCard.getByRole('button', { name: '冻结研究卡并运行' }).click();
  await page.waitForURL(/\/factors\?factor=[^&]+&report=/, { timeout: 30_000 });

  await page.getByText('逐资产信号表现', { exact: true }).waitFor({ timeout: 180_000 });
  await page.getByText('国债 ETF', { exact: true }).waitFor();
  const resource = await api(`/api/app/factors/custom/${factorId}`);
  if (
    !resource.ok ||
    resource.body.analysisKind !== 'time_series' ||
    !resource.body.code.includes('defineFactorV2')
  ) {
    throw new Error(`custom Definition V2 was not persisted: ${JSON.stringify(resource)}`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('自定义时间序列定义，创建后研究协议不可更改').waitFor();
  await page.getByText('国债 ETF', { exact: true }).waitFor({ timeout: 30_000 });
  await page.locator('.jx-factor-code .monaco-editor').waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: /E2E ETF 趋势信号 时间序列/ }).waitFor();
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 520;
  });
  await page.screenshot({
    path: `${SHOTS}10b-custom-time-series-report.png`,
    fullPage: true,
  });

  await page.getByTestId('factor-publish').click();
  const publishModal = page.locator('.ant-modal-confirm:visible');
  await publishModal.getByRole('button', { name: /发\s*布/ }).click();
  await page.getByText('已发布', { exact: true }).waitFor({ timeout: 30_000 });
  const published = await api(`/api/app/factors/custom/${factorId}`);
  if (
    !published.ok ||
    published.body.status !== 'published' ||
    published.body.strategyKey !== 'e2e_etf_trend' ||
    published.body.approvedReportId !== new URL(page.url()).searchParams.get('report')
  ) {
    throw new Error(`custom time-series publication missing: ${JSON.stringify(published)}`);
  }

  await page.getByTestId('factor-use-in-lab').click();
  await page.waitForURL(/\/lab\?new=1&factorKey=e2e_etf_trend/, { timeout: 30_000 });
  const prompt = page.locator('.jx-lab-heroInput');
  await prompt.waitFor({ timeout: 30_000 });
  await page.waitForFunction(
    (key) => document.querySelector('.jx-lab-heroInput')?.value.includes(key),
    'e2e_etf_trend',
    { timeout: 30_000 },
  );

  const factorRef = 'e2e_etf_trend';
  const strategyCode = [
    `const etfs = ${JSON.stringify(ASSETS)};`,
    "let last = '';",
    'export default defineStrategy({',
    "  name: '自定义 ETF 时间序列轮动',",
    '  watch: etfs,',
    `  factors: ['${factorRef}'],`,
    '  onBar(ctx) {',
    "    const period = ctx.period('monthly');",
    '    if (period === last) return;',
    '    last = period;',
    '    const picks = etfs',
    `      .map(code => ({ code, score: ctx.factor('${factorRef}', code) }))`,
    '      .filter(item => item.score != null)',
    '      .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))',
    '      .slice(0, 2)',
    '      .map(item => item.code);',
    '    if (picks.length === 2) ctx.equalWeight(picks);',
    '    else ctx.setHoldings({});',
    '  },',
    '});',
  ].join('\n');
  const config = {
    name: '自定义 ETF 时间序列轮动',
    start: '20250101',
    end: '20250630',
    initialCash: 1_000_000,
    code: strategyCode,
  };
  const strategy = await api('/api/app/strategies', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!strategy.ok || !strategy.body.id) {
    throw new Error(`strategy creation failed: ${JSON.stringify(strategy)}`);
  }
  strategyId = strategy.body.id;
  const backtest = await api(`/api/app/strategy/backtest?strategyId=${strategyId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!backtest.ok) {
    throw new Error(`backtest failed to start: ${JSON.stringify(backtest)}`);
  }
  const completed = await page.evaluate(
    async ({ strategyId, jobId }) => {
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const job = await fetch(`/api/app/strategy/backtest/${jobId}?since=0`, {
          cache: 'no-store',
        }).then((response) => response.json());
        if (job.status === 'done') {
          return fetch(`/api/app/strategies/${strategyId}`, { cache: 'no-store' }).then(
            (response) => response.json(),
          );
        }
        if (job.status === 'error' || job.status === 'stale') {
          throw new Error(`backtest ${job.status}: ${job.error ?? ''}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(`backtest ${jobId} timed out`);
    },
    { strategyId, jobId: backtest.body.jobId },
  );
  const dependency = completed.lastResult?.factorDependencies?.[0];
  if (
    completed.lastResult?.trades <= 0 ||
    dependency?.factorId !== factorId ||
    dependency?.key !== factorRef ||
    dependency?.codeHash !== published.body.codeHash
  ) {
    throw new Error(`custom time-series lineage failed: ${JSON.stringify(completed)}`);
  }
  await page.goto(`${BASE}/lab?id=${strategyId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('strategy-factor-dependencies').waitFor({ timeout: 30_000 });
  await page.getByText('e2e_etf_trend', { exact: false }).waitFor();
  await page.locator('.jx-lab-chart canvas').waitFor({ timeout: 30_000 });
  await page.screenshot({
    path: `${SHOTS}10c-custom-time-series-strategy.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(
    `[custom-time-series-factor-e2e] factor=${factorId} key=e2e_etf_trend strategy=${strategyId} observations=7227 trades=${completed.lastResult.trades} screenshots=3`,
  );
} finally {
  if (strategyId) {
    await api(`/api/app/strategies/${strategyId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (factorId) {
    await api(`/api/app/factors/custom/${factorId}/archive`, { method: 'POST' }).catch(() => {});
  }
  await browser.close();
}
