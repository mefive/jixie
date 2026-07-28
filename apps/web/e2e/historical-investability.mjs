import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

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

  await page.goto(`${BASE}/factors`, { waitUntil: 'domcontentloaded' });
  await page.locator('.jx-factor-agent').getByRole('tab', { name: '因子库' }).click();
  await page.locator('.jx-factor-libItem', { hasText: '盈利收益率' }).click();
  await page.locator('.jx-factor-historyTrigger').waitFor({ timeout: 15000 });
  await page.locator('.jx-factor-paramActions button').last().click();

  const popover = page.locator('.jx-factor-paramPopover:visible');
  await popover.waitFor();
  const riskSwitch = popover
    .locator('label', { hasText: '剔除 ST / 风险警示' })
    .getByRole('switch');
  const delistingSwitch = popover
    .locator('label', { hasText: '剔除退市整理股票' })
    .getByRole('switch');
  if (
    (await riskSwitch.getAttribute('aria-checked')) !== 'true' ||
    (await delistingSwitch.getAttribute('aria-checked')) !== 'true'
  ) {
    throw new Error('historical investability filters are not enabled by default');
  }

  await riskSwitch.click();
  if ((await riskSwitch.getAttribute('aria-checked')) !== 'false') {
    throw new Error('risk-warning filter switch did not update');
  }
  await riskSwitch.click();
  await page.screenshot({ path: `${SHOTS}4-7a-historical-investability.png` });
  console.log('[historical-investability-e2e] PASS default filters enabled and interactive');
} finally {
  await browser.close();
}
