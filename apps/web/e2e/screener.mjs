import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Headless e2e for the frontend — acceptance screenshots. The standing rule: every frontend change
 * finishes by running this and reviewing apps/web/e2e/shots/*.png.
 *
 * Prereqs: api on :3001 and web on :5173 must be running, e.g.
 *   pnpm --filter api dev        (terminal 1, NODE_ENV=development)
 *   pnpm --filter web dev        (terminal 2)
 * then: pnpm --filter web test:e2e
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
// Acceptance screenshots — gitignored; the user reviews these after each frontend change.
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  // 1. Load app then dev-login (sets the session cookie; dev/login is dev-only).
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/auth/dev/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'e2e@test.com' }),
    });
    return r.status;
  });
  log('dev login status', status);

  // 2. Screener page (full reload → authStore.load sees the cookie).
  await page.goto(`${BASE}/screen`, { waitUntil: 'networkidle' });
  await page.getByText('选股看图').first().waitFor();
  await page.screenshot({ path: `${SHOTS}1-screen-empty.png` });
  log('shot 1: empty screener');

  // 3. Example query → result table fills.
  await page.getByRole('button', { name: '低PE高股息大盘' }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 5,
    { timeout: 15000 },
  );
  const rows = await page.locator('.jx-screen-table tbody tr.ant-table-row').count();
  const summary = ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim();
  log('result rows', rows, '|', summary);
  await page.screenshot({ path: `${SHOTS}2-screen-results.png` });
  log('shot 2: results table');

  // 4. Click first row → detail modal with K线/PE/量 charts.
  await page.locator('.jx-screen-table tbody tr.ant-table-row').first().click();
  await page.locator('.ant-modal canvas').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800); // let echarts paint
  log('detail title', ((await page.locator('.ant-modal-title').textContent()) ?? '').trim());
  await page.screenshot({ path: `${SHOTS}3-stock-detail.png` });
  log('shot 3: stock detail charts');

  // 5. Close modal → nav back to the backtest workbench (routing sanity).
  await page.locator('.ant-modal-close').click();
  await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.getByRole('link', { name: '回测工作台' }).click();
  await page.getByText('策略配置').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}4-lab.png` });
  log('shot 4: backtest workbench');

  // 6. (opt-in, costs an LLM call) NL→screen through the UI: needs DEEPSEEK_API_KEY. Run with E2E_NL=1.
  if (process.env.E2E_NL) {
    await page.getByRole('link', { name: '选股看图' }).click();
    const before = ((await page.locator('.jx-screen-summary').textContent().catch(() => '')) ?? '').trim();
    await page.locator('.jx-screen-bar textarea').fill('市盈率低于10、股息率大于4%的股票，按股息率从高到低');
    await page.getByRole('button', { name: 'AI 选股' }).click();
    await page.waitForFunction(
      (prev) => {
        const el = document.querySelector('.jx-screen-summary');
        return el && el.textContent && el.textContent.trim() !== prev && document.querySelectorAll('.jx-screen-table tbody tr.ant-table-row').length > 0;
      },
      before,
      { timeout: 45000 }, // DeepSeek round-trip
    );
    log('NL search summary:', ((await page.locator('.jx-screen-summary').textContent()) ?? '').trim());
    await page.screenshot({ path: `${SHOTS}5-nl-screen.png` });
    log('shot 5: NL→screen result (real DeepSeek)');
  }

  log('PASS — all steps completed');
} catch (e) {
  log('FAIL', e.message);
  await page.screenshot({ path: `${SHOTS}error.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
