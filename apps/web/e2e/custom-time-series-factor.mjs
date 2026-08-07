import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];
let factorId = null;

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
  await page.getByText('自定义时间序列定义，创建后研究协议不可更改').waitFor();
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
  factorId = new URL(page.url()).searchParams.get('factor');
  if (!factorId) {
    throw new Error(`custom factor id missing from ${page.url()}`);
  }

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
  await page.getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: /未命名因子 时间序列/ }).waitFor();
  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 520;
  });
  await page.screenshot({
    path: `${SHOTS}10b-custom-time-series-report.png`,
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log(`[custom-time-series-factor-e2e] factor=${factorId} observations=7227 screenshots=2`);
} finally {
  if (factorId) {
    await api(`/api/app/factors/custom/${factorId}`, { method: 'DELETE' }).catch(() => {});
  }
  await browser.close();
}
