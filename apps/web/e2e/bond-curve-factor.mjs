import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const browserErrors = [];

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
    body: JSON.stringify({ email: `e2e-bond-curve-${Date.now()}@test.com` }),
  });
  if (!login.ok) {
    throw new Error(`dev login failed: ${login.status}`);
  }

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: '因子库' }).click();
  await page.getByRole('button', { name: /国债10Y收益率20日下行 时间序列/ }).click();
  await page.getByText('输入：国债收益率 10Y', { exact: true }).waitFor();
  await page.getByText('窗口：21 个交易日', { exact: true }).waitFor();
  await page.getByText('输出：逐资产分数', { exact: true }).waitFor();

  await page.getByRole('button', { name: '更多设置' }).click();
  await page.getByRole('textbox', { name: '开始日期' }).fill('2018-01-01');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: '结束日期' }).fill('2026-08-06');
  await page.keyboard.press('Enter');
  await page.screenshot({
    path: `${SHOTS}11a-cgb-yield-factor-config.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: '运行分析' }).last().click();
  const researchCard = page.getByRole('dialog', { name: '运行前研究卡' });
  await researchCard.getByText('纯探索', { exact: true }).click();
  await researchCard.getByRole('button', { name: '冻结研究卡并运行' }).click();
  await page.waitForURL(/\/factors\?factor=cgb_yield_decline_20&report=/, { timeout: 30_000 });

  await page.getByText('逐资产信号表现', { exact: true }).waitFor({ timeout: 180_000 });
  await page.getByText('国债曲线来源与可得时间', { exact: true }).waitFor();
  await page.getByText('来源：财政部-中国国债收益率曲线', { exact: false }).waitFor();
  await page.getByText('国债 ETF', { exact: true }).waitFor();
  await page.getByText('10年国债 ETF', { exact: true }).waitFor();
  await page.getByText('30年国债 ETF', { exact: true }).waitFor();
  await page.mouse.click(600, 500);
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `${SHOTS}11b-cgb-yield-factor-report.png`,
    fullPage: true,
  });

  await page.locator('.jx-factor-result').evaluate((element) => {
    element.scrollTop = 520;
  });
  await page.screenshot({
    path: `${SHOTS}11c-cgb-yield-factor-metrics.png`,
    fullPage: true,
  });

  const reportText = await page.getByTestId('time-series-report').innerText();
  if (!reportText.includes('4,853') || !reportText.includes('2026-08-06')) {
    throw new Error(`unexpected curve report coverage: ${reportText}`);
  }
  if (browserErrors.length > 0) {
    throw new Error(`browser errors: ${browserErrors.join('\n')}`);
  }
  console.log('[bond-curve-factor-e2e] observations=4853 assets=3 screenshots=3');
} finally {
  await browser.close();
}
