import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

/**
 * Acceptance screenshots for the /learn tutorial page (+ its cross-links from /docs and the lab hero).
 * Prereqs: api on :3001 and web on :5173. Run: node e2e/learn.mjs
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const SHOTS = new URL('../acceptance/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
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

  // —— /learn: top (hero + ch.01), then scroll through the chapters ——
  await page.goto(`${BASE}/learn`, { waitUntil: 'networkidle' });
  await page.getByText('十分钟写出你的第一个策略').waitFor();
  await page.screenshot({ path: `${SHOTS}learn-1-top.png` });
  log('shot: learn top');

  await page.locator('#data').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}learn-2-data.png` });
  log('shot: bar vs bars + table');

  await page.locator('#orders').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}learn-3-orders.png` });
  log('shot: order vs target + why');

  await page.locator('#pitfalls').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}learn-4-pitfalls.png` });
  log('shot: pitfalls + next cards');

  // scroll-spy: nav should highlight the active chapter
  const activeNav = await page.locator('.jx-learn-navLink--on').first().innerText();
  log('active nav after scroll:', JSON.stringify(activeNav));

  // —— /docs: top bar now carries the 入门教程 cross-link ——
  await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
  await page.getByText('策略 SDK').first().waitFor();
  const tut = page.locator('.jx-docs-tutLink');
  if ((await tut.count()) === 0) {
    throw new Error('/docs 顶栏缺少 入门教程 链接');
  }
  await page.screenshot({ path: `${SHOTS}learn-5-docs-crosslink.png` });
  log('shot: /docs top bar with tutorial link');

  // clicking it lands on /learn
  await tut.first().click();
  await page.waitForURL('**/learn');
  log('docs → learn link works');

  // —— lab hero: 看入门教程 entry ——
  await page.goto(`${BASE}/lab`, { waitUntil: 'networkidle' });
  const heroLearn = page.getByText('第一次用?看入门教程');
  if ((await heroLearn.count()) === 0) {
    throw new Error('lab hero 缺少 看入门教程 入口');
  }
  await page.screenshot({ path: `${SHOTS}learn-6-lab-hero.png` });
  log('shot: lab hero with tutorial entry');

  log('✅ all learn e2e checks passed');
} catch (err) {
  console.error('[e2e] FAILED', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
