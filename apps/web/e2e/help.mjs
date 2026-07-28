import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

  await page.goto(`${BASE}/lab`, { waitUntil: 'domcontentloaded' });
  const helpEntry = page.getByRole('link', { name: '使用帮助' });
  await helpEntry.waitFor();
  if ((await helpEntry.getAttribute('href')) !== '/help') {
    throw new Error('top navigation help entry does not point to /help');
  }

  await helpEntry.click();
  await page.waitForURL('**/help/getting-started/navigation');
  await page.getByRole('heading', { level: 1, name: '页面导航' }).waitFor();
  await page.getByRole('heading', { level: 2, name: '打开主要页面' }).waitFor();

  const sectionLink = page.locator('.jx-help-tocLink', { hasText: '切换显示语言' });
  await sectionLink.click();
  await page.waitForFunction(() => decodeURIComponent(window.location.hash) === '#切换显示语言');
  await page.evaluate(() => window.scrollTo({ top: 0 }));

  await page.screenshot({
    path: `${SHOTS}8a-help-desktop.png`,
    fullPage: true,
  });

  await page.getByText('EN', { exact: true }).last().click();
  await page.getByRole('heading', { level: 1, name: 'Page navigation' }).waitFor();
  await page.getByRole('link', { name: 'Open Screener' }).click();
  await page.waitForURL('**/screen');

  await page.goto(`${BASE}/help/getting-started/navigation`, {
    waitUntil: 'domcontentloaded',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { level: 1, name: 'Page navigation' }).waitFor();
  await page.locator('.jx-help-mobileNav').waitFor();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  if (hasHorizontalOverflow) {
    throw new Error('help page has horizontal overflow at 390px');
  }

  await page.screenshot({
    path: `${SHOTS}8b-help-mobile.png`,
    fullPage: true,
  });

  console.log('[help-e2e] desktop, locale switch, internal navigation, and narrow layout ok');
} finally {
  await context.close();
  await browser.close();
}
