import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

await context.route('**/api/auth/me', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
});
await context.route('**/api/auth/email/request', async (route) => {
  await route.fulfill({
    status: 502,
    contentType: 'text/html',
    body: '<html><body>Bad Gateway</body></html>',
  });
});

const page = await context.newPage();

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('.jx-login-input').fill('reader@example.com');
  await page.getByRole('button', { name: '继续' }).click();
  await page.getByText('服务暂时不可用，请稍后重试', { exact: true }).waitFor();

  const parseErrors = await page.getByText(/JSON Parse error|Unrecognized token/).count();
  if (parseErrors !== 0) {
    throw new Error(`expected no raw JSON parse error, got ${parseErrors}`);
  }

  await page.screenshot({ path: `${SHOTS}login-service-unavailable.png`, fullPage: true });
  console.log('[login-error-e2e] non-JSON gateway response is shown as a localized error');
} finally {
  await browser.close();
}
